package com.aionui.companion.device

import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.HandlerThread
import android.util.DisplayMetrics
import com.aionui.companion.protocol.VerbError
import java.io.ByteArrayOutputStream

/**
 * Screenshots through MediaProjection: the fallback where the Accessibility Service cannot
 * capture (below Android 11). Android asks the owner for consent before
 * every session and the grant is single use, so one capture lives exactly as long
 * as the session: created after consent, released on Stop (or when Android or the
 * owner ends the projection from the status bar).
 */
class ScreenCapture(
    private val projection: MediaProjection,
    metrics: DisplayMetrics,
    private val onEnded: () -> Unit,
) {
    private val width = metrics.widthPixels
    private val height = metrics.heightPixels
    private val thread = HandlerThread("aionui-capture").apply { start() }
    private val handler = Handler(thread.looper)
    private val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
    private val lock = Object()
    private var lastFrame: Bitmap? = null
    private val display: VirtualDisplay

    init {
        // Android 14+: the callback must be registered before the virtual display exists.
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                release()
                onEnded()
            }
        }, handler)
        reader.setOnImageAvailableListener({ source -> keepLatest(source) }, handler)
        display = projection.createVirtualDisplay(
            "aionui-companion",
            width,
            height,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            handler,
        )
    }

    private fun keepLatest(source: ImageReader) {
        val image = source.acquireLatestImage() ?: return
        try {
            val plane = image.planes[0]
            val rowPadding = plane.rowStride - plane.pixelStride * image.width
            val padded = Bitmap.createBitmap(image.width + rowPadding / plane.pixelStride, image.height, Bitmap.Config.ARGB_8888)
            padded.copyPixelsFromBuffer(plane.buffer)
            val frame = if (rowPadding == 0) padded else Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
            synchronized(lock) {
                lastFrame?.recycle()
                lastFrame = frame
            }
        } finally {
            image.close()
        }
    }

    /** The latest frame; PNG at full size, JPEG q80 when scaled down (W2 contract). */
    fun capture(scale: Double, format: String? = null): Screenshot {
        val frame = synchronized(lock) { lastFrame?.copy(Bitmap.Config.ARGB_8888, false) }
            ?: throw VerbException(VerbError.FAILED, "no screen frame yet, try again")
        return encodeScreenshot(frame, scale, format)
    }

    fun release() {
        runCatching { display.release() }
        runCatching { reader.close() }
        runCatching { projection.stop() }
        synchronized(lock) {
            lastFrame?.recycle()
            lastFrame = null
        }
        thread.quitSafely()
    }
}

/** PNG at full size, JPEG q80 when scaled down (W2 contract); [format] `png` / `jpeg` overrides that. */
internal fun encodeScreenshot(frame: Bitmap, scale: Double, format: String? = null): Screenshot {
    val scaled = if (scale < 1.0) {
        Bitmap.createScaledBitmap(frame, (frame.width * scale).toInt().coerceAtLeast(1), (frame.height * scale).toInt().coerceAtLeast(1), true)
    } else {
        frame
    }
    val png = ScreenshotPolicy.png(scale, format)
    val bytes = ByteArrayOutputStream().use { out ->
        scaled.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, if (png) 100 else 80, out)
        out.toByteArray()
    }
    return Screenshot(if (png) "png" else "jpeg", scaled.width, scaled.height, bytes)
}
