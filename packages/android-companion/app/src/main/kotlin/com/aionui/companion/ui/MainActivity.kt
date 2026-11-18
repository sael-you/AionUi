package com.aionui.companion.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.format.DateFormat
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.aionui.companion.BuildConfig
import com.aionui.companion.R
import com.aionui.companion.device.ControlAccessibilityService
import com.aionui.companion.device.ScreenshotPolicy
import com.aionui.companion.protocol.PairingPayload
import com.aionui.companion.service.CompanionService
import com.aionui.companion.service.ConnectionLine
import com.aionui.companion.service.CompanionState
import com.aionui.companion.store.TokenStore
import com.aionui.companion.update.UpdateCenter
import com.aionui.companion.update.UpdateMode
import com.aionui.companion.update.UpdateState
import com.google.android.material.button.MaterialButton
import com.google.android.material.button.MaterialButtonToggleGroup
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.android.material.textfield.TextInputEditText
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/** Pairing, the owner's switch, the session and the permission checklist. */
class MainActivity : AppCompatActivity() {
    private lateinit var tokens: TokenStore
    private val host by lazy { findViewById<TextInputEditText>(R.id.pair_host) }
    private val code by lazy { findViewById<TextInputEditText>(R.id.pair_code) }
    private val agentSwitch by lazy { findViewById<MaterialSwitch>(R.id.agent_switch) }

    private val scan = registerForActivityResult(ScanContract()) { result ->
        val text = result.contents ?: return@registerForActivityResult
        val payload = PairingPayload.parseQr(text)
        if (payload == null) {
            Toast.makeText(this, R.string.not_a_pairing_code, Toast.LENGTH_LONG).show()
        } else {
            fill(payload)
        }
    }

