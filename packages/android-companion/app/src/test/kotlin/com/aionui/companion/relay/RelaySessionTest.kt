package com.aionui.companion.relay

import com.aionui.companion.protocol.Relay
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RelaySessionTest {
    private val scheduler = ManualScheduler()
    private val sockets = FakeSockets()
    private val callbacks = RecordingCallbacks()
    private val handler = RecordingHandler()

    private fun session(credentials: Credentials = Credentials.Token("tok")) = RelaySession(
        url = "wss://y.example.com/api/devices/relay",
        credentials = credentials,
        version = "0.1.0",
        sockets = sockets,
        scheduler = scheduler,
        handler = handler,
        callbacks = callbacks,
        backoff = Backoff(jitter = { 0.5 }),
    )

    private fun FakeSocket.open() {
        listener.onOpen()
        scheduler.drain()
    }

    private fun FakeSocket.receive(text: String) {
        listener.onText(text)
        scheduler.drain()
    }

    private fun connected(credentials: Credentials = Credentials.Token("tok")): RelaySession {
        val s = session(credentials)
        s.start()
        scheduler.drain()
        sockets.last.open()
        sockets.last.receive("""{"type":"welcome","client_id":"c1"}""")
        return s
    }

    @Test
    fun `pairs with the code once, keeps the token, then sends its inventory`() {
        val s = session(Credentials.Code("ABCD-1234", "Pixel"))
        s.start()
        scheduler.drain()
        val socket = sockets.last
        assertEquals("wss://y.example.com/api/devices/relay", socket.url)
        socket.open()
        assertEquals(listOf("pair"), socket.types())

        socket.receive("""{"type":"welcome","client_id":"c1","token":"secret-token"}""")
        assertEquals("secret-token", callbacks.token)
        assertEquals(RelayStatus.Connected("c1"), s.status)
        assertEquals(listOf("pair", "inventory"), socket.types())

        // The next connection proves itself with the token, not the code again.
        socket.listener.onClosed(1006, "gone")
        scheduler.advance(2_000)
        sockets.last.open()
        val hello = sockets.last.frames().first()
        assertEquals("hello", hello["type"]!!.jsonPrimitive.content)
        assertEquals("secret-token", hello["token"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a welcome to a pairing without a token is not accepted`() {
        val s = session(Credentials.Code("ABCD-1234", "Pixel"))
        s.start()
        scheduler.drain()
        sockets.last.open()
        sockets.last.receive("""{"type":"welcome","client_id":"c1"}""")
        assertNull(callbacks.token)
        assertTrue(s.status is RelayStatus.Retrying)
    }

    @Test
    fun `revoked - forgets the token and stops reconnecting`() {
        val s = session()
        s.start()
        scheduler.drain()
        sockets.last.open()
        sockets.last.receive("""{"type":"error","code":"DEVICE_REVOKED"}""")
        assertEquals(1, callbacks.forgot)
        assertEquals(RelayStatus.NeedsPairing("DEVICE_REVOKED"), s.status)
        assertNotNull(sockets.last.closed)
        scheduler.advance(120_000)
        assertEquals(1, sockets.opened.size)
    }

    @Test
    fun `a wrong pairing code asks to pair again without retrying`() {
        val s = session(Credentials.Code("WRONG", "Pixel"))
        s.start()
        scheduler.drain()
        sockets.last.open()
        sockets.last.receive("""{"type":"error","code":"DEVICE_PAIRING_INVALID"}""")
        assertEquals(RelayStatus.NeedsPairing("DEVICE_PAIRING_INVALID"), s.status)
        scheduler.advance(120_000)
        assertEquals(1, sockets.opened.size)
    }

    @Test
    fun `no welcome within 5 s closes and retries`() {
        val s = session()
        s.start()
        scheduler.drain()
        sockets.last.open()
        scheduler.advance(5_000)
        assertNotNull(sockets.opened.first().closed)
        assertTrue(s.status is RelayStatus.Retrying)
    }

    @Test
    fun `reconnects with growing backoff, reset after a welcome`() {
        val s = session()
        s.start()
        scheduler.drain()
        sockets.last.listener.onFailure("down")
        scheduler.drain()
        assertEquals(RelayStatus.Retrying(1_000, "down"), s.status)
        scheduler.advance(1_000)
        sockets.last.listener.onFailure("down")
        scheduler.drain()
        assertEquals(2_000L, (s.status as RelayStatus.Retrying).inMs)
        scheduler.advance(2_000)
        sockets.last.open()
        sockets.last.receive("""{"type":"welcome","client_id":"c1"}""")
        sockets.last.listener.onClosed(1006, "")
        scheduler.drain()
        assertEquals(1_000L, (s.status as RelayStatus.Retrying).inMs)
        assertEquals(3, sockets.opened.size)
    }

    @Test
    fun `pings every 20 s and drops a socket silent for 60 s`() {
        connected()
        val socket = sockets.last
        scheduler.advance(20_000)
        assertEquals("ping", socket.types().last())
        socket.receive("""{"type":"pong"}""")
        scheduler.advance(20_000)
        assertEquals(2, socket.types().count { it == "ping" })
        // No frame for 60 s from here on: closed and retried.
        scheduler.advance(60_000)
        assertNotNull(socket.closed)
        assertTrue(sockets.opened.size >= 1)
    }

    @Test
    fun `answers a request through the handler, on the socket that asked`() {
        connected()
        val socket = sockets.last
        socket.receive("""{"type":"request","id":"r1","device":"self","verb":"tap","args":{"x":1,"y":2}}""")
        assertEquals(listOf("tap"), handler.calls)
        handler.pending.single()(VerbResult.Ok(JsonPrimitive("done")))
        scheduler.drain()
        val response = socket.frames().last()
        assertEquals("response", response["type"]!!.jsonPrimitive.content)
        assertEquals("r1", response["id"]!!.jsonPrimitive.content)
        assertTrue(response["ok"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun `an answer after a reconnect is dropped, not sent on the new socket`() {
        connected()
        sockets.last.receive("""{"type":"request","id":"r1","device":"self","verb":"tap","args":{"x":1,"y":2}}""")
        sockets.last.listener.onClosed(1006, "")
        scheduler.advance(1_000)
        sockets.last.open()
        handler.pending.single()(VerbResult.Ok(null))
        scheduler.drain()
        assertTrue(sockets.last.types().none { it == "response" })
    }

    @Test
    fun `refuses another device and verbs it does not serve, without calling the handler`() {
        connected()
        val socket = sockets.last
        socket.receive("""{"type":"request","id":"r1","device":"R5CT123","verb":"tap","args":{}}""")
        socket.receive("""{"type":"request","id":"r2","device":"self","verb":"logcat","args":{}}""")
        val errors = socket.frames().filter { it["type"]!!.jsonPrimitive.content == "response" }
            .map { it["error"]!!.jsonObject["code"]!!.jsonPrimitive.content }
        assertEquals(listOf("unknown_device", "refused"), errors)
        assertTrue(handler.calls.isEmpty())
    }

    @Test
    fun `core's stop cancels running work`() {
        connected()
        sockets.last.receive("""{"type":"stop","device":"self"}""")
        assertEquals(1, handler.stops)
    }

    @Test
    fun `switch changes go out as inventory and events`() {
        val s = connected()
        callbacks.enabled = false
        s.inventoryChanged()
        s.sendEvent("local_switch_off")
        scheduler.drain()
        val frames = sockets.last.frames()
        val inventory = frames.last { it["type"]!!.jsonPrimitive.content == "inventory" }
        assertEquals(false, inventory["phones"]!!.jsonArray.single().jsonObject["enabled"]!!.jsonPrimitive.boolean)
        assertEquals("local_switch_off", frames.last()["name"]!!.jsonPrimitive.content)
    }

    @Test
    fun `stop closes and never reconnects`() {
        val s = connected()
        s.stop()
        scheduler.drain()
        assertEquals(RelayStatus.Stopped, s.status)
        assertNotNull(sockets.last.closed)
        scheduler.advance(300_000)
        assertEquals(1, sockets.opened.size)
    }

    @Test
    fun `frames from a closed socket are ignored`() {
        connected()
        val old = sockets.last
        old.listener.onClosed(1006, "")
        scheduler.drain()
        old.receive("""{"type":"request","id":"late","device":"self","verb":"tap","args":{}}""")
        assertTrue(handler.calls.isEmpty())
    }

    @Test
    fun `backoff caps at 60 s`() {
        val backoff = Backoff(jitter = { 0.5 })
        val delays = (1..10).map { backoff.next() }
        assertEquals(1_000L, delays.first())
        assertEquals(60_000L, delays.last())
        assertTrue(Relay.PING_SECONDS < Relay.IDLE_CLOSE_SECONDS)
    }
}
