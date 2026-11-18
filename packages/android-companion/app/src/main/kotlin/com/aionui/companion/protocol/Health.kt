package com.aionui.companion.protocol

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * How the phone is doing, for the Devices card ("locked · 5 % battery"). Sent as
 * `health` in `pair` / `hello` and as the `health` event whenever a field changes.
 */
data class Health(
    /** 0..100; null when Android does not say. */
    val batteryPercent: Int?,
    val charging: Boolean?,
    /** The lock screen is up. */
    val locked: Boolean,
    val accessibilityOn: Boolean,
    val androidVersion: String?,
    val model: String?,
) {
    fun toJson(): JsonObject = buildJsonObject {
        batteryPercent?.let { put("battery_percent", it) }
        charging?.let { put("charging", it) }
        put("locked", locked)
        put("accessibility_on", accessibilityOn)
        androidVersion?.let { put("android_version", it) }
        model?.let { put("model", it) }
    }

    companion object {
        /** Battery level as Android reports it (`level` of `scale`) → 0..100, null when unknown. */
        fun percent(level: Int, scale: Int): Int? =
            if (level < 0 || scale <= 0) null else (level * 100 / scale).coerceIn(0, 100)
    }
}
