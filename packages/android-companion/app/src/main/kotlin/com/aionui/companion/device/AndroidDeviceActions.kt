package com.aionui.companion.device

import android.content.Context
import android.content.Intent
import android.graphics.Path
import com.aionui.companion.protocol.VerbError
import com.aionui.companion.service.CompanionState

/** [DeviceActions] on a real phone: the Accessibility Service plus the session's screen capture. */
class AndroidDeviceActions(
    private val context: Context,
    private val capture: () -> ScreenCapture?,
) : DeviceActions {

    override fun switchOn(): Boolean = CompanionState.switchOn.value

    private fun service(): ControlAccessibilityService = ControlAccessibilityService.current
        ?: throw VerbException(VerbError.REFUSED, "the AionUi accessibility service is off on the phone")

    override suspend fun screenshot(scale: Double): Screenshot {
        val session = capture() ?: throw VerbException(VerbError.REFUSED, "screen capture consent needed")
        return session.capture(scale)
    }

    override suspend fun uiTree(): String = UiTreeXml.render(service().tree())

    override suspend fun tap(x: Int, y: Int) {
        service().gesture(Path().apply { moveTo(x.toFloat(), y.toFloat()) }, 50)
    }

    override suspend fun swipe(x1: Int, y1: Int, x2: Int, y2: Int, durationMs: Long) {
        val path = Path().apply {
            moveTo(x1.toFloat(), y1.toFloat())
            lineTo(x2.toFloat(), y2.toFloat())
        }
        service().gesture(path, durationMs)
    }

    override suspend fun text(value: String) = service().typeText(value)

    override suspend fun key(code: Int) = service().pressKey(code)

    override suspend fun launch(packageName: String) {
        val intent = context.packageManager.getLaunchIntentForPackage(packageName)
            ?: throw VerbException(VerbError.FAILED, "$packageName is not installed or has no launcher screen")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // Started from the accessibility service, which may open activities from the background.
        (ControlAccessibilityService.current ?: context).startActivity(intent)
    }

    override fun foregroundPackage(): String? = CompanionState.foreground.value

    override fun cancelAll() = Unit
}
