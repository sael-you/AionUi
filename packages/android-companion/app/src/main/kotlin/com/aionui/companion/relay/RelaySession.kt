package com.aionui.companion.relay

import com.aionui.companion.protocol.Frames
import com.aionui.companion.protocol.Health
import com.aionui.companion.protocol.Inbound
import com.aionui.companion.protocol.OpenError
import com.aionui.companion.protocol.PhoneInfo
import com.aionui.companion.protocol.Relay
import com.aionui.companion.protocol.VerbError
import com.aionui.companion.update.UpdateOffer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** How this phone proves who it is: a one-time pairing code, then the stored token. */
sealed interface Credentials {
    data class Code(val code: String, val name: String) : Credentials
    data class Token(val token: String) : Credentials
}

sealed interface RelayStatus {
    data object Stopped : RelayStatus
    data object Connecting : RelayStatus
    data class Connected(val clientId: String) : RelayStatus
    data class Retrying(val inMs: Long, val reason: String) : RelayStatus
    /** The pairing is gone (revoked, or the code was wrong): pair again from AionUi. */
    data class NeedsPairing(val code: String) : RelayStatus
}

sealed interface VerbResult {
    data class Ok(val result: JsonElement?) : VerbResult
    data class Failed(val code: String, val message: String) : VerbResult
}

/** Runs the verbs core asks for. `reply` may be called from any thread, once. */
interface VerbHandler {
    fun handle(verb: String, args: JsonObject, reply: (VerbResult) -> Unit)
    /** Core's `stop`: cancel whatever runs now (never flips the owner's switch). */
    fun stopAll()
}

interface SessionCallbacks {
    fun status(status: RelayStatus)
    /** Pairing succeeded: keep the token (core sends it exactly once). */
    fun paired(token: String, clientId: String)
    /** The stored token is no longer valid: forget it. */
    fun forgetToken()
    fun phone(): PhoneInfo
    /** Battery, lock screen, accessibility: for `health` in the first frame and the `health` event. */
    fun health(): Health? = null
    /** Core says a newer build of the app is published. */
    fun updateOffered(offer: UpdateOffer) = Unit
}

/**
 * The companion's side of W2: opens the socket, proves itself (`pair` once, then
 * `hello`), keeps it alive (ping every 20 s, closed after 60 s of silence), answers
 * requests through [VerbHandler] and reconnects with backoff. Everything runs on the
 * [Scheduler]'s thread; socket callbacks are re-posted onto it.
 */
