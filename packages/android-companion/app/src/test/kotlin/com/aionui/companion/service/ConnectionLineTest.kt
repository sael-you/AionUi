package com.aionui.companion.service

import com.aionui.companion.relay.RelayStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ConnectionLineTest {
    private val retrying = RelayStatus.Retrying(4_000, "closed")

    @Test
    fun `connected, not connected and needs pairing are said as they are`() {
        assertEquals(ConnectionLine.Connected, ConnectionLine.of(RelayStatus.Connected("c1"), null, 0))
        assertEquals(ConnectionLine.NotConnected, ConnectionLine.of(RelayStatus.Stopped, null, 0))
        assertEquals(ConnectionLine.NeedsPairing, ConnectionLine.of(RelayStatus.NeedsPairing("x"), 5, 99_999))
    }

    @Test
    fun `a short blip is Reconnecting, a long one says since when it is offline`() {
        assertEquals(ConnectionLine.Reconnecting, ConnectionLine.of(retrying, 1_000, 1_000))
        assertEquals(ConnectionLine.Reconnecting, ConnectionLine.of(RelayStatus.Connecting, 1_000, 30_999))
        assertEquals(ConnectionLine.OfflineSince(1_000), ConnectionLine.of(retrying, 1_000, 31_000))
        assertEquals(ConnectionLine.OfflineSince(1_000), ConnectionLine.of(RelayStatus.Connecting, 1_000, 600_000))
        assertEquals(ConnectionLine.Reconnecting, ConnectionLine.of(retrying, null, 600_000))
    }

    @Test
    fun `offline since starts when the phone leaves the relay and survives the retries`() {
        var since: Long? = null
        since = ConnectionLine.offlineSince(since, RelayStatus.Connecting, 100)
        assertEquals(100L, since)
        since = ConnectionLine.offlineSince(since, retrying, 5_000)
        since = ConnectionLine.offlineSince(since, RelayStatus.Connecting, 9_000)
        assertEquals(100L, since)
        since = ConnectionLine.offlineSince(since, RelayStatus.Connected("c1"), 12_000)
        assertNull(since)
        assertEquals(20_000L, ConnectionLine.offlineSince(since, retrying, 20_000))
        assertNull(ConnectionLine.offlineSince(20_000, RelayStatus.Stopped, 30_000))
    }
}
