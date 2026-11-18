package com.aionui.companion.update

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest

class UpdateDownloaderTest {
    private val server = MockWebServer()
    private lateinit var dir: File
    private val apk = ByteArray(200_000) { (it * 31 % 251).toByte() }
    private val hash = UpdateRules.hex(MessageDigest.getInstance("SHA-256").digest(apk))

    private fun offer(size: Long? = apk.size.toLong(), sha256: String = hash) =
        UpdateOffer("0.2.2", 5, sha256, "/api/devices/companion.apk?t=T", size, Long.MAX_VALUE)

    private fun downloader() = UpdateDownloader(OkHttpClient(), dir)
    private fun url() = server.url("/api/devices/companion.apk?t=T").toString()
    private fun body(bytes: ByteArray) = Buffer().write(bytes)

    @Before
    fun setUp() {
        dir = Files.createTempDirectory("update-test").toFile()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
        dir.deleteRecursively()
    }

    @Test
    fun `downloads the file, reports progress and hands it over when the hash is right`() {
        server.enqueue(MockResponse().setBody(body(apk)))
        val seen = mutableListOf<Int?>()
        val file = downloader().download(url(), offer()) { seen += it }
        assertArrayEquals(apk, file.readBytes())
        assertEquals("$hash.apk", file.name)
        assertEquals(100, seen.last())
        assertNull(server.takeRequest().getHeader("Range"))
        assertFalse(File(dir, "$hash.apk.part").exists())
    }

    @Test
    fun `a wrong hash deletes the file and fails as hash_mismatch`() {
        server.enqueue(MockResponse().setBody(body(apk.copyOf().also { it[10] = 99 })))
        val failure = assertThrows(UpdateFailure::class.java) { downloader().download(url(), offer()) }
        assertEquals(UpdateRefusal.BAD_HASH, failure.reason)
        assertEquals(0, dir.listFiles()!!.size)
    }

    @Test
    fun `resumes a partial file with Range and appends the rest`() {
        File(dir, "$hash.apk.part").writeBytes(apk.copyOfRange(0, 80_000))
        server.enqueue(MockResponse().setResponseCode(206).setBody(body(apk.copyOfRange(80_000, apk.size))))
        val file = downloader().download(url(), offer())
        assertArrayEquals(apk, file.readBytes())
        assertEquals("bytes=80000-", server.takeRequest().getHeader("Range"))
    }

    @Test
    fun `a server that ignores Range sends the whole file - the partial one is replaced`() {
        File(dir, "$hash.apk.part").writeBytes(ByteArray(50_000) { 7 })
        server.enqueue(MockResponse().setResponseCode(200).setBody(body(apk)))
        assertArrayEquals(apk, downloader().download(url(), offer()).readBytes())
    }

    @Test
    fun `a partial file past the end starts over once`() {
        File(dir, "$hash.apk.part").writeBytes(ByteArray(300_000) { 1 })
        server.enqueue(MockResponse().setResponseCode(416))
        server.enqueue(MockResponse().setBody(body(apk)))
        assertArrayEquals(apk, downloader().download(url(), offer()).readBytes())
        assertEquals("bytes=300000-", server.takeRequest().getHeader("Range"))
        assertNull(server.takeRequest().getHeader("Range"))
    }

    @Test
    fun `a file already downloaded and intact is not fetched again, other builds are cleared`() {
        File(dir, "$hash.apk").writeBytes(apk)
        File(dir, "old-build.apk").writeBytes(ByteArray(10))
        assertArrayEquals(apk, downloader().download(url(), offer()).readBytes())
        assertEquals(0, server.requestCount)
        assertFalse(File(dir, "old-build.apk").exists())
    }

    @Test
    fun `nothing over the size cap is kept - announced or actually sent`() {
        val announced = assertThrows(UpdateFailure::class.java) {
            server.enqueue(MockResponse().setBody(body(apk)))
            downloader().download(url(), offer(size = UpdateRules.MAX_BYTES + 1))
        }
        assertEquals(UpdateRefusal.TOO_LARGE, announced.reason)

        // Not announced: the Content-Length says it, and a body without one is cut while it arrives.
        val small = UpdateDownloader(OkHttpClient(), dir, maxBytes = 100_000)
        server.enqueue(MockResponse().setBody(body(apk)))
        assertEquals(
            UpdateRefusal.TOO_LARGE,
            assertThrows(UpdateFailure::class.java) { small.download(url(), offer(size = null)) }.reason,
        )
        server.enqueue(MockResponse().setChunkedBody(body(apk), 8_192))
        assertEquals(
            UpdateRefusal.TOO_LARGE,
            assertThrows(UpdateFailure::class.java) { small.download(url(), offer(size = null)) }.reason,
        )
        assertEquals(0, dir.listFiles()!!.size)
    }

    @Test
    fun `a dead link is expired, any other error a failed download`() {
        server.enqueue(MockResponse().setResponseCode(403))
        assertEquals(UpdateRefusal.EXPIRED, assertThrows(UpdateFailure::class.java) { downloader().download(url(), offer()) }.reason)
        server.enqueue(MockResponse().setResponseCode(500))
        assertEquals(UpdateRefusal.DOWNLOAD, assertThrows(UpdateFailure::class.java) { downloader().download(url(), offer()) }.reason)
        assertTrue(dir.listFiles()!!.none { it.name.endsWith(".apk") })
    }
}
