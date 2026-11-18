package com.aionui.companion.relay

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * The real socket: OkHttp WebSocket. It sends no `Origin` header (core refuses any)
 * and never puts the token in the URL.
 */
class OkHttpSockets(private val client: OkHttpClient = defaultClient()) : SocketFactory {
    override fun open(url: String, listener: SocketListener): RelaySocket {
        val request = Request.Builder().url(url).build()
        val socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = listener.onOpen()
            override fun onMessage(webSocket: WebSocket, text: String) = listener.onText(text)
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                listener.onClosed(code, reason)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = listener.onClosed(code, reason)
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
                listener.onFailure(response?.let { "HTTP ${it.code}" } ?: (t.message ?: t.javaClass.simpleName))
        })
        return object : RelaySocket {
            override fun send(text: String): Boolean = socket.send(text)
            override fun close(code: Int, reason: String) {
                socket.close(code, reason)
            }
        }
    }

    companion object {
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            // WebSocket pings next to W2's own ping frames: a dead connection (NAT timeout, a
            // network that went away silently) fails within a minute instead of hanging.
            .pingInterval(30, TimeUnit.SECONDS)
            .build()
    }
}

/** One thread for all session work, in order. */
class ExecutorScheduler(
    private val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "aionui-relay").apply { isDaemon = true }
    },
) : Scheduler {
    override fun post(action: () -> Unit) {
        if (!executor.isShutdown) executor.execute(action)
    }

    override fun schedule(delayMs: Long, action: () -> Unit): Cancellable {
        val future = executor.schedule(action, delayMs, TimeUnit.MILLISECONDS)
        return Cancellable { future.cancel(false) }
    }

    override fun now(): Long = System.currentTimeMillis()

    fun shutdown() = executor.shutdownNow()
}