    private val consent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        // Declined: the session runs without screenshots (agents get "screen capture consent needed").
        if (result.resultCode != RESULT_OK || data == null) return@registerForActivityResult
        ContextCompat.startForegroundService(
            this,
            CompanionService.intent(this, CompanionService.ACTION_CONSENT)
                .putExtra(CompanionService.EXTRA_RESULT_CODE, result.resultCode)
                .putExtra(CompanionService.EXTRA_RESULT_DATA, data),
        )
    }

    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        tokens = TokenStore(this)
        CompanionState.load(this)

        findViewById<TextView>(R.id.version).text =
            getString(R.string.version_label, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE)
        findViewById<MaterialButton>(R.id.pair_scan).setOnClickListener {
            scan.launch(
                ScanOptions()
                    .setCaptureActivity(ScanActivity::class.java)
                    .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                    .setPrompt(getString(R.string.scan_prompt))
                    .setBeepEnabled(false)
                    .setOrientationLocked(false),
            )
        }
        findViewById<MaterialButton>(R.id.pair_button).setOnClickListener { pair() }
        findViewById<MaterialButton>(R.id.unpair).setOnClickListener { confirmUnpair() }
        findViewById<MaterialButton>(R.id.session_start).setOnClickListener { startSession() }
        findViewById<MaterialButton>(R.id.session_stop).setOnClickListener {
            startService(CompanionService.intent(this, CompanionService.ACTION_STOP))
        }
        agentSwitch.setOnCheckedChangeListener { _, checked ->
            if (checked != CompanionState.switchOn.value) CompanionState.setSwitch(this, checked)
        }
        findViewById<MaterialButton>(R.id.open_accessibility).setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        findViewById<MaterialButton>(R.id.open_app_info).setOnClickListener {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
        }
        findViewById<MaterialButton>(R.id.open_overlay).setOnClickListener {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.fromParts("package", packageName, null)))
        }
        findViewById<MaterialButton>(R.id.open_notifications).setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        findViewById<MaterialButton>(R.id.open_battery).setOnClickListener { openBatterySettings() }
        findViewById<MaterialButton>(R.id.open_install).setOnClickListener {
            runCatching {
                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.fromParts("package", packageName, null)))
            }
        }
        val modes = findViewById<MaterialButtonToggleGroup>(R.id.update_mode)
        modes.check(buttonOf(CompanionState.updateMode(this)))
        modes.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (isChecked) CompanionState.setUpdateMode(this, modeOf(checkedId))
        }
        findViewById<MaterialButton>(R.id.update_check).setOnClickListener {
            runCatching { startService(CompanionService.intent(this, CompanionService.ACTION_UPDATE_CHECK)) }
        }
        findViewById<MaterialButton>(R.id.update_install).setOnClickListener { installUpdate() }
        // The capture consent only exists where the accessibility screenshot does not.
        findViewById<View>(R.id.consent_hint).visibility = if (needsConsent()) View.VISIBLE else View.GONE

        handleDeepLink(intent)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                combine(
                    CompanionState.relay,
                    CompanionState.switchOn,
                    CompanionState.captureOn,
                    CompanionState.offlineSince,
                    CompanionState.update,
                ) { _, _, _, _, _ -> }
                    .collect { render() }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    /** A pairing QR opened by the phone's camera app: fill the fields, the owner taps Pair. */
    private fun handleDeepLink(intent: Intent?) {
        val data = intent?.dataString ?: return
        PairingPayload.parseQr(data)?.let { fill(it) }
    }

    private fun fill(payload: PairingPayload) {
        host.setText(payload.host)
        code.setText(payload.code)
    }

    private fun pair() {
        val payload = PairingPayload.of(host.text?.toString().orEmpty(), code.text?.toString().orEmpty())
        if (payload == null) {
            Toast.makeText(this, R.string.pair_invalid, Toast.LENGTH_LONG).show()
            return
        }
        ContextCompat.startForegroundService(
            this,
            CompanionService.intent(this, CompanionService.ACTION_PAIR)
                .putExtra(CompanionService.EXTRA_HOST, payload.host)
                .putExtra(CompanionService.EXTRA_CODE, payload.code),
        )
    }

    private fun startSession() {
        ContextCompat.startForegroundService(this, CompanionService.intent(this, CompanionService.ACTION_START))
        // Below Android 11 only: Android asks for this session's screen capture (single-use grant).
        if (needsConsent()) consent.launch(getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent())
    }

    private fun buttonOf(mode: UpdateMode): Int = when (mode) {
        UpdateMode.AUTO -> R.id.update_mode_auto
        UpdateMode.ASK -> R.id.update_mode_ask
        UpdateMode.OFF -> R.id.update_mode_off
    }

    private fun modeOf(buttonId: Int): UpdateMode = when (buttonId) {
        R.id.update_mode_ask -> UpdateMode.ASK
        R.id.update_mode_off -> UpdateMode.OFF
        else -> UpdateMode.AUTO
    }

    /** Android's own install question when it waits for the owner; else: start the update that is available. */
    private fun installUpdate() {
        val confirm = UpdateCenter.pendingConfirm
        if (CompanionState.update.value is UpdateState.WaitingConfirm && confirm != null) {
            runCatching { startActivity(confirm) }
        } else {
            runCatching { startService(CompanionService.intent(this, CompanionService.ACTION_UPDATE_INSTALL)) }
        }
    }

    private fun updateLine(state: UpdateState): String = when (state) {
        UpdateState.Idle -> getString(R.string.update_state_idle)
        UpdateState.Checking -> getString(R.string.update_state_checking)
        UpdateState.UpToDate -> getString(R.string.update_state_uptodate)
        is UpdateState.Available -> getString(R.string.update_state_available, state.offer.version)
        is UpdateState.Downloading -> getString(R.string.update_state_downloading, state.offer.version)
        is UpdateState.Verifying -> getString(R.string.update_state_verifying, state.offer.version)
        is UpdateState.Ready -> getString(R.string.update_state_ready, state.offer.version)
        is UpdateState.WaitingConfirm -> getString(R.string.update_state_confirm, state.offer.version)
        is UpdateState.Installing -> getString(R.string.update_state_installing, state.offer.version)
        is UpdateState.Failed -> getString(R.string.update_state_failed, state.reason.code)
    }

    private fun needsConsent(): Boolean = ScreenshotPolicy.needsConsent(Build.VERSION.SDK_INT)

    private fun batteryUnrestricted(): Boolean =
        getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)

    /**
     * Android's own "let this app run in the background" question; the list of apps where it is
     * missing. The app is installed from the owner's own server, not from Play, and has to stay
     * on the relay with the screen off: the case this exemption exists for.
     */
    @SuppressLint("BatteryLife")
    private fun openBatterySettings() {
        val ask = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.fromParts("package", packageName, null))
        val opened = !batteryUnrestricted() && runCatching { startActivity(ask) }.isSuccess
        if (!opened) runCatching { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
    }

    private fun confirmUnpair() {
        MaterialAlertDialogBuilder(this)
            .setMessage(R.string.unpair_confirm)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.unpair) { _, _ ->
                startService(CompanionService.intent(this, CompanionService.ACTION_UNPAIR))
                code.setText("")
            }
            .show()
    }

    private fun render() {
        val pairing = tokens.load()
        findViewById<View>(R.id.pair_section).visibility = if (pairing == null) View.VISIBLE else View.GONE
        findViewById<View>(R.id.session_section).visibility = if (pairing == null) View.GONE else View.VISIBLE
        pairing?.let { findViewById<TextView>(R.id.paired_with).text = getString(R.string.paired_with, it.host) }

        val line = ConnectionLine.of(CompanionState.relay.value, CompanionState.offlineSince.value, System.currentTimeMillis())
        val connection = when (line) {
            ConnectionLine.NotConnected -> getString(R.string.status_stopped)
            ConnectionLine.Reconnecting -> getString(R.string.status_reconnecting)
            ConnectionLine.Connected -> getString(R.string.status_connected)
            is ConnectionLine.OfflineSince ->
                getString(R.string.status_offline_since, DateFormat.getTimeFormat(this).format(line.sinceMs))
            ConnectionLine.NeedsPairing -> getString(R.string.status_needs_pairing)
        }
        // The new build says once, for a day, that it is the result of an update.
        val updatedTo = CompanionState.updatedTo(this, BuildConfig.VERSION_CODE, System.currentTimeMillis())
        findViewById<TextView>(R.id.status).text =
            if (updatedTo == null) connection else getString(R.string.status_updated, connection, updatedTo)
        val update = CompanionState.update.value
        findViewById<TextView>(R.id.update_state).text = updateLine(update)
        findViewById<MaterialButton>(R.id.update_install).apply {
            visibility = if (update is UpdateState.Available || update is UpdateState.WaitingConfirm) View.VISIBLE else View.GONE
        }
        agentSwitch.isChecked = CompanionState.switchOn.value
        findViewById<TextView>(R.id.capture_state).visibility =
            if (needsConsent() && CompanionState.captureOn.value) View.VISIBLE else View.GONE

        setCheck(R.id.accessibility_state, accessibilityEnabled())
        setCheck(R.id.overlay_state, Settings.canDrawOverlays(this))
        setCheck(R.id.notifications_state, notificationsAllowed())
        setCheck(R.id.battery_state, batteryUnrestricted())
        setCheck(R.id.install_state, packageManager.canRequestPackageInstalls())
    }

    private fun setCheck(id: Int, on: Boolean) {
        findViewById<TextView>(id).text = getString(if (on) R.string.check_on else R.string.check_off)
    }

    private fun accessibilityEnabled(): Boolean {
        if (ControlAccessibilityService.current != null) return true
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
        val ours = ComponentName(this, ControlAccessibilityService::class.java).flattenToString()
        return enabled.split(':').any { it.equals(ours, ignoreCase = true) }
    }

    private fun notificationsAllowed(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
}
