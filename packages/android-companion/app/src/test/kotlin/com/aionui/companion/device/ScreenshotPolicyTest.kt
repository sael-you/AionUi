package com.aionui.companion.device

import com.aionui.companion.device.ScreenshotPolicy.Source
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenshotPolicyTest {
    @Test
    fun `Android 11+ uses the accessibility screenshot and needs no consent step`() {
        assertEquals(Source.ACCESSIBILITY, ScreenshotPolicy.source(30, accessibilityOn = true, projectionOn = false))
        assertEquals(Source.ACCESSIBILITY, ScreenshotPolicy.source(35, accessibilityOn = true, projectionOn = true))
        assertFalse(ScreenshotPolicy.needsConsent(30))
        assertFalse(ScreenshotPolicy.needsConsent(35))
    }

    @Test
    fun `below Android 11 MediaProjection is the only way and consent is part of onboarding`() {
        assertTrue(ScreenshotPolicy.needsConsent(29))
        assertEquals(Source.PROJECTION, ScreenshotPolicy.source(29, accessibilityOn = true, projectionOn = true))
        val refused = assertThrows(VerbException::class.java) { ScreenshotPolicy.source(29, true, projectionOn = false) }
        assertEquals("refused", refused.code)
        assertEquals("screen capture consent needed", refused.message)
    }

    @Test
    fun `with the accessibility service off a live projection still serves, else it says what is off`() {
        assertEquals(Source.PROJECTION, ScreenshotPolicy.source(34, accessibilityOn = false, projectionOn = true))
        val refused = assertThrows(VerbException::class.java) { ScreenshotPolicy.source(34, false, false) }
        assertEquals("refused", refused.code)
        assertTrue(refused.message.contains("accessibility service is off"))
    }

    @Test
    fun `keeps Android's minimum interval between accessibility screenshots`() {
        assertEquals(0, ScreenshotPolicy.waitMs(null, 1_000))
        assertEquals(350, ScreenshotPolicy.waitMs(1_000, 1_000))
        assertEquals(250, ScreenshotPolicy.waitMs(1_000, 1_100))
        assertEquals(0, ScreenshotPolicy.waitMs(1_000, 1_350))
        assertEquals(0, ScreenshotPolicy.waitMs(1_000, 9_000))
        // A clock that went backwards never waits longer than the interval.
        assertEquals(350, ScreenshotPolicy.waitMs(5_000, 1_000))
    }

    @Test
    fun `too soon is busy and a protected window is refused - neither falls back`() {
        assertEquals("busy", ScreenshotPolicy.error(ShotFailure.TOO_SOON).code)
        assertFalse(ScreenshotPolicy.mayFallBack(ShotFailure.TOO_SOON))
        val secure = ScreenshotPolicy.error(ShotFailure.SECURE_WINDOW)
        assertEquals("refused", secure.code)
        assertTrue(secure.message.startsWith("protected screen"))
        assertFalse(ScreenshotPolicy.mayFallBack(ShotFailure.SECURE_WINDOW))
    }

    @Test
    fun `a service that cannot capture may fall back to MediaProjection`() {
        for (failure in listOf(ShotFailure.NO_ACCESS, ShotFailure.INVALID_DISPLAY, ShotFailure.INTERNAL)) {
            assertTrue(ScreenshotPolicy.mayFallBack(failure))
        }
        assertEquals("refused", ScreenshotPolicy.error(ShotFailure.NO_ACCESS).code)
        assertEquals("failed", ScreenshotPolicy.error(ShotFailure.INTERNAL).code)
    }

    @Test
    fun `a flat black capture is a protected screen, anything else is a picture`() {
        val black = 0xFF000000.toInt()
        assertTrue(ScreenshotPolicy.isBlanked(IntArray(64) { black }))
        assertTrue(ScreenshotPolicy.isBlanked(IntArray(64) { 0 }))
        assertFalse(ScreenshotPolicy.isBlanked(IntArray(64) { if (it == 40) 0xFF101010.toInt() else black }))
        assertFalse(ScreenshotPolicy.isBlanked(IntArray(0)))
        assertEquals("refused", ScreenshotPolicy.protectedScreen().code)
    }
}
