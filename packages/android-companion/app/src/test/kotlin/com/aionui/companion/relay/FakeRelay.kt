package com.aionui.companion.relay

import com.aionui.companion.protocol.Health
import com.aionui.companion.protocol.PhoneInfo
import com.aionui.companion.protocol.RelayJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** A hand-driven clock and queue: nothing runs until the test says so. */
class ManualScheduler : Scheduler {
    var time = 0L
    private val queue = ArrayDeque<() -> Unit>()
    private data class Timer(val at: Long, val action: () -> Unit, var cancelled: Boolean = false)
    private val timers = mutableListOf<Timer>()

    override fun post(action: () -> Unit) {
        queue.addLast(action)
    }

    override fun schedule(delayMs: Long, action: () -> Unit): Cancellable {
        val timer = Timer(time + delayMs, action)
        timers += timer
        return Cancellable { timer.cancelled = true }
    }

    override fun now(): Long = time

    fun drain() {
        while (queue.isNotEmpty()) queue.removeFirst().invoke()
    }

    fun advance(ms: Long) {
        val until = time + ms
        while (true) {
            drain()
            val next = timers.filter { !it.cancelled && it.at <= until }.minByOrNull { it.at } ?: break
            timers -= next
            time = next.at
            next.action()
        }
        time = until
        drain()
    }
}

class FakeSocket(val url: String, val listener: SocketListener) : RelaySocket {
    val sent = mutableListOf<String>()
    var closed: Pair<Int, String>? = null

    override fun send(text: String): Boolean {
        if (closed != null) return false
        sent += text
        return true
    }

    override fun close(code: Int, reason: String) {
        closed = code to reason
    }

    fun frames(): List<JsonObject> = sent.map { RelayJson.parseToJsonElement(it).jsonObject }
    fun types(): List<String> = frames().map { it["type"]!!.jsonPrimitive.content }
}

class FakeSockets : SocketFactory {
    val opened = mutableListOf<FakeSocket>()
    val last get() = opened.last()

    override fun open(url: String, listener: SocketListener): RelaySocket = FakeSocket(url, listener).also { opened += it }
}

class RecordingCallbacks(var enabled: Boolean = true) : SessionCallbacks {
    val statuses = mutableListOf<RelayStatus>()
    var token: String? = null
    var forgot = 0

    override fun status(status: RelayStatus) {
        statuses += status
    }

    override fun paired(token: String, clientId: String) {
        this.token = token
    }

    override fun forgetToken() {
        forgot += 1
        token = null
    }

    override fun phone() = PhoneInfo("Pixel", "Pixel 8", "15", enabled)
    var health: Health? = null
    override fun health() = health
}

class RecordingHandler : VerbHandler {
    val calls = mutableListOf<String>()
    val pending = mutableListOf<(VerbResult) -> Unit>()
    var stops = 0

    override fun handle(verb: String, args: JsonObject, reply: (VerbResult) -> Unit) {
        calls += verb
        pending += reply
    }

    override fun stopAll() {
        stops += 1
    }
}
