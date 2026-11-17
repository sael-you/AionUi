package com.aionui.companion.device

/** Screen image for `screenshot`. */
data class Screenshot(val format: String, val width: Int, val height: Int, val bytes: ByteArray)

/** A refusal or failure with its W2 error code. */
class VerbException(val code: String, override val message: String) : Exception(message)

/**
 * What the phone can do for an agent. The Android implementation uses the
 * Accessibility Service (tree, gestures, text, global keys, foreground app) and
 * MediaProjection (screenshots, consent asked by Android every session).
 */
interface DeviceActions {
    /** The owner's own switch on the phone ("Agents may use this phone"). */
    fun switchOn(): Boolean
    suspend fun screenshot(scale: Double): Screenshot
    suspend fun uiTree(): String
    suspend fun tap(x: Int, y: Int)
    suspend fun swipe(x1: Int, y1: Int, x2: Int, y2: Int, durationMs: Long)
    suspend fun text(value: String)
    suspend fun key(code: Int)
    suspend fun launch(packageName: String)
    fun foregroundPackage(): String?
    /** Cancel running gestures / captures (core's `stop`). */
    fun cancelAll()
}
