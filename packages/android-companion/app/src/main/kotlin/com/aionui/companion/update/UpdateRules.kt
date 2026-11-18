package com.aionui.companion.update

import com.aionui.companion.protocol.number
import com.aionui.companion.protocol.string
import kotlinx.serialization.json.JsonObject
import java.net.URI

/** Core's `update_available` frame: a newer build of this app is published on the paired AionUi. */
data class UpdateOffer(
    val version: String,
    val versionCode: Int,
    /** Lower-case hex SHA-256 of the APK. */
    val sha256: String,
    /** A path on the paired host (`/api/devices/…`) or an absolute https URL of that host. */
    val url: String,
    /** Bytes; null when core did not say. */
    val size: Long?,
    /** Epoch ms: the download link is dead after this. */
    val expiresAt: Long,
) {
    companion object {
        /** Null when a field is missing or not of its type (the frame is ignored). */
        fun parse(frame: JsonObject): UpdateOffer? {
            val version = frame.string("version")?.takeIf { it.isNotBlank() } ?: return null
            val code = frame.number("version_code")?.takeIf { it >= 1 && it % 1.0 == 0.0 }?.toInt() ?: return null
            val sha256 = frame.string("sha256") ?: return null
            val url = frame.string("url") ?: return null
            val expiresAt = frame.number("expires_at")?.toLong() ?: return null
            return UpdateOffer(version, code, sha256, url, frame.number("size")?.toLong(), expiresAt)
        }
    }
}

/** Why an update is not installed; the `error` of the `update` event. */
enum class UpdateRefusal(val code: String) {
    NOT_NEWER("not_newer"),
    BAD_URL("bad_url"),
    BAD_HASH("hash_mismatch"),
    EXPIRED("expired"),
    TOO_LARGE("too_large"),
    SIGNATURE("signature_mismatch"),
    DOWNLOAD("download_failed"),
    INSTALL("install_failed"),
    DECLINED("declined"),
}

/** What the app accepts as an update. Plain Kotlin, unit-tested. */
object UpdateRules {
    /** Nothing larger is downloaded. */
    const val MAX_BYTES = 100L * 1024 * 1024

    private val SHA256 = Regex("^[0-9a-f]{64}$")
    private const val PATH_PREFIX = "/api/devices/"

    /**
     * The https address to download from, or null. Only the paired host is ever asked:
     * a path under `/api/devices/` (the host is ours), or an absolute https URL whose
     * host (and port) is the paired one.
     */
    fun resolveUrl(url: String, pairedHost: String): String? {
        val host = pairedHost.trim().lowercase()
        if (host.isEmpty() || url.any { it.isWhitespace() || it.isISOControl() }) return null
        if (url.startsWith("/")) {
            val path = url.substringBefore('?')
            if (!url.startsWith(PATH_PREFIX) || url.startsWith("//") || path.contains("..") || url.contains('\\')) return null
            return "https://$host$url"
        }
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        if (uri.scheme?.lowercase() != "https" || uri.userInfo != null) return null
        val name = uri.host?.lowercase() ?: return null
        val authority = if (uri.port > 0 && uri.port != 443) "$name:${uri.port}" else name
        if (authority != host.removeSuffix(":443")) return null
        if (uri.rawPath?.startsWith(PATH_PREFIX) != true || uri.rawPath.contains("..")) return null
        return url
    }

    /** Checks an offer before anything is downloaded; null = fine. */
    fun refusal(offer: UpdateOffer, ownVersionCode: Int, pairedHost: String, now: Long): UpdateRefusal? = when {
        offer.versionCode <= ownVersionCode -> UpdateRefusal.NOT_NEWER
        !SHA256.matches(offer.sha256) -> UpdateRefusal.BAD_HASH
        resolveUrl(offer.url, pairedHost) == null -> UpdateRefusal.BAD_URL
        offer.expiresAt <= now -> UpdateRefusal.EXPIRED
        offer.size != null && (offer.size <= 0 || offer.size > MAX_BYTES) -> UpdateRefusal.TOO_LARGE
        else -> null
    }

    fun hashMatches(expected: String, actualHex: String): Boolean =
        SHA256.matches(expected) && expected == actualHex.lowercase()

    /**
     * The downloaded APK is signed by exactly the certificate(s) of the running app.
     * [own] and [apk] are certificate digests; an unsigned or differently signed file is refused.
     */
    fun sameSigner(own: Set<String>, apk: Set<String>): Boolean = own.isNotEmpty() && own == apk

    /** What the file itself says, after hash and signer: this app, and really newer. */
    fun archiveRefusal(
        ownPackage: String,
        ownVersionCode: Int,
        archivePackage: String?,
        archiveVersionCode: Long?,
        offer: UpdateOffer,
    ): UpdateRefusal? = when {
        archivePackage != ownPackage -> UpdateRefusal.SIGNATURE
        archiveVersionCode == null || archiveVersionCode <= ownVersionCode -> UpdateRefusal.NOT_NEWER
        archiveVersionCode != offer.versionCode.toLong() -> UpdateRefusal.NOT_NEWER
        else -> null
    }

    fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}
