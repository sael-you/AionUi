package com.aionui.companion.device

/** Screen image for `screenshot`. */
data class Screenshot(val format: String, val width: Int, val height: Int, val bytes: ByteArray)

/** How `click_text` clicked: the node itself or a clickable parent (`click`), or a tap on its centre (`tap`). */
data class TextClick(val matches: Int, val method: String)

/** A refusal or failure with its W2 error code. */
class VerbException(val code: String, override val message: String) : Exception(message)

/**
 * What the phone can do for an agent. The Android implementation uses the
 * Accessibility Service (tree, gestures, text, global keys, foreground app and, on
 * Android 11+, screenshots); MediaProjection is only the screenshot fallback.
 */
interface DeviceActions {
    /** The owner's own switch on the phone ("Agents may use this phone"). */
    fun switchOn(): Boolean
    suspend fun screenshot(scale: Double): Screenshot
    suspend fun uiTree(): String
    suspend fun tap(x: Int, y: Int)
    suspend fun swipe(x1: Int, y1: Int, x2: Int, y2: Int, durationMs: Long)
    suspend fun text(value: String)
    /** Click the element whose text (or description) is exactly [text]; [index] picks among several. */
    suspend fun clickText(text: String, index: Int): TextClick
    /** Replace the content of the focused (or selected) editable field. */
    suspend fun setText(value: String)
    suspend fun key(code: Int)
    suspend fun launch(packageName: String)
    fun foregroundPackage(): String?
    /** Cancel running gestures / captures (core's `stop`). */
    fun cancelAll()
}
