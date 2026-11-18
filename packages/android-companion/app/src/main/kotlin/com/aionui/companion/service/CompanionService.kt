package com.aionui.companion.service

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import com.aionui.companion.BuildConfig
import com.aionui.companion.R
import com.aionui.companion.device.AndroidDeviceActions
import com.aionui.companion.device.ScreenCapture
import com.aionui.companion.device.VerbDispatcher
import com.aionui.companion.protocol.Health
import com.aionui.companion.protocol.PairingPayload
import com.aionui.companion.protocol.PhoneInfo
import com.aionui.companion.relay.Credentials
import com.aionui.companion.relay.ExecutorScheduler
import com.aionui.companion.relay.NetworkRedial
import com.aionui.companion.relay.OkHttpSockets
import com.aionui.companion.relay.RelaySession
import com.aionui.companion.relay.RelayStatus
import com.aionui.companion.relay.SessionCallbacks
import com.aionui.companion.store.Pairing
import com.aionui.companion.store.TokenStore
import com.aionui.companion.ui.MainActivity
import com.aionui.companion.update.UpdateCenter
import com.aionui.companion.update.UpdateOffer
import com.aionui.companion.update.Updater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The companion's connection: a foreground service (its notification, with Stop, is
 * always shown while it runs) that keeps the outbound relay socket and answers verbs.
 * It stays up: sticky, back after a reboot, redialling when the network changes, and
 * holding the CPU and Wi-Fi awake while the owner's switch is on. Stop switches agents
 * off at once and ends it until the owner starts it again.
 */
