package com.aionui.companion.relay

/**
 * Decides when a change of the phone's network means "dial again now". Plain Kotlin,
 * unit-tested; the service feeds it ConnectivityManager's default-network callbacks.
 *
 * - Waiting out a backoff and a network appears → dial now instead of in up to 60 s.
 * - The default network changed (Wi-Fi → mobile) → the socket was bound to the old one
 *   and is dead even if no error arrived yet → dial again.
 * - The first callback after registering (the network we already use) → nothing.
 */
class NetworkRedial {
    private var current: Long? = null

    /** A default network is available; true = redial now. */
    fun onAvailable(network: Long, status: RelayStatus): Boolean {
        val previous = current
        current = network
        return when (status) {
            is RelayStatus.Retrying -> true
            is RelayStatus.Connected, RelayStatus.Connecting -> previous != null && previous != network
            RelayStatus.Stopped, is RelayStatus.NeedsPairing -> false
        }
    }

    /** The default network went away (a later onAvailable for any network redials). */
    fun onLost(network: Long) {
        if (current == network) current = LOST
    }

    private companion object {
        /** No network: any network that follows counts as a change. */
        const val LOST = Long.MIN_VALUE
    }
}
