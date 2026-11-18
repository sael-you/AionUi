package com.aionui.companion.device

/** One node of the accessibility tree, platform-free so it can be tested. */
data class NodeView(
    val text: String?,
    val resourceId: String?,
    val className: String?,
    val packageName: String?,
    val contentDescription: String?,
    val checkable: Boolean,
    val checked: Boolean,
    val clickable: Boolean,
    val enabled: Boolean,
    val focusable: Boolean,
    val focused: Boolean,
    val scrollable: Boolean,
    val longClickable: Boolean,
    val password: Boolean,
    val selected: Boolean,
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
    val children: List<NodeView>,
)

/** `ui_tree` result: the XML, how many nodes it holds, and whether the cap left some out. */
data class UiTreeDump(val xml: String, val nodes: Int, val truncated: Boolean)

/**
 * `ui_tree` → `{xml, nodes, truncated}` in the shape of `uiautomator dump`, so agents that know that
 * format read it as is. Password fields never carry their text.
 */
object UiTreeXml {
    /** Deep trees are cut here (a runaway layout must not produce a huge frame). */
    const val MAX_DEPTH = 64
    /** More nodes than this are left out and the dump says `truncated`. */
    const val MAX_NODES = 1_500

    fun render(roots: List<NodeView>, rotation: Int = 0, maxNodes: Int = MAX_NODES, cut: Boolean = false): UiTreeDump {
        val out = StringBuilder("<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>")
        out.append("<hierarchy rotation=\"").append(rotation).append("\">")
        // budget[0] = nodes still allowed, budget[1] = 1 once something was left out.
        val budget = intArrayOf(maxNodes, if (cut) 1 else 0)
        roots.forEachIndexed { index, root -> node(out, root, index, 0, budget) }
        out.append("</hierarchy>")
        return UiTreeDump(out.toString(), maxNodes - budget[0], budget[1] == 1)
    }

    private fun node(out: StringBuilder, node: NodeView, index: Int, depth: Int, budget: IntArray) {
        if (depth >= MAX_DEPTH || budget[0] <= 0) {
            budget[1] = 1
            return
        }
        budget[0] -= 1
        out.append("<node")
        attr(out, "index", index.toString())
        attr(out, "text", if (node.password) "" else node.text.orEmpty())
        attr(out, "resource-id", node.resourceId.orEmpty())
        attr(out, "class", node.className.orEmpty())
        attr(out, "package", node.packageName.orEmpty())
        attr(out, "content-desc", node.contentDescription.orEmpty())
        attr(out, "checkable", node.checkable.toString())
        attr(out, "checked", node.checked.toString())
        attr(out, "clickable", node.clickable.toString())
        attr(out, "enabled", node.enabled.toString())
        attr(out, "focusable", node.focusable.toString())
        attr(out, "focused", node.focused.toString())
        attr(out, "scrollable", node.scrollable.toString())
        attr(out, "long-clickable", node.longClickable.toString())
        attr(out, "password", node.password.toString())
        attr(out, "selected", node.selected.toString())
        attr(out, "bounds", "[${node.left},${node.top}][${node.right},${node.bottom}]")
        if (node.children.isEmpty()) {
            out.append("/>")
            return
        }
        out.append(">")
        node.children.forEachIndexed { childIndex, child -> node(out, child, childIndex, depth + 1, budget) }
        out.append("</node>")
    }

    private fun attr(out: StringBuilder, name: String, value: String) {
        out.append(' ').append(name).append("=\"").append(escape(value)).append('"')
    }

    /** XML-escape, and drop characters XML 1.0 cannot carry. */
    fun escape(value: String): String {
        val out = StringBuilder(value.length)
        for (char in value) {
            when {
                char == '&' -> out.append("&amp;")
                char == '<' -> out.append("&lt;")
                char == '>' -> out.append("&gt;")
                char == '"' -> out.append("&quot;")
                char == '\'' -> out.append("&apos;")
                char == '\n' -> out.append("&#10;")
                char == '\r' -> out.append("&#13;")
                char == '\t' -> out.append("&#9;")
                char < ' ' -> Unit
                char in '￾'..'￿' -> Unit
                else -> out.append(char)
            }
        }
        return out.toString()
    }
}
