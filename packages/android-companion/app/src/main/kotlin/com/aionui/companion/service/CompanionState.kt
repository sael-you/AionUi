package com.aionui.companion.service

import android.content.Context
import com.aionui.companion.relay.RelayStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** App-wide state the screens, the service and the accessibility service share. */
object CompanionState {
    private const val PREFS = "companion_state"
    private const val KEY_SWITCH = "agents_allowed"
    private const val KEY_KEEP = "keep_connected"

    private val _switchOn = MutableStateFlow(false)
    /** The owner's own switch: "Agents may use this phone". Off by default. */
    val switchOn: StateFlow<Boolean> = _switchOn.asStateFlow()

    private val _relay = MutableStateFlow<RelayStatus>(RelayStatus.Stopped)
    val relay: StateFlow<RelayStatus> = _relay.asStateFlow()

    private val _offlineSince = MutableStateFlow<Long?>(null)
    /** When the phone left the relay while it keeps trying; null when connected or stopped. */
    val offlineSince: StateFlow<Long?> = _offlineSince.asStateFlow()

    private val _accessibilityOn = MutableStateFlow(false)
    val accessibilityOn: StateFlow<Boolean> = _accessibilityOn.asStateFlow()

    private val _captureOn = MutableStateFlow(false)
    /** This session's screen-capture consent is live. */
    val captureOn: StateFlow<Boolean> = _captureOn.asStateFlow()

    private val _foreground = MutableStateFlow<String?>(null)
    val foreground: StateFlow<String?> = _foreground.asStateFlow()

    fun load(context: Context) {
        _switchOn.value = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_SWITCH, false)
    }

    fun setSwitch(context: Context, on: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_SWITCH, on).apply()
        _switchOn.value = on
    }

    fun setRelay(status: RelayStatus) {
        _offlineSince.value = ConnectionLine.offlineSince(_offlineSince.value, status, System.currentTimeMillis())
        _relay.value = status
    }

    /**
     * The owner wants this phone on the relay (paired or pressed Start, and did not press
     * Stop): what a restart of the service, a reboot or an app update brings back.
     */
    fun keepConnected(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_KEEP, false)

    fun setKeepConnected(context: Context, keep: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_KEEP, keep).apply()
    }

    fun setAccessibilityOn(on: Boolean) {
        _accessibilityOn.value = on
    }

    fun setCaptureOn(on: Boolean) {
        _captureOn.value = on
    }

    fun setForeground(pkg: String) {
        _foreground.value = pkg
    }
}
