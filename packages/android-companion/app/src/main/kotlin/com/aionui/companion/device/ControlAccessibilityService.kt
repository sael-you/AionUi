package com.aionui.companion.device

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.Display
import androidx.annotation.RequiresApi
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.aionui.companion.protocol.VerbError
import com.aionui.companion.service.CompanionState
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Android's accessibility screenshot did not deliver; the caller decides about the fallback. */
class ShotFailedException(val failure: ShotFailure) : Exception(failure.name)

/**
 * The Accessibility Service the owner turns on (Settings → Accessibility; sideloaded
 * apps first need "Allow restricted settings", see README). It reads the screen's
 * accessibility tree, takes screenshots (Android 11+) and performs gestures, text entry and global keys — only for
 * requests that passed the owner's switch here and core's checks.
 */
class ControlAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        current = this
        CompanionState.setAccessibilityOn(true)
    }

    override fun onDestroy() {
        if (current === this) current = null
        CompanionState.setAccessibilityOn(false)
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        // Our own overlay and screens are not "the app the agent is in".
        if (pkg == packageName) return
        CompanionState.setForeground(pkg)
    }

    override fun onInterrupt() = Unit

    /** All window roots, top window first. */
    fun tree(): List<NodeView> {
        val roots = runCatching { windows.mapNotNull { it.root } }.getOrDefault(emptyList())
            .ifEmpty { listOfNotNull(rootInActiveWindow) }
        return roots.map { toView(it, 0) }
    }

    private fun toView(node: AccessibilityNodeInfo, depth: Int): NodeView {
        val bounds = Rect().also { node.getBoundsInScreen(it) }
        val children = if (depth >= UiTreeXml.MAX_DEPTH) {
            emptyList()
        } else {
            (0 until node.childCount).mapNotNull { node.getChild(it) }.map { toView(it, depth + 1) }
        }
        return NodeView(
            text = node.text?.toString(),
            resourceId = node.viewIdResourceName,
            className = node.className?.toString(),
            packageName = node.packageName?.toString(),
            contentDescription = node.contentDescription?.toString(),
            checkable = node.isCheckable,
            checked = node.isChecked,
            clickable = node.isClickable,
            enabled = node.isEnabled,
            focusable = node.isFocusable,
            focused = node.isFocused,
            scrollable = node.isScrollable,
            longClickable = node.isLongClickable,
            password = node.isPassword,
            selected = node.isSelected,
            left = bounds.left,
            top = bounds.top,
            right = bounds.right,
            bottom = bounds.bottom,
            children = children,
        )
    }

    suspend fun gesture(path: Path, durationMs: Long) {
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceAtLeast(1))
        val description = GestureDescription.Builder().addStroke(stroke).build()
        val done = suspendCancellableCoroutine { continuation ->
            val accepted = dispatchGesture(
                description,
                object : GestureResultCallback() {
                    override fun onCompleted(gestureDescription: GestureDescription?) {
                        if (continuation.isActive) continuation.resume(true)
                    }

                    override fun onCancelled(gestureDescription: GestureDescription?) {
                        if (continuation.isActive) continuation.resume(false)
                    }
                },
                null,
            )
            if (!accepted && continuation.isActive) continuation.resume(false)
        }
        if (!done) throw VerbException(VerbError.FAILED, "the gesture was cancelled")
    }

    /** Type into the focused field (appends, like `adb shell input text`). */
    fun typeText(value: String) {
        val field = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: throw VerbException(VerbError.FAILED, "no text field has the focus")
        if (!field.isEditable) throw VerbException(VerbError.FAILED, "the focused element is not editable")
        val showingHint = field.isShowingHintText
        val existing = if (showingHint || field.isPassword) "" else field.text?.toString().orEmpty()
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, existing + value)
        }
        if (!field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
            throw VerbException(VerbError.FAILED, "the field refused the text")
        }
    }

    /**
     * The screen as Android's accessibility screenshot gives it: no "share your screen"
     * prompt. Protected windows come back blanked (see [ScreenshotPolicy.isBlanked]).
     */
    @RequiresApi(Build.VERSION_CODES.R)
    suspend fun screenshot(): Bitmap = suspendCancellableCoroutine { continuation ->
        takeScreenshot(
            Display.DEFAULT_DISPLAY,
            mainExecutor,
            object : TakeScreenshotCallback {
                override fun onSuccess(screenshot: ScreenshotResult) {
                    val buffer = screenshot.hardwareBuffer
                    // A software copy: the hardware buffer goes back to Android right away.
                    val bitmap = runCatching {
                        Bitmap.wrapHardwareBuffer(buffer, screenshot.colorSpace)?.copy(Bitmap.Config.ARGB_8888, false)
                    }.getOrNull()
                    buffer.close()
                    if (!continuation.isActive) {
                        bitmap?.recycle()
                    } else if (bitmap == null) {
                        continuation.resumeWithException(ShotFailedException(ShotFailure.INTERNAL))
                    } else {
                        continuation.resume(bitmap)
                    }
                }

                override fun onFailure(errorCode: Int) {
                    if (continuation.isActive) continuation.resumeWithException(ShotFailedException(failureOf(errorCode)))
                }
            },
        )
    }

    private fun failureOf(errorCode: Int): ShotFailure = when (errorCode) {
        ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT -> ShotFailure.TOO_SOON
        ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS -> ShotFailure.NO_ACCESS
        ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY -> ShotFailure.INVALID_DISPLAY
        ERROR_TAKE_SCREENSHOT_SECURE_WINDOW -> ShotFailure.SECURE_WINDOW
        else -> ShotFailure.INTERNAL
    }

    /**
     * Click the element whose text or description is exactly [wanted]: the node itself or
     * its nearest clickable parent; when nothing takes the click, focus it and tap its centre.
     */
    suspend fun clickText(wanted: String, index: Int): TextClick {
        val roots = runCatching { windows.mapNotNull { it.root } }.getOrDefault(emptyList())
            .ifEmpty { listOfNotNull(rootInActiveWindow) }
        // Android's search is a case-insensitive "contains" over text and description: narrowed below.
        val nodes = roots.flatMap { it.findAccessibilityNodeInfosByText(wanted.trim()).orEmpty() }
        val usable = TextTarget.usable(
            wanted,
            nodes.map { TextCandidate(it.text?.toString(), it.contentDescription?.toString(), it.isVisibleToUser, it.isEnabled) },
        )
        if (usable.isEmpty()) throw VerbException(VerbError.FAILED, "no visible, enabled element has exactly this text")
        if (index >= usable.size) {
            throw VerbException(VerbError.BAD_ARGS, "index $index is out of range: ${usable.size} element(s) match")
        }
        val node = nodes[usable[index]]
        var target: AccessibilityNodeInfo? = node
        var depth = 0
        while (target != null && depth < CLICK_PARENT_DEPTH) {
            if (target.isClickable && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                return TextClick(usable.size, "click")
            }
            target = target.parent
            depth += 1
        }
        node.performAction(AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS)
        val bounds = Rect().also { node.getBoundsInScreen(it) }
        if (bounds.isEmpty) throw VerbException(VerbError.FAILED, "the element has no place on the screen to tap")
        gesture(Path().apply { moveTo(bounds.exactCenterX(), bounds.exactCenterY()) }, 50)
        return TextClick(usable.size, "tap")
    }

    /** Replace the content of the focused (else the selected) editable field. */
    fun setText(value: String) {
        val root = rootInActiveWindow
        val field = root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeIf { it.isEditable }
            ?: root?.findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY)?.takeIf { it.isEditable }
            ?: root?.let { selectedEditable(it, 0) }
            ?: throw VerbException(VerbError.FAILED, "no editable field has the focus")
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value) }
        if (!field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
            throw VerbException(VerbError.FAILED, "the field refused the text")
        }
    }

    private fun selectedEditable(node: AccessibilityNodeInfo, depth: Int): AccessibilityNodeInfo? {
        if (node.isEditable && (node.isSelected || node.isFocused)) return node
        if (depth >= UiTreeXml.MAX_DEPTH) return null
        for (index in 0 until node.childCount) {
            val found = node.getChild(index)?.let { selectedEditable(it, depth + 1) }
            if (found != null) return found
        }
        return null
    }

    fun pressKey(code: Int) {
        val done = when (code) {
            Keys.HOME -> performGlobalAction(GLOBAL_ACTION_HOME)
            Keys.BACK -> performGlobalAction(GLOBAL_ACTION_BACK)
            Keys.APP_SWITCH -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            Keys.ENTER -> enterOnFocusedField()
            else -> throw VerbException(VerbError.BAD_ARGS, "key $code is not served")
        }
        if (!done) throw VerbException(VerbError.FAILED, "the key was not accepted")
    }

    private fun enterOnFocusedField(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            throw VerbException(VerbError.REFUSED, "Enter needs Android 11 or newer")
        }
        val field = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        return field.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
    }

    companion object {
        private const val CLICK_PARENT_DEPTH = 8

        @Volatile
        var current: ControlAccessibilityService? = null
            private set
    }
}
