package com.aionui.companion.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class UrlGuardTest {
    @Test
    fun `web and market links are opened as written, outer blanks trimmed`() {
        assertEquals("https://example.com/a?b=1#c", UrlGuard.check(" https://example.com/a?b=1#c ").url)
        assertEquals("http://example.com", UrlGuard.check("http://example.com").url)
        assertEquals("HTTPS://Example.com/", UrlGuard.check("HTTPS://Example.com/").url)
        assertEquals("market://details?id=com.example.app", UrlGuard.check("market://details?id=com.example.app").url)
    }

    @Test
    fun `every other scheme is refused`() {
        for (url in listOf(
            "intent://scan/#Intent;scheme=zxing;end",
            "file:///sdcard/secret.txt",
            "content://com.android.contacts/contacts",
            "javascript:alert(1)",
            "tel:+15550100",
            "aionui-pair:v1?host=x&code=y",
            "example.com",
        )) {
            val result = UrlGuard.check(url)
            assertNull(url, result.url)
            assertNotNull(url, result.reason)
        }
    }

    @Test
    fun `empty, too long, without a host or with blanks inside is refused`() {
        assertNull(UrlGuard.check("  ").url)
        assertNull(UrlGuard.check("https://").url)
        assertNull(UrlGuard.check("https://exa mple.com").url)
        assertNull(UrlGuard.check("https://example.com/\nx").url)
        val limit = "https://example.com/" + "a".repeat(UrlGuard.MAX_LENGTH - 20)
        assertEquals(UrlGuard.MAX_LENGTH, limit.length)
        assertNotNull(UrlGuard.check(limit).url)
        assertNull(UrlGuard.check(limit + "a").url)
    }
}
