package com.aionui.companion.device

/** One on-screen node that carries text, as `click_text` sees it. */
data class TextCandidate(
    val text: String?,
    val contentDescription: String?,
    val visible: Boolean,
    val enabled: Boolean,
)

/** Which node `click_text` means. Plain Kotlin, unit-tested. */
object TextTarget {
    /** Exact match of the visible text or the content description (outer blanks ignored, case kept). */
    fun matches(wanted: String, candidate: TextCandidate): Boolean {
        val target = wanted.trim()
        if (target.isEmpty()) return false
        return candidate.text?.trim() == target || candidate.contentDescription?.trim() == target
    }

    /**
     * Indexes (into [candidates]) of the usable matches, in screen order: visible and
     * enabled ones. `index` picks among them.
     */
    fun usable(wanted: String, candidates: List<TextCandidate>): List<Int> =
        candidates.indices.filter { candidates[it].visible && candidates[it].enabled && matches(wanted, candidates[it]) }
}