class CompanionService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val scheduler = ExecutorScheduler()
    private lateinit var tokens: TokenStore
    private lateinit var overlay: OverlayChip
    @Volatile
    private var session: RelaySession? = null
    private var capture: ScreenCapture? = null
    private lateinit var dispatcher: VerbDispatcher
    private lateinit var updater: Updater
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private val networkRedial = NetworkRedial()
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    @Volatile
    private var health: Health? = null
    private val healthReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            refreshHealth(battery = intent?.takeIf { it.action == Intent.ACTION_BATTERY_CHANGED })
        }
    }

    override fun onCreate() {
        super.onCreate()
        CompanionState.load(this)
        tokens = TokenStore(this)
        overlay = OverlayChip(this) { ownerStop() }
        dispatcher = VerbDispatcher(AndroidDeviceActions(this) { capture }, scope)
        updater = Updater(
            appContext = this,
            scope = scope,
            pairedHost = { tokens.load()?.host },
            agentBusy = { dispatcher.busy() },
            send = { frame -> session?.send(frame) },
        )
        UpdateCenter.updater = updater
        createChannel()
        watchNetwork()
        watchHealth()
        scope.launch {
            CompanionState.accessibilityOn.drop(1).collect { refreshHealth(battery = null) }
        }
        // The locks carry a timeout (nothing may hold the CPU forever): renewed while wanted.
        scope.launch {
            while (isActive) {
                delay(LOCK_RENEW_MS)
                updateLocks()
            }
        }
        scope.launch {
            CompanionState.switchOn.drop(1).collect { on ->
                session?.inventoryChanged()
                if (!on) session?.sendEvent(EVENT_SWITCH_OFF)
                updateIndicators()
            }
        }
        scope.launch {
            CompanionState.foreground.filterNotNull().collect { pkg ->
                session?.sendEvent("foreground", buildJsonObject { put("package", pkg) })
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PAIR -> {
                val host = intent.getStringExtra(EXTRA_HOST)
                val code = intent.getStringExtra(EXTRA_CODE)
                goForeground(withCapture = capture != null)
                CompanionState.setKeepConnected(this, true)
                if (host != null && code != null) pair(host, code)
            }
            ACTION_START -> {
                goForeground(withCapture = capture != null)
                CompanionState.setKeepConnected(this, true)
                connectWithToken()
            }
            // Android restarted the service after killing it (START_STICKY): carry on.
            null -> if (CompanionState.keepConnected(this)) {
                goForeground(withCapture = false)
                connectWithToken()
            } else {
                stopSelf()
            }
            ACTION_CONSENT -> {
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                val data = IntentCompat.getParcelableExtra(intent, EXTRA_RESULT_DATA, Intent::class.java)
                if (data != null) startCapture(resultCode, data)
            }
            ACTION_STOP -> ownerStop()
            ACTION_UPDATE_CHECK -> updater.checkNow()
            ACTION_UPDATE_INSTALL -> updater.accept()
            ACTION_UNPAIR -> unpair()
            else -> Unit
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        session?.stop()
        session = null
        releaseCapture()
        overlay.hide()
        if (UpdateCenter.updater === updater) UpdateCenter.updater = null
        unwatchNetwork()
        runCatching { unregisterReceiver(healthReceiver) }
        releaseLocks()
        scope.cancel()
        scheduler.post { scheduler.shutdown() }
        CompanionState.setRelay(RelayStatus.Stopped)
        super.onDestroy()
    }

    private fun pair(host: String, code: String) {
        session?.stop()
        val name = deviceName()
        session = newSession(host, Credentials.Code(code, name)).also { it.start() }
    }

    private fun connectWithToken() {
        if (session != null) return
        val pairing = tokens.load() ?: run {
            CompanionState.setRelay(RelayStatus.NeedsPairing("not paired"))
            stopSelf()
            return
        }
        session = newSession(pairing.host, Credentials.Token(pairing.token)).also { it.start() }
    }

    private fun newSession(host: String, credentials: Credentials): RelaySession =
        RelaySession(
            url = PairingPayload.relayUrlFor(host),
            credentials = credentials,
            version = BuildConfig.VERSION_NAME,
            versionCode = BuildConfig.VERSION_CODE,
            sockets = OkHttpSockets(),
            scheduler = scheduler,
            handler = dispatcher,
            callbacks = object : SessionCallbacks {
                override fun status(status: RelayStatus) {
                    CompanionState.setRelay(status)
                    scope.launch(Dispatchers.Main) { updateIndicators() }
                }

                override fun paired(token: String, clientId: String) = tokens.save(Pairing(host, clientId, token))

                override fun forgetToken() = tokens.clear()

                override fun health() = this@CompanionService.health

                override fun updateOffered(offer: UpdateOffer) = updater.offered(offer)

                override fun phone() = PhoneInfo(
                    name = deviceName(),
                    model = Build.MODEL,
                    androidVersion = Build.VERSION.RELEASE,
                    enabled = CompanionState.switchOn.value,
                )
            },
        )

    private fun startCapture(resultCode: Int, data: Intent) {
        // Android 14+: be a mediaProjection foreground service before taking the projection.
        goForeground(withCapture = true)
        val manager = getSystemService(MediaProjectionManager::class.java)
        val projection = runCatching { manager.getMediaProjection(resultCode, data) }.getOrNull() ?: return
        releaseCapture()
        capture = ScreenCapture(projection, resources.displayMetrics) {
            capture = null
            CompanionState.setCaptureOn(false)
        }
        CompanionState.setCaptureOn(true)
    }

    private fun releaseCapture() {
        capture?.release()
        capture = null
        CompanionState.setCaptureOn(false)
    }

    /** The owner's Stop (notification, overlay chip or the app): agents off now, session ends. */
    private fun ownerStop() {
        // First no new verb is accepted, then whatever runs or waits is cancelled, now:
        // not when the session closes after the flush below.
        CompanionState.setKeepConnected(this, false)
        CompanionState.setSwitch(this, false)
        dispatcher.stopAll()
        releaseCapture()
        overlay.hide()
        session?.sendEvent(EVENT_SWITCH_OFF)
        session?.inventoryChanged()
        // Let the switch-off reach core before the socket closes.
        scheduler.schedule(STOP_FLUSH_MS) {
            session?.stop()
            session = null
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun unpair() {
        session?.stop()
        session = null
        tokens.clear()
        CompanionState.setKeepConnected(this, false)
        CompanionState.setSwitch(this, false)
        releaseCapture()
        overlay.hide()
        CompanionState.setRelay(RelayStatus.Stopped)
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun updateIndicators() {
        val live = CompanionState.switchOn.value && CompanionState.relay.value is RelayStatus.Connected
        if (live) overlay.show() else overlay.hide()
        updateLocks()
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification())
    }

    /**
     * While the owner's switch is on and the session runs: keep the CPU and the Wi-Fi
     * radio awake, so pings keep flowing with the screen off. Released as soon as the
     * switch goes off or the session ends.
     */
    private fun updateLocks() {
        // Only while paired, the owner's switch is on and the session runs.
        val status = CompanionState.relay.value
        val wanted = CompanionState.switchOn.value &&
            status !is RelayStatus.Stopped && status !is RelayStatus.NeedsPairing &&
            tokens.load() != null
        if (!wanted) {
            releaseLocks()
            return
        }
        if (wakeLock == null) {
            wakeLock = runCatching {
                getSystemService(PowerManager::class.java)
                    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "aionui-companion:relay")
                    .apply { setReferenceCounted(false) }
            }.getOrNull()
        }
        if (wifiLock == null) {
            wifiLock = runCatching {
                applicationContext.getSystemService(WifiManager::class.java)
                    .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "aionui-companion:relay")
                    .apply { setReferenceCounted(false) }
            }.getOrNull()
        }
        // Not reference counted: acquiring again only moves the timeout forward.
        runCatching { wakeLock?.acquire(LOCK_TIMEOUT_MS) }
        runCatching { wifiLock?.takeIf { !it.isHeld }?.acquire() }
    }

    private fun releaseLocks() {
        runCatching { wakeLock?.takeIf { it.isHeld }?.release() }
        runCatching { wifiLock?.takeIf { it.isHeld }?.release() }
    }

    /** Battery, lock screen and accessibility for core's Devices card; a change is sent as it happens. */
    private fun watchHealth() {
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_BATTERY_CHANGED)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        // System broadcasts only; the sticky battery intent comes back at once.
        val battery = runCatching {
            ContextCompat.registerReceiver(this, healthReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        }.getOrNull()
        refreshHealth(battery)
    }

    private fun refreshHealth(battery: Intent?) {
        val previous = health
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val plugged = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val next = Health(
            batteryPercent = if (battery != null) Health.percent(level, scale) else previous?.batteryPercent,
            charging = if (battery != null && plugged != -1) {
                plugged == BatteryManager.BATTERY_STATUS_CHARGING || plugged == BatteryManager.BATTERY_STATUS_FULL
            } else {
                previous?.charging
            },
            locked = runCatching { getSystemService(KeyguardManager::class.java).isKeyguardLocked }.getOrDefault(false),
            accessibilityOn = CompanionState.accessibilityOn.value,
            androidVersion = Build.VERSION.RELEASE,
            model = Build.MODEL,
        )
        if (next == previous) return
        health = next
        session?.healthChanged()
    }

    /** Dial again as soon as a network is back or the phone moved to another one. */
    private fun watchNetwork() {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                val action = synchronized(networkRedial) {
                    networkRedial.onAvailable(network.networkHandle, CompanionState.relay.value)
                }
                when (action) {
                    NetworkRedial.Action.REDIAL -> session?.redial("network back")
                    // Connected: never dropped on a callback alone, only if a ping gets no answer.
                    NetworkRedial.Action.PROBE -> session?.probe("network change")
                    NetworkRedial.Action.NONE -> Unit
                }
            }

            override fun onLost(network: Network) {
                synchronized(networkRedial) { networkRedial.onLost(network.networkHandle) }
            }
        }
        val registered = runCatching {
            getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(callback)
        }.isSuccess
        if (registered) networkCallback = callback
    }

    private fun unwatchNetwork() {
        networkCallback?.let { runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } }
        networkCallback = null
    }

    private fun goForeground(withCapture: Boolean) {
        val type = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ->
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or
                    (if (withCapture) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0)
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && withCapture ->
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            else -> 0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), type)
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, CompanionService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
        )
        val connected = CompanionState.relay.value is RelayStatus.Connected
        val text = when {
            !connected -> getString(R.string.status_reconnecting)
            CompanionState.switchOn.value -> getString(R.string.notification_controlling)
            else -> getString(R.string.notification_connected_off)
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(0, getString(R.string.action_stop), stop)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun deviceName(): String =
        Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() } ?: Build.MODEL

    companion object {
        const val ACTION_PAIR = "com.aionui.companion.PAIR"
        const val ACTION_START = "com.aionui.companion.START"
        const val ACTION_CONSENT = "com.aionui.companion.CONSENT"
        const val ACTION_STOP = "com.aionui.companion.STOP"
        const val ACTION_UNPAIR = "com.aionui.companion.UNPAIR"
        const val ACTION_UPDATE_CHECK = "com.aionui.companion.UPDATE_CHECK"
        const val ACTION_UPDATE_INSTALL = "com.aionui.companion.UPDATE_INSTALL"
        const val EXTRA_HOST = "host"
        const val EXTRA_CODE = "code"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        private const val CHANNEL_ID = "session"
        private const val NOTIFICATION_ID = 1
        private const val STOP_FLUSH_MS = 700L
        private const val LOCK_RENEW_MS = 5 * 60_000L
        private const val LOCK_TIMEOUT_MS = 12 * 60_000L
        private const val EVENT_SWITCH_OFF = "local_switch_off"

        fun intent(context: Context, action: String): Intent = Intent(context, CompanionService::class.java).setAction(action)
    }
}
