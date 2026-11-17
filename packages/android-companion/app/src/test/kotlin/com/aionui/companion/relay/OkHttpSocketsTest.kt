package com.aionui.companion.relay

import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** The real OkHttp socket against a local server: what actually goes over the wire. */
class OkHttpSocketsTest {
    private val server = MockWebServer()

    @After
    fun tearDown() = server.shutdown()

    @Test
    fun `opens without an Origin header or a token in the URL, and carries text frames both ways`() {
        val serverGot = LinkedBlockingQueue<String>()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send("""{"type":"welcome","client_id":"c1"}""")
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                serverGot += text
            }
        }))
        server.start()

        val opened = CountDownLatch(1)
        val clientGot = LinkedBlockingQueue<String>()
        val url = server.url("/api/devices/relay").toString().replace("http://", "ws://")
        val socket = OkHttpSockets().open(url, object : SocketListener {
            override fun onOpen() = opened.countDown()
            override fun onText(text: String) {
                clientGot += text
            }
            override fun onClosed(code: Int, reason: String) = Unit
            override fun onFailure(message: String) = Unit
        })

        assertTrue(opened.await(5, TimeUnit.SECONDS))
        assertTrue(socket.send("""{"type":"hello","token":"tok"}"""))
        assertEquals("""{"type":"hello","token":"tok"}""", serverGot.poll(5, TimeUnit.SECONDS))
        assertEquals("""{"type":"welcome","client_id":"c1"}""", clientGot.poll(5, TimeUnit.SECONDS))

        val upgrade = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertNull("core refuses any Origin header", upgrade.getHeader("Origin"))
        assertEquals("/api/devices/relay", upgrade.path)
        socket.close(1000, "done")
    }
}