class RelaySession(
    private val url: String,
    private var credentials: Credentials,
    private val version: String,
    /** Sent as `version_code` so core can tell whether a published build is newer. */
    private val versionCode: Int? = null,
    private val sockets: SocketFactory,
    private val scheduler: Scheduler,
    private val handler: VerbHandler,
    private val callbacks: SessionCallbacks,
    private val backoff: Backoff = Backoff(),
) {
    private var socket: RelaySocket? = null
    /** Bumped on every connect: callbacks of an older socket are ignored. */
    private var generation = 0
    private var running = false
    private var welcomed = false
    private var lastFrameAt = 0L
    /** Frames received on any socket: a probe is answered when this moved. */
    private var framesSeen = 0L
    private var openTimer: Cancellable? = null
    private var pingTimer: Cancellable? = null
    private var probeTimer: Cancellable? = null
    private var retry: Cancellable? = null

    var status: RelayStatus = RelayStatus.Stopped
        private set

    fun start() = scheduler.post {
        if (running) return@post
        running = true
        connect()
    }

    /** The owner stopped the session (or unpaired): close and do not reconnect. */
    fun stop() = scheduler.post {
        running = false
        retry?.cancel()
        retry = null
        dropSocket(1000, "stopped")
        setStatus(RelayStatus.Stopped)
    }

    /** The phone's network changed or came back: dial again now, not after the backoff. */
    fun redial(reason: String) = scheduler.post {
        if (!running) return@post
        retry?.cancel()
        retry = null
        dropSocket(1001, reason)
        backoff.reset()
        connect()
    }

    /**
     * Is this socket still alive? One ping now; it is given up only if no frame at all
     * arrives within [Relay.PROBE_TIMEOUT_SECONDS]. A healthy socket, and the requests
     * running on it, are left alone.
     */
    fun probe(reason: String) = scheduler.post {
        if (!running || !welcomed) return@post
        val seen = framesSeen
        val sentOn = generation
        socket?.send(Frames.ping())
        probeTimer?.cancel()
        probeTimer = scheduler.schedule(Relay.PROBE_TIMEOUT_SECONDS * 1000) {
            probeTimer = null
            if (sentOn == generation && framesSeen == seen) lost("no answer after $reason")
        }
    }

    /** Something in the inventory changed (switch, name): tell core now. */
    fun inventoryChanged() = scheduler.post {
        if (welcomed) socket?.send(Frames.inventory(callbacks.phone()))
    }

    /** Battery, lock screen or accessibility changed: tell core. */
    fun healthChanged() = scheduler.post {
        val health = callbacks.health() ?: return@post
        if (welcomed) socket?.send(Frames.health(health))
    }

    /** A whole frame built by `Frames` (update check and progress). */
    fun send(frame: String) = scheduler.post {
        if (welcomed) socket?.send(frame)
    }

    /** A device event for core (`local_switch_off`, `foreground`). */
    fun sendEvent(name: String, data: JsonObject = JsonObject(emptyMap())) = scheduler.post {
        if (welcomed) socket?.send(Frames.event(name, data))
    }

    private fun connect() {
        if (!running) return
        val current = ++generation
        welcomed = false
        setStatus(RelayStatus.Connecting)
        val listener = object : SocketListener {
            override fun onOpen() = scheduler.post { if (current == generation) opened() }
            override fun onText(text: String) = scheduler.post { if (current == generation) received(text) }
            override fun onClosed(code: Int, reason: String) =
                scheduler.post { if (current == generation) lost("closed $code $reason".trim()) }
            override fun onFailure(message: String) = scheduler.post { if (current == generation) lost(message) }
        }
        socket = runCatching { sockets.open(url, listener) }.getOrElse {
            lost(it.message ?: "connect failed")
            null
        }
    }

    private fun opened() {
        lastFrameAt = scheduler.now()
        val first = when (val creds = credentials) {
            is Credentials.Code -> Frames.pair(creds.code, creds.name, version, callbacks.health(), versionCode)
            is Credentials.Token -> Frames.hello(creds.token, version, callbacks.health(), versionCode)
        }
        socket?.send(first)
        // No welcome within 5 s: give up on this socket.
        openTimer = scheduler.schedule(Relay.OPEN_TIMEOUT_SECONDS * 1000) {
            if (!welcomed) lost("no welcome")
        }
        schedulePing()
    }

    private fun schedulePing() {
        pingTimer = scheduler.schedule(Relay.PING_SECONDS * 1000) {
            if (scheduler.now() - lastFrameAt >= Relay.IDLE_CLOSE_SECONDS * 1000) {
                lost("silent for ${Relay.IDLE_CLOSE_SECONDS} s")
                return@schedule
            }
            socket?.send(Frames.ping())
            schedulePing()
        }
    }

    private fun received(text: String) {
        lastFrameAt = scheduler.now()
        framesSeen += 1
        when (val frame = Frames.parse(text)) {
            is Inbound.Welcome -> welcome(frame)
            is Inbound.Error -> refused(frame)
            is Inbound.Request -> request(frame)
            is Inbound.Stop -> handler.stopAll()
            is Inbound.UpdateAvailable -> if (welcomed) callbacks.updateOffered(frame.offer)
            Inbound.Pong, is Inbound.Unknown, null -> Unit
        }
    }

    private fun welcome(frame: Inbound.Welcome) {
        val token = frame.token
        if (credentials is Credentials.Code) {
            if (token.isNullOrEmpty()) {
                lost("welcome without token")
                return
            }
            credentials = Credentials.Token(token)
            callbacks.paired(token, frame.clientId)
        }
        welcomed = true
        backoff.reset()
        setStatus(RelayStatus.Connected(frame.clientId))
        socket?.send(Frames.inventory(callbacks.phone()))
    }

    private fun refused(frame: Inbound.Error) {
        if (frame.code == OpenError.REVOKED || frame.code == OpenError.PAIRING_INVALID) {
            // Retrying cannot help: the owner has to pair again.
            if (frame.code == OpenError.REVOKED || credentials is Credentials.Token) callbacks.forgetToken()
            running = false
            dropSocket(1000, frame.code)
            setStatus(RelayStatus.NeedsPairing(frame.code))
            return
        }
        lost(frame.code)
    }

    private fun request(frame: Inbound.Request) {
        if (!welcomed) return
        if (frame.device != Relay.SELF) {
            socket?.send(Frames.failure(frame.id, VerbError.UNKNOWN_DEVICE, "this companion only serves \"${Relay.SELF}\""))
            return
        }
        if (frame.verb !in Relay.VERBS) {
            socket?.send(Frames.failure(frame.id, VerbError.REFUSED, "verb ${frame.verb} is not served by the companion"))
            return
        }
        val sentOn = generation
        handler.handle(frame.verb, frame.args) { result ->
            scheduler.post {
                // The answer belongs to the socket that asked; a reconnect drops it.
                if (sentOn != generation) return@post
                val text = when (result) {
                    is VerbResult.Ok -> Frames.ok(frame.id, result.result)
                    is VerbResult.Failed -> Frames.failure(frame.id, result.code, result.message)
                }
                if (text.length > Relay.MAX_FRAME_BYTES) {
                    socket?.send(Frames.failure(frame.id, VerbError.FAILED, "result larger than the 16 MiB frame limit"))
                } else {
                    socket?.send(text)
                }
            }
        }
    }

    private fun lost(reason: String) {
        dropSocket(1001, reason)
        if (!running) return
        val delay = backoff.next()
        setStatus(RelayStatus.Retrying(delay, reason))
        retry?.cancel()
        retry = scheduler.schedule(delay) {
            retry = null
            connect()
        }
    }

    private fun dropSocket(code: Int, reason: String) {
        openTimer?.cancel()
        openTimer = null
        pingTimer?.cancel()
        pingTimer = null
        probeTimer?.cancel()
        probeTimer = null
        generation += 1
        welcomed = false
        socket?.close(code, reason.take(120))
        socket = null
    }

    private fun setStatus(next: RelayStatus) {
        status = next
        callbacks.status(next)
    }
}
