package com.aionui.companion.device

import com.aionui.companion.protocol.VerbError

/** Why Android's accessibility screenshot did not deliver (its error codes, named). */
enum class ShotFailure {
    /** Asked again sooner than Android allows. */
    TOO_SOON,
    /** A window that forbids capture (banking apps, password screens). */
    SECURE_WINDOW,
    /** The service lost its screenshot capability. */
    NO_ACCESS,
    INVALID_DISPLAY,
    INTERNAL,
}

/**
 * How the companion takes a screenshot. Plain Kotlin, unit-tested.
 *
 * Default: the Accessibility Service's own screenshot (Android 11+), which needs no
 * "share your screen" prompt. MediaProjection (a prompt per session) is only the
 * fallback: below Android 11, or when the service cannot capture.
 */
object ScreenshotPolicy {
    /** `AccessibilityService.takeScreenshot` exists from API 30. */
    const val ACCESSIBILITY_SHOT_SDK = 30

    /** Android refuses accessibility screenshots closer together than 333 ms. */
    const val MIN_INTERVAL_MS = 350L

    enum class Source { ACCESSIBILITY, PROJECTION }

    /** The capture consent step is only part of onboarding where the fallback is the only way. */
    fun needsConsent(sdk: Int): Boolean = sdk < ACCESSIBILITY_SHOT_SDK

    /** Which capture to use now; refuses with what the owner has to switch on. */
    fun source(sdk: Int, accessibilityOn: Boolean, projectionOn: Boolean): Source = when {
        sdk >= ACCESSIBILITY_SHOT_SDK && accessibilityOn -> Source.ACCESSIBILITY
        projectionOn -> Source.PROJECTION
        sdk >= ACCESSIBILITY_SHOT_SDK ->
            throw VerbException(VerbError.REFUSED, "the AionUi accessibility service is off on the phone")
        else -> throw VerbException(VerbError.REFUSED, "screen capture consent needed")
    }

    /** How long to wait before the next accessibility screenshot so Android's limit is kept. */
    fun waitMs(lastShotAt: Long?, now: Long): Long =
        if (lastShotAt == null) 0 else (MIN_INTERVAL_MS - (now - lastShotAt)).coerceIn(0, MIN_INTERVAL_MS)

    /** A failed accessibility screenshot may be retried through MediaProjection (when one is live). */
    fun mayFallBack(failure: ShotFailure): Boolean = when (failure) {
        ShotFailure.NO_ACCESS, ShotFailure.INVALID_DISPLAY, ShotFailure.INTERNAL -> true
        ShotFailure.TOO_SOON, ShotFailure.SECURE_WINDOW -> false
    }

    /** The W2 error for a failure that is final. */
    fun error(failure: ShotFailure): VerbException = when (failure) {
        ShotFailure.TOO_SOON -> VerbException(VerbError.BUSY, "screenshot rate limit: wait a moment and ask again")
        ShotFailure.SECURE_WINDOW -> VerbException(VerbError.REFUSED, PROTECTED)
        ShotFailure.NO_ACCESS ->
            VerbException(VerbError.REFUSED, "the accessibility service may not take screenshots: switch it off and on again")
        ShotFailure.INVALID_DISPLAY, ShotFailure.INTERNAL -> VerbException(VerbError.FAILED, "Android could not take the screenshot")
    }

    /**
     * A capture of a protected window comes back as one flat black image (Android blanks
     * the window instead of failing). [samples] are pixels spread over the image.
     */
    fun isBlanked(samples: IntArray): Boolean = samples.isNotEmpty() && samples.all { it and 0x00FFFFFF == 0 }

    fun protectedScreen(): VerbException = VerbException(VerbError.REFUSED, PROTECTED)

    private const val PROTECTED = "protected screen: this app does not allow screenshots (or the screen is off)"
}
