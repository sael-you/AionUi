package com.aionui.companion.device

import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.os.Build
import android.os.SystemClock
import com.aionui.companion.protocol.VerbError
import com.aionui.companion.service.CompanionState
import kotlinx.coroutines.delay

/**
 * [DeviceActions] on a real phone: the Accessibility Service (screenshots too, on Android 11+)
 * plus, where it is the only way, the session's MediaProjection capture.
 */
class AndroidDeviceActions(
    private val context: Context,
    private val capture: () -> ScreenCapture?,
) : DeviceActions {

    override fun switchOn(): Boolean = CompanionState.switchOn.value

    private fun service(): ControlAccessibilityService = ControlAccessibilityService.current
        ?: throw VerbException(VerbError.REFUSED, "the AionUi accessibility service is off on the phone")

    @Volatile
    private var lastShotAt: Long? = null

    override suspend fun screenshot(scale: Double, format: String?): Screenshot {
        val projection = capture()
        val accessibility = ControlAccessibilityService.current
        return when (ScreenshotPolicy.source(Build.VERSION.SDK_INT, accessibility != null, projection != null)) {
            ScreenshotPolicy.Source.PROJECTION -> checkNotNull(projection).capture(scale, format)
            ScreenshotPolicy.Source.ACCESSIBILITY -> try {
                accessibilityShot(checkNotNull(accessibility), scale, format)
            } catch (failed: ShotFailedException) {
                if (projection != null && ScreenshotPolicy.mayFallBack(failed.failure)) {
                    projection.capture(scale, format)
                } else {
                    throw ScreenshotPolicy.error(failed.failure)
                }
            }
        }
    }

    private suspend fun accessibilityShot(service: ControlAccessibilityService, scale: Double, format: String?): Screenshot {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) throw ShotFailedException(ShotFailure.INTERNAL)
        // Android refuses screenshots that follow each other too closely: wait out the rest.
        delay(ScreenshotPolicy.waitMs(lastShotAt, SystemClock.elapsedRealtime()))
        val bitmap = try {
            service.screenshot()
        } finally {
            lastShotAt = SystemClock.elapsedRealtime()
        }
        try {
            if (ScreenshotPolicy.isBlanked(samplesOf(bitmap))) throw ScreenshotPolicy.protectedScreen()
            return encodeScreenshot(bitmap, scale, format)
        } finally {
            bitmap.recycle()
        }
    }

    /** An 8 × 8 grid of pixels over the whole image. */
    private fun samplesOf(bitmap: android.graphics.Bitmap): IntArray {
        val grid = 8
        return IntArray(grid * grid) { index ->
            val x = ((index % grid) + 0.5) * bitmap.width / grid
            val y = ((index / grid) + 0.5) * bitmap.height / grid
            bitmap.getPixel(x.toInt().coerceIn(0, bitmap.width - 1), y.toInt().coerceIn(0, bitmap.height - 1))
        }
    }

    override suspend fun uiTree(): UiTreeDump {
        val tree = service().tree()
        return UiTreeXml.render(tree.roots, cut = tree.cut)
    }

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

    override suspend fun clickText(text: String, index: Int): TextClick = service().clickText(text, index)

    override suspend fun setText(value: String) = service().setText(value)

    override suspend fun key(code: Int) = service().pressKey(code)

    override suspend fun global(action: String) = service().global(action)

    override suspend fun openUrl(url: String) {
        val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            (ControlAccessibilityService.current ?: context).startActivity(intent)
        } catch (_: android.content.ActivityNotFoundException) {
            throw VerbException(VerbError.FAILED, "no app on the phone opens this link")
        }
    }

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
