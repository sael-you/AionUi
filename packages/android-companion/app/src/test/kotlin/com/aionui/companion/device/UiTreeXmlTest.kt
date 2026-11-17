package com.aionui.companion.device

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import javax.xml.parsers.DocumentBuilderFactory

class UiTreeXmlTest {
    private fun node(
        text: String? = null,
        password: Boolean = false,
        children: List<NodeView> = emptyList(),
    ) = NodeView(
        text = text, resourceId = "id/x", className = "android.widget.TextView", packageName = "com.example",
        contentDescription = null, checkable = false, checked = false, clickable = true, enabled = true,
        focusable = true, focused = false, scrollable = false, longClickable = false, password = password,
        selected = false, left = 1, top = 2, right = 30, bottom = 40, children = children,
    )

    private fun parse(xml: String) = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(xml.byteInputStream())

    @Test
    fun `renders the uiautomator dump shape and is valid XML`() {
        val xml = UiTreeXml.render(listOf(node(text = "Hello", children = listOf(node(text = "child")))))
        val doc = parse(xml)
        assertEquals("hierarchy", doc.documentElement.tagName)
        val nodes = doc.getElementsByTagName("node")
        assertEquals(2, nodes.length)
        val root = nodes.item(0).attributes
        assertEquals("Hello", root.getNamedItem("text").nodeValue)
        assertEquals("[1,2][30,40]", root.getNamedItem("bounds").nodeValue)
        assertEquals("true", root.getNamedItem("clickable").nodeValue)
        assertEquals("id/x", root.getNamedItem("resource-id").nodeValue)
    }

    @Test
    fun `password fields never carry their text`() {
        val xml = UiTreeXml.render(listOf(node(text = "hunter2", password = true)))
        assertFalse(xml.contains("hunter2"))
        assertTrue(xml.contains("password=\"true\""))
    }

    @Test
    fun `escapes markup and drops characters XML cannot carry`() {
        val xml = UiTreeXml.render(listOf(node(text = "a<b>&\"c'\u0001\nd")))
        val text = parse(xml).getElementsByTagName("node").item(0).attributes.getNamedItem("text").nodeValue
        assertEquals("a<b>&\"c'\nd", text)
    }

    @Test
    fun `a runaway tree is cut by depth`() {
        var deep = node(text = "leaf")
        repeat(UiTreeXml.MAX_DEPTH + 20) { deep = node(children = listOf(deep)) }
        val count = parse(UiTreeXml.render(listOf(deep))).getElementsByTagName("node").length
        assertEquals(UiTreeXml.MAX_DEPTH, count)
    }
}
