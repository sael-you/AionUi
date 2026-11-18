package com.aionui.companion.device

/** One window on screen, platform-free so the choice can be tested. */
data class WindowView(
    val type: Kind,
    val packageName: String?,
    /** Z-order: higher is nearer to the user. */
    val layer: Int,
    val focused: Boolean,
) {
    enum class Kind { APPLICATION, INPUT_METHOD, SYSTEM, ACCESSIBILITY_OVERLAY, OTHER }
}

/**
 * Which app is "in front" for `foreground`: the package of the top application window.
 * Overlays and system chrome are not the app the agent is in: the keyboard, the status
 * bar and notification shade, accessibility overlays, a vendor game toolbar drawn over
 * the game, and this app's own floating chip. Plain Kotlin, unit-tested.
 */
object ForegroundPick {
    /** Packages whose windows sit on top of the real app. */
    val OVERLAY_PACKAGES = setOf(
        "com.android.systemui",
        "com.oplus.games",
        "com.oneplus.gamespace",
        "com.coloros.gamespaceui",
        "com.samsung.android.game.gametools",
        "com.miui.securitycenter",
    )

    fun pick(windows: List<WindowView>, ownPackage: String): String? {
        val apps = windows.filter { window ->
            val pkg = window.packageName
            window.type == WindowView.Kind.APPLICATION && !pkg.isNullOrEmpty() && pkg != ownPackage && pkg !in OVERLAY_PACKAGES
        }
        // The focused app window wins; otherwise the one nearest to the user.
        return (apps.filter { it.focused }.maxByOrNull { it.layer } ?: apps.maxByOrNull { it.layer })?.packageName
    }
}
