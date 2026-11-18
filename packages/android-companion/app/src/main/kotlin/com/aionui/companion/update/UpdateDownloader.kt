package com.aionui.companion.update

import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

/** An update step that ended for a reason the owner (and core) is told. */
class UpdateFailure(val reason: UpdateRefusal, message: String? = null) : Exception(message ?: reason.code)

/**
 * Downloads the announced APK into the app's private cache: resumes a partial file
 * (HTTP Range), never keeps more than [maxBytes], and hands the file
 * over only when its SHA-256 is the announced one. No Android classes: unit-tested
 * against a local web server.
 */
class UpdateDownloader(
    private val client: OkHttpClient,
    private val dir: File,
    private val maxBytes: Long = UpdateRules.MAX_BYTES,
) {

    /** Blocking. [url] is already resolved against the paired host. */
    fun download(url: String, offer: UpdateOffer, progress: (percent: Int?) -> Unit = {}): File {
        dir.mkdirs()
        val part = File(dir, "${offer.sha256}.apk.part")
        val done = File(dir, "${offer.sha256}.apk")
        // Leftovers of other builds are of no use any more.
        dir.listFiles()?.filter { it != part && it != done }?.forEach { it.delete() }
        if (done.isFile && UpdateRules.hashMatches(offer.sha256, sha256(done))) return done
        done.delete()

        fetch(url, offer, part, progress, resume = part.length() > 0)
        if (!UpdateRules.hashMatches(offer.sha256, sha256(part))) {
            part.delete()
            throw UpdateFailure(UpdateRefusal.BAD_HASH)
        }
        if (!part.renameTo(done)) throw UpdateFailure(UpdateRefusal.DOWNLOAD, "could not keep the downloaded file")
        return done
    }

    private fun fetch(url: String, offer: UpdateOffer, part: File, progress: (Int?) -> Unit, resume: Boolean) {
        val have = if (resume) part.length() else 0L
        val request = Request.Builder().url(url).apply { if (have > 0) header("Range", "bytes=$have-") }.build()
        val response = try {
            client.newCall(request).execute()
        } catch (error: Exception) {
            throw UpdateFailure(UpdateRefusal.DOWNLOAD, error.message)
        }
        response.use {
            when {
                // The range starts past the end: the partial file is not usable, start over once.
                response.code == 416 && resume -> {
                    part.delete()
                    return fetch(url, offer, part, progress, resume = false)
                }
                response.code == 401 || response.code == 403 || response.code == 410 -> throw UpdateFailure(UpdateRefusal.EXPIRED)
                response.code != 200 && response.code != 206 -> throw UpdateFailure(UpdateRefusal.DOWNLOAD, "HTTP ${response.code}")
            }
            // 200 to a ranged request = the server sends the whole file again.
            val append = response.code == 206 && have > 0
            val start = if (append) have else 0L
            val body = response.body ?: throw UpdateFailure(UpdateRefusal.DOWNLOAD, "empty answer")
            val length = body.contentLength().takeIf { it >= 0 }
            val total = offer.size ?: length?.let { start + it }
            if ((total ?: 0) > maxBytes || (length ?: 0) + start > maxBytes) {
                throw UpdateFailure(UpdateRefusal.TOO_LARGE)
            }
            var written = start
            try {
                FileOutputStream(part, append).use { out ->
                    val buffer = ByteArray(64 * 1024)
                    val input = body.byteStream()
                    var lastPercent = -1
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        written += read
                        if (written > maxBytes) throw UpdateFailure(UpdateRefusal.TOO_LARGE)
                        out.write(buffer, 0, read)
                        val percent = total?.takeIf { it > 0 }?.let { (written * 100 / it).toInt().coerceIn(0, 100) }
                        if (percent != lastPercent) {
                            lastPercent = percent ?: -1
                            progress(percent)
                        }
                    }
                    out.fd.sync()
                }
            } catch (failure: UpdateFailure) {
                part.delete()
                throw failure
            } catch (error: Exception) {
                // The partial file stays: the next attempt resumes it.
                throw UpdateFailure(UpdateRefusal.DOWNLOAD, error.message)
            }
        }
    }

    companion object {
        fun sha256(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                }
            }
            return UpdateRules.hex(digest.digest())
        }
    }
}
