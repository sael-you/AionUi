package com.aionui.companion.relay

/** One open relay socket. */
interface RelaySocket {
    /** False when the frame could not be queued (socket gone). */
    fun send(text: String): Boolean
    fun close(code: Int, reason: String)
}

/** Socket callbacks, always delivered on the session's own thread by the session. */
interface SocketListener {
    fun onOpen()
    fun onText(text: String)
    fun onClosed(code: Int, reason: String)
    fun onFailure(message: String)
}

fun interface SocketFactory {
    fun open(url: String, listener: SocketListener): RelaySocket
}

fun interface Cancellable {
    fun cancel()
}

/** Runs actions later and in order, on one thread (real) or by hand (tests). */
interface Scheduler {
    fun post(action: () -> Unit)
    fun schedule(delayMs: Long, action: () -> Unit): Cancellable
    fun now(): Long
}

/** Reconnect delays: 1 s, 2 s, 4 s … capped at 60 s, with ±20 % jitter. */
class Backoff(
    private val baseMs: Long = 1_000,
    private val maxMs: Long = 60_000,
    private val jitter: () -> Double = { Math.random() },
) {
    private var attempt = 0

    fun next(): Long {
        val raw = (baseMs shl attempt.coerceAtMost(16)).coerceAtMost(maxMs)
        attempt += 1
        val factor = 0.8 + 0.4 * jitter()
        return (raw * factor).toLong().coerceIn(1, maxMs)
    }

    fun reset() {
        attempt = 0
    }
}
