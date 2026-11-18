package com.aionui.companion.update

import com.aionui.companion.protocol.RelayJson
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateRulesTest {
    private val hash = "1224da5cbc9294dc019eb836eed3cf46813af5be7842e530024c4be90586a804"
    private val host = "y.talkseeds.com"
    private val offer = UpdateOffer("0.2.2", 5, hash, "/api/devices/companion.apk?t=TOKEN", 7_340_032, 2_000)

    private fun fixture(name: String) = checkNotNull(javaClass.getResource("/wire/$name.json")).readText()

    @Test
    fun `reads core's update_available frame`() {
        val parsed = UpdateOffer.parse(RelayJson.parseToJsonElement(fixture("update-available")).jsonObject)
        assertEquals(UpdateOffer("0.2.2", 5, hash, "/api/devices/companion.apk?t=TOKEN", 7_340_032, 1_795_000_000_000), parsed)
    }

    @Test
    fun `a frame with a missing or mistyped field is ignored, size is optional`() {
        fun parse(json: String) = UpdateOffer.parse(RelayJson.parseToJsonElement(json).jsonObject)
        assertNull(parse("""{"version":"0.2.2","version_code":"5","sha256":"$hash","url":"/api/devices/x","expires_at":1}"""))
        assertNull(parse("""{"version":"0.2.2","version_code":5.5,"sha256":"$hash","url":"/api/devices/x","expires_at":1}"""))
        assertNull(parse("""{"version":"0.2.2","version_code":5,"url":"/api/devices/x","expires_at":1}"""))
        assertNull(parse("""{"version_code":5,"sha256":"$hash","url":"/api/devices/x","expires_at":1}"""))
        assertNull(parse("""{"version":"0.2.2","version_code":5,"sha256":"$hash","url":"/api/devices/x"}"""))
        assertNull(parse("""{"version":"0.2.2","version_code":5,"sha256":"$hash","url":"/api/devices/x","expires_at":1}""")!!.size)
    }

    @Test
    fun `only the paired host is ever asked - a path under api devices, or an https URL of that host`() {
        assertEquals("https://$host/api/devices/companion.apk?t=T", UpdateRules.resolveUrl("/api/devices/companion.apk?t=T", host))
        assertEquals("https://$host/api/devices/companion.apk?t=T", UpdateRules.resolveUrl("https://$host/api/devices/companion.apk?t=T", host))
        assertEquals("https://Y.TalkSeeds.com/api/devices/a", UpdateRules.resolveUrl("https://Y.TalkSeeds.com/api/devices/a", host))
        assertEquals("https://h:8443/api/devices/a", UpdateRules.resolveUrl("/api/devices/a", "h:8443"))
        assertEquals("https://h:8443/api/devices/a", UpdateRules.resolveUrl("https://h:8443/api/devices/a", "h:8443"))
    }

    @Test
    fun `another host, plain http, a path elsewhere and tricks are refused`() {
        for (url in listOf(
            "https://evil.example/api/devices/companion.apk",
            "https://$host.evil.example/api/devices/companion.apk",
            "https://user@$host/api/devices/companion.apk",
            "https://$host:8443/api/devices/companion.apk",
            "http://$host/api/devices/companion.apk",
            "//evil.example/api/devices/companion.apk",
            "/api/other/companion.apk",
            "/api/devices/../../etc/passwd",
            "https://$host/api/devices/../secret",
            "/api/devices/a b",
            "/api/devices\\evil",
            "file:///sdcard/x.apk",
            "",
        )) {
            assertNull(url, UpdateRules.resolveUrl(url, host))
        }
        assertNull(UpdateRules.resolveUrl("/api/devices/a", " "))
    }

    @Test
    fun `an offer is taken only when newer, well formed, alive and within the size cap`() {
        assertNull(UpdateRules.refusal(offer, 4, host, 1_000))
        assertEquals(UpdateRefusal.NOT_NEWER, UpdateRules.refusal(offer, 5, host, 1_000))
        assertEquals(UpdateRefusal.NOT_NEWER, UpdateRules.refusal(offer, 6, host, 1_000))
        assertEquals(UpdateRefusal.BAD_HASH, UpdateRules.refusal(offer.copy(sha256 = hash.uppercase()), 4, host, 1_000))
        assertEquals(UpdateRefusal.BAD_HASH, UpdateRules.refusal(offer.copy(sha256 = "abc"), 4, host, 1_000))
        assertEquals(UpdateRefusal.BAD_URL, UpdateRules.refusal(offer.copy(url = "https://evil.example/api/devices/a"), 4, host, 1_000))
        assertEquals(UpdateRefusal.EXPIRED, UpdateRules.refusal(offer, 4, host, 2_000))
        assertEquals(UpdateRefusal.TOO_LARGE, UpdateRules.refusal(offer.copy(size = UpdateRules.MAX_BYTES + 1), 4, host, 1_000))
        assertEquals(UpdateRefusal.TOO_LARGE, UpdateRules.refusal(offer.copy(size = 0), 4, host, 1_000))
        assertNull(UpdateRules.refusal(offer.copy(size = UpdateRules.MAX_BYTES), 4, host, 1_000))
        assertNull(UpdateRules.refusal(offer.copy(size = null), 4, host, 1_000))
    }

    @Test
    fun `the file must have exactly the announced hash`() {
        assertTrue(UpdateRules.hashMatches(hash, hash))
        assertTrue(UpdateRules.hashMatches(hash, hash.uppercase()))
        assertFalse(UpdateRules.hashMatches(hash, hash.replaceFirst('1', '2')))
        assertFalse(UpdateRules.hashMatches("", ""))
        assertEquals("00ff10", UpdateRules.hex(byteArrayOf(0, -1, 16)))
    }

    @Test
    fun `the file must be signed by exactly the running app's certificate`() {
        val own = setOf("aa11")
        assertTrue(UpdateRules.sameSigner(own, setOf("aa11")))
        assertFalse(UpdateRules.sameSigner(own, setOf("bb22")))
        assertFalse(UpdateRules.sameSigner(own, setOf("aa11", "bb22")))
        assertFalse(UpdateRules.sameSigner(own, emptySet()))
        assertFalse(UpdateRules.sameSigner(emptySet(), emptySet()))
    }

    @Test
    fun `the file itself must be this app and the version that was announced`() {
        val pkg = "com.aionui.companion"
        assertNull(UpdateRules.archiveRefusal(pkg, 4, pkg, 5, offer))
        assertEquals(UpdateRefusal.SIGNATURE, UpdateRules.archiveRefusal(pkg, 4, "com.evil.app", 5, offer))
        assertEquals(UpdateRefusal.SIGNATURE, UpdateRules.archiveRefusal(pkg, 4, null, 5, offer))
        assertEquals(UpdateRefusal.NOT_NEWER, UpdateRules.archiveRefusal(pkg, 4, pkg, 4, offer))
        assertEquals(UpdateRefusal.NOT_NEWER, UpdateRules.archiveRefusal(pkg, 4, pkg, null, offer))
        // A file that is newer than us but not the build core announced is not installed either.
        assertEquals(UpdateRefusal.NOT_NEWER, UpdateRules.archiveRefusal(pkg, 4, pkg, 6, offer))
    }
}
