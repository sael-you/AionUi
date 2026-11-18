package com.aionui.companion.relay

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkRedialTest {
    private val connected = RelayStatus.Connected("c1")
    private val retrying = RelayStatus.Retrying(30_000, "no route")

    @Test
    fun `the first callback - the network already in use - does not redial`() {
        val watch = NetworkRedial()
        assertFalse(watch.onAvailable(1, RelayStatus.Connecting))
        assertFalse(watch.onAvailable(1, connected))
    }

    @Test
    fun `a network while waiting out a backoff redials at once`() {
        val watch = NetworkRedial()
        assertTrue(watch.onAvailable(1, retrying))
    }

    @Test
    fun `a different default network redials - the socket belonged to the old one`() {
        val watch = NetworkRedial()
        watch.onAvailable(1, connected)
        assertTrue(watch.onAvailable(2, connected))
        assertFalse(watch.onAvailable(2, connected))
    }

    @Test
    fun `losing the network and getting the same one back redials`() {
        val watch = NetworkRedial()
        watch.onAvailable(1, connected)
        watch.onLost(1)
        assertTrue(watch.onAvailable(1, connected))
    }

    @Test
    fun `losing a network that is not the current one changes nothing`() {
        val watch = NetworkRedial()
        watch.onAvailable(2, connected)
        watch.onLost(1)
        assertFalse(watch.onAvailable(2, connected))
    }

    @Test
    fun `a stopped or unpaired session is never redialled`() {
        val watch = NetworkRedial()
        watch.onAvailable(1, RelayStatus.Stopped)
        assertFalse(watch.onAvailable(2, RelayStatus.Stopped))
        assertFalse(watch.onAvailable(3, RelayStatus.NeedsPairing("DEVICE_REVOKED")))
    }
}
