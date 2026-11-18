package com.aionui.companion.relay

/**
 * Decides what a change of the phone's network means for the relay socket. Plain Kotlin,
 * unit-tested; the service feeds it ConnectivityManager's default-network callbacks.
 *
 * A connected socket is never dropped on a callback alone: Android also reports
 * "lost" / "available" when the app merely goes to the background (0.2.0 redialled there
 * and lost the request in flight). A change while connected only asks for a probe: one
 * ping, and the socket goes only if no answer comes back.
 *
 * - Waiting out a backoff and a network appears → dial now instead of in up to 60 s.
 * - Connected and the default network changed or came back → probe.
 * - The first callback after registering (the network already in use) → nothing.
 */
class NetworkRedial {
    enum class Action { NONE, REDIAL, PROBE }

    private var current: Long? = null

    fun onAvailable(network: Long, status: RelayStatus): Action {
        val previous = current
        current = network
        return when (status) {
            is RelayStatus.Retrying -> Action.REDIAL
            is RelayStatus.Connected -> if (previous != null && previous != network) Action.PROBE else Action.NONE
            // A dial in progress finishes or fails by itself (5 s welcome timeout).
            RelayStatus.Connecting, RelayStatus.Stopped, is RelayStatus.NeedsPairing -> Action.NONE
        }
    }

    /** The default network went away (a later onAvailable for any network counts as a change). */
    fun onLost(network: Long) {
        if (current == network) current = LOST
    }

    private companion object {
        const val LOST = Long.MIN_VALUE
    }
}
