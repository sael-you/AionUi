package com.aionui.companion.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.IntentCompat
import com.aionui.companion.BuildConfig
import com.aionui.companion.R
import com.aionui.companion.device.AndroidDeviceActions
import com.aionui.companion.device.ScreenCapture
import com.aionui.companion.device.VerbDispatcher
import com.aionui.companion.protocol.PairingPayload
import com.aionui.companion.protocol.PhoneInfo
import com.aionui.companion.relay.Credentials
import com.aionui.companion.relay.ExecutorScheduler
import com.aionui.companion.relay.OkHttpSockets
import com.aionui.companion.relay.RelaySession
import com.aionui.companion.relay.RelayStatus
import com.aionui.companion.relay.SessionCallbacks
import com.aionui.companion.store.Pairing
import com.aionui.companion.store.TokenStore
import com.aionui.companion.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The companion session: a foreground service (its notification, with Stop, is
 * always shown while it runs) that keeps the outbound relay socket, answers verbs
 * and holds this session's screen capture. Stop switches agents off at once.
 */
class CompanionService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val scheduler = ExecutorScheduler()
    private lateinit var tokens: TokenStore
    private lateinit var overlay: OverlayChip
    private var session: RelaySession? = null
    private var capture: ScreenCapture? = null
    private lateinit var dispatcher: VerbDispatcher

    override fun onCreate() {
        super.onCreate()
        CompanionState.load(this)
        tokens = TokenStore(this)
        overlay = OverlayChip(this) { ownerStop() }
        dispatcher = VerbDispatcher(AndroidDeviceActions(this) { capture }, scope)
        createChannel()
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
                if (host != null && code != null) pair(host, code)
            }
            ACTION_START -> {
                goForeground(withCapture = capture != null)
                connectWithToken()
            }
            ACTION_CONSENT -> {
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                val data = IntentCompat.getParcelableExtra(intent, EXTRA_RESULT_DATA, Intent::class.java)
                if (data != null) startCapture(resultCode, data)
            }
            ACTION_STOP -> ownerStop()
            ACTION_UNPAIR -> unpair()
            else -> Unit
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        session?.stop()
        session = null
        releaseCapture()
        overlay.hide()
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
        CompanionState.setSwitch(this, false)
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
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification())
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
        val text = when {
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
        const val EXTRA_HOST = "host"
        const val EXTRA_CODE = "code"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        private const val CHANNEL_ID = "session"
        private const val NOTIFICATION_ID = 1
        private const val STOP_FLUSH_MS = 700L
        private const val EVENT_SWITCH_OFF = "local_switch_off"

        fun intent(context: Context, action: String): Intent = Intent(context, CompanionService::class.java).setAction(action)
    }
}
