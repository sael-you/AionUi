package com.aionui.companion.device

import com.aionui.companion.device.WindowView.Kind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ForegroundPickTest {
    private val own = "com.aionui.companion"
    private fun window(kind: Kind, pkg: String?, layer: Int, focused: Boolean = false) = WindowView(kind, pkg, layer, focused)

    @Test
    fun `the game is in front, not the vendor game toolbar drawn over it`() {
        // What a OnePlus shows with Total Battle open: the game, the game-space overlay, the status bar.
        val windows = listOf(
            window(Kind.SYSTEM, "com.android.systemui", 30),
            window(Kind.APPLICATION, "com.oplus.games", 20, focused = true),
            window(Kind.APPLICATION, "com.totalbattle", 10),
        )
        assertEquals("com.totalbattle", ForegroundPick.pick(windows, own))
    }

    @Test
    fun `keyboard, status bar, accessibility overlays and our own chip are skipped`() {
        val windows = listOf(
            window(Kind.ACCESSIBILITY_OVERLAY, own, 50),
            window(Kind.INPUT_METHOD, "com.google.android.inputmethod.latin", 40, focused = true),
            window(Kind.SYSTEM, "com.android.systemui", 30),
            window(Kind.APPLICATION, own, 25),
            window(Kind.APPLICATION, "com.android.chrome", 10),
        )
        assertEquals("com.android.chrome", ForegroundPick.pick(windows, own))
    }

    @Test
    fun `with two apps on screen the focused one wins, else the one nearest to the user`() {
        val split = listOf(
            window(Kind.APPLICATION, "com.example.top", 20),
            window(Kind.APPLICATION, "com.example.focused", 10, focused = true),
        )
        assertEquals("com.example.focused", ForegroundPick.pick(split, own))
        assertEquals("com.example.top", ForegroundPick.pick(split.map { it.copy(focused = false) }, own))
    }

    @Test
    fun `nothing but overlays and system windows - no app in front`() {
        assertNull(ForegroundPick.pick(emptyList(), own))
        assertNull(
            ForegroundPick.pick(
                listOf(
                    window(Kind.SYSTEM, "com.android.systemui", 30),
                    window(Kind.APPLICATION, "com.android.systemui", 20),
                    window(Kind.APPLICATION, null, 10),
                    window(Kind.OTHER, "com.example", 5),
                ),
                own,
            ),
        )
    }
}
