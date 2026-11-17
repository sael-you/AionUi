package com.aionui.companion.res

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/** Every user-facing string ships in all 13 locales, with the same placeholders. */
class LocalesTest {
    private val res = File("src/main/res")
    private val locales = listOf("", "-de", "-es", "-fa", "-fr", "-ja", "-ko", "-pt-rBR", "-ru", "-tr", "-uk", "-zh-rCN", "-zh-rTW")
    private val placeholder = Regex("%\\d\\$[sd]")

    private fun strings(dir: String): Map<String, String> {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(File(res, "values$dir/strings.xml"))
        val nodes = doc.getElementsByTagName("string")
        return (0 until nodes.length).associate { index ->
            val node = nodes.item(index)
            node.attributes.getNamedItem("name").nodeValue to node.textContent
        }
    }

    @Test
    fun `all 13 locales have every string with the same placeholders`() {
        val base = strings("")
        assertTrue(base.isNotEmpty())
        for (locale in locales) {
            val translated = strings(locale)
            assertEquals("keys in values$locale", base.keys, translated.keys)
            for ((key, value) in base) {
                assertEquals(
                    "placeholders of $key in values$locale",
                    placeholder.findAll(value).map { it.value }.toList().sorted(),
                    placeholder.findAll(translated.getValue(key)).map { it.value }.toList().sorted(),
                )
                assertTrue("$key in values$locale is empty", translated.getValue(key).isNotBlank())
            }
        }
    }
}
