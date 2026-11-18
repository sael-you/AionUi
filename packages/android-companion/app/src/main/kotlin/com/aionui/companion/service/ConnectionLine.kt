package com.aionui.companion.service

import com.aionui.companion.relay.RelayStatus

/** The one status line of the app: Connected / Reconnecting / Offline since. Plain Kotlin, unit-tested. */
sealed interface ConnectionLine {
    data object Connected : ConnectionLine
    data object Reconnecting : ConnectionLine
    /** Trying for a while already: say since when the phone is off the relay. */
    data class OfflineSince(val sinceMs: Long) : ConnectionLine
    data object NotConnected : ConnectionLine
    data object NeedsPairing : ConnectionLine

    companion object {
        /** A blip shorter than this stays "Reconnecting". */
        const val OFFLINE_AFTER_MS = 30_000L

        fun of(status: RelayStatus, offlineSinceMs: Long?, now: Long): ConnectionLine = when (status) {
            is RelayStatus.Connected -> Connected
            is RelayStatus.NeedsPairing -> NeedsPairing
            RelayStatus.Stopped -> NotConnected
            RelayStatus.Connecting, is RelayStatus.Retrying ->
                if (offlineSinceMs != null && now - offlineSinceMs >= OFFLINE_AFTER_MS) OfflineSince(offlineSinceMs) else Reconnecting
        }

        /** When the phone left the relay: kept while it tries, cleared when connected or stopped. */
        fun offlineSince(previous: Long?, status: RelayStatus, now: Long): Long? = when (status) {
            is RelayStatus.Connected, RelayStatus.Stopped, is RelayStatus.NeedsPairing -> null
            RelayStatus.Connecting, is RelayStatus.Retrying -> previous ?: now
        }
    }
}
