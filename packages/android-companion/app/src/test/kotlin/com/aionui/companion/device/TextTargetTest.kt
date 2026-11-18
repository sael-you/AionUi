package com.aionui.companion.device

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TextTargetTest {
    private fun node(text: String?, description: String? = null, visible: Boolean = true, enabled: Boolean = true) =
        TextCandidate(text, description, visible, enabled)

    @Test
    fun `matches the exact text or description, outer blanks ignored, case kept`() {
        assertTrue(TextTarget.matches("Sign in", node("Sign in")))
        assertTrue(TextTarget.matches(" Sign in ", node("Sign in  ")))
        assertTrue(TextTarget.matches("Send", node(null, "Send")))
        // Android's own search is a case-insensitive "contains": these must not count.
        assertFalse(TextTarget.matches("Sign in", node("Sign in with Google")))
        assertFalse(TextTarget.matches("Sign in", node("sign in")))
        assertFalse(TextTarget.matches("", node("")))
        assertFalse(TextTarget.matches("Send", node(null, null)))
    }

    @Test
    fun `only visible, enabled matches are usable, in screen order`() {
        val nodes = listOf(
            node("OK", visible = false),
            node("OK"),
            node("OK, got it"),
            node("OK", enabled = false),
            node(null, "OK"),
        )
        assertEquals(listOf(1, 4), TextTarget.usable("OK", nodes))
        assertEquals(emptyList<Int>(), TextTarget.usable("Cancel", nodes))
    }
}
