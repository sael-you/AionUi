package com.aionui.companion.relay

import com.aionui.companion.relay.NetworkRedial.Action
import org.junit.Assert.assertEquals
import org.junit.Test

class NetworkRedialTest {
    private val connected = RelayStatus.Connected("c1")
    private val retrying = RelayStatus.Retrying(30_000, "no route")

    @Test
    fun `the first callback - the network already in use - does nothing`() {
        val watch = NetworkRedial()
        assertEquals(Action.NONE, watch.onAvailable(1, RelayStatus.Connecting))
        assertEquals(Action.NONE, watch.onAvailable(1, connected))
    }

    @Test
    fun `a network while waiting out a backoff redials at once`() {
        assertEquals(Action.REDIAL, NetworkRedial().onAvailable(1, retrying))
    }

    @Test
    fun `a connected socket is never dropped on a callback - a changed network only probes it`() {
        val watch = NetworkRedial()
        watch.onAvailable(1, connected)
        assertEquals(Action.PROBE, watch.onAvailable(2, connected))
        assertEquals(Action.NONE, watch.onAvailable(2, connected))
    }

    @Test
    fun `lost then available again, as when the app goes to the background, probes and does not redial`() {
        val watch = NetworkRedial()
        watch.onAvailable(1, connected)
        watch.onLost(1)
        assertEquals(Action.PROBE, watch.onAvailable(1, connected))
    }

    @Test
    fun `a dial in progress is left to finish`() {
        val watch = NetworkRedial()
        watch.onAvailable(1, RelayStatus.Connecting)
        assertEquals(Action.NONE, watch.onAvailable(2, RelayStatus.Connecting))
    }

    @Test
    fun `losing a network that is not the current one changes nothing`() {
        val watch = NetworkRedial()
        watch.onAvailable(2, connected)
        watch.onLost(1)
        assertEquals(Action.NONE, watch.onAvailable(2, connected))
    }

    @Test
    fun `a stopped or unpaired session is left alone`() {
        val watch = NetworkRedial()
        watch.onAvailable(1, RelayStatus.Stopped)
        assertEquals(Action.NONE, watch.onAvailable(2, RelayStatus.Stopped))
        assertEquals(Action.NONE, watch.onAvailable(3, RelayStatus.NeedsPairing("DEVICE_REVOKED")))
    }
}
