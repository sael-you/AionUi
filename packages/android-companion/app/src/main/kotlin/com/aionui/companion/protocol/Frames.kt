package com.aionui.companion.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * W2 device relay frames (TASK-136), as seen by the companion app. The single source
 * of truth is core's `aionui-api-types/src/devices.rs`; this file only restates what
 * the companion sends and understands.
 *
 * Every frame is one text JSON object with a snake_case `"type"`.
 */
object Relay {
    const val PATH = "/api/devices/relay"
    const val KIND = "companion"
    /** The companion's own device id in requests, events and the inventory. */
    const val SELF = "self"
    const val PING_SECONDS = 20L
    const val IDLE_CLOSE_SECONDS = 60L
    const val OPEN_TIMEOUT_SECONDS = 5L
    /** After a network change: how long a connected socket has to answer one ping. */
    const val PROBE_TIMEOUT_SECONDS = 5L
    const val MAX_FRAME_BYTES = 16 * 1024 * 1024

    /** Verbs this app serves (advertised as `capabilities`; core never routes others here). */
    val VERBS = listOf(
        "screenshot", "ui_tree", "tap", "swipe", "text", "key", "global", "launch", "open_url", "foreground",
        "click_text", "set_text", "stop",
    )
}

/** Error codes in `response.error.code`. */
object VerbError {
    const val SWITCH_OFF = "switch_off"
    const val UNKNOWN_DEVICE = "unknown_device"
    const val REFUSED = "refused"
    const val TIMEOUT = "timeout"
    const val BUSY = "busy"
    const val BAD_ARGS = "bad_args"
    const val FAILED = "failed"
}

/** Codes core sends in `error` before it closes the socket. */
object OpenError {
    const val PAIRING_INVALID = "DEVICE_PAIRING_INVALID"
    const val REVOKED = "DEVICE_REVOKED"
    const val BAD_MESSAGE = "DEVICE_BAD_MESSAGE"
    const val ORIGIN_REFUSED = "DEVICE_ORIGIN_REFUSED"
}

/** A frame from core. */
sealed interface Inbound {
    data class Welcome(val clientId: String, val token: String?) : Inbound
    data class Error(val code: String, val message: String?) : Inbound
    /** `id` is echoed back exactly as it came: core sends a JSON number and matches the answer on it. */
    data class Request(val id: JsonPrimitive, val device: String, val verb: String, val args: JsonObject) : Inbound
    data class Stop(val device: String) : Inbound
    data object Pong : Inbound
    /** Anything this version does not know (ignored, never fatal). */
    data class Unknown(val type: String) : Inbound
}

/** What the phone tells core about itself (`inventory.phones[0]`). */
data class PhoneInfo(
    val name: String,
    val model: String?,
    val androidVersion: String?,
    val enabled: Boolean,
)

val RelayJson: Json = Json { ignoreUnknownKeys = true }

object Frames {
    /** Parse one text frame; null when it is not a JSON object with a string `type`. */
    fun parse(text: String): Inbound? {
        val obj = runCatching { RelayJson.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
        val type = obj.string("type") ?: return null
        return when (type) {
            "welcome" -> obj.string("client_id")?.let { Inbound.Welcome(it, obj.string("token")) }
            "error" -> Inbound.Error(obj.string("code") ?: OpenError.BAD_MESSAGE, obj.string("message"))
            "request" -> {
                val id = (obj["id"] as? JsonPrimitive)?.takeIf { it !is JsonNull } ?: return null
                val verb = obj.string("verb") ?: return null
                val args = (obj["args"] as? JsonObject) ?: JsonObject(emptyMap())
                Inbound.Request(id, obj.string("device") ?: Relay.SELF, verb, args)
            }
            "stop" -> Inbound.Stop(obj.string("device") ?: Relay.SELF)
            "pong" -> Inbound.Pong
            else -> Inbound.Unknown(type)
        }
    }

    fun pair(code: String, name: String, version: String, health: Health? = null): String = encode("pair") {
        put("code", code)
        put("kind", Relay.KIND)
        put("name", name)
        put("version", version)
        put("capabilities", capabilities())
        health?.let { put("health", it.toJson()) }
    }

    fun hello(token: String, version: String, health: Health? = null): String = encode("hello") {
        put("token", token)
        put("kind", Relay.KIND)
        put("version", version)
        put("capabilities", capabilities())
        health?.let { put("health", it.toJson()) }
    }

    /** The `health` event: sent whenever a field changed. */
    fun health(health: Health): String = event("health", health.toJson())

    fun inventory(phone: PhoneInfo): String = encode("inventory") {
        put("phones", buildJsonArray {
            add(buildJsonObject {
                put("serial", Relay.SELF)
                put("name", phone.name)
                phone.model?.let { put("model", it) }
                phone.androidVersion?.let { put("android_version", it) }
                put("transport", "self")
                put("chrome", false)
                put("enabled", phone.enabled)
            })
        })
        put("addons", JsonArray(emptyList()))
    }

    fun ok(id: JsonPrimitive, result: JsonElement?): String = encode("response") {
        put("id", id)
        put("ok", true)
        if (result != null) put("result", result)
    }

    fun failure(id: JsonPrimitive, code: String, message: String): String = encode("response") {
        put("id", id)
        put("ok", false)
        put("error", buildJsonObject {
            put("code", code)
            put("message", message)
        })
    }

    fun event(name: String, data: JsonObject = JsonObject(emptyMap())): String = encode("event") {
        put("device", Relay.SELF)
        put("name", name)
        put("data", data)
    }

    fun ping(): String = encode("ping") {}

    private fun capabilities(): JsonArray = JsonArray(Relay.VERBS.map { JsonPrimitive(it) })

    private inline fun encode(type: String, body: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit): String =
        buildJsonObject {
            put("type", type)
            body()
        }.toString()
}

internal fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

internal fun JsonObject.boolean(key: String): Boolean? =
    (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.contentOrNull?.toBooleanStrictOrNull()

internal fun JsonObject.number(key: String): Double? =
    (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.contentOrNull?.toDoubleOrNull()

internal fun JsonElement.asStringOrNull(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.jsonPrimitive?.contentOrNull
