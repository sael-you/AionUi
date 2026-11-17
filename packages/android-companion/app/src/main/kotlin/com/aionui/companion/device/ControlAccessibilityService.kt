package com.aionui.companion.device

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.aionui.companion.protocol.VerbError
import com.aionui.companion.service.CompanionState
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * The Accessibility Service the owner turns on (Settings → Accessibility; sideloaded
 * apps first need "Allow restricted settings", see README). It reads the screen's
 * accessibility tree and performs gestures, text entry and global keys — only for
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
        val showingHint = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && field.isShowingHintText
        val existing = if (showingHint || field.isPassword) "" else field.text?.toString().orEmpty()
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, existing + value)
        }
        if (!field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
            throw VerbException(VerbError.FAILED, "the field refused the text")
        }
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
        @Volatile
        var current: ControlAccessibilityService? = null
            private set
    }
}
