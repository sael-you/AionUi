package com.aionui.companion.protocol

import java.net.URI

/** What `open_url` may open. Plain Kotlin, unit-tested. */
object UrlGuard {
    const val MAX_LENGTH = 4096
    private val SCHEMES = setOf("http", "https", "market")

    /** The URL to open, or null with [reason] saying why not. */
    fun check(input: String): Result {
        val url = input.trim()
        if (url.isEmpty()) return Result(null, "url is required")
        if (url.length > MAX_LENGTH) return Result(null, "url is longer than $MAX_LENGTH characters")
        if (url.any { it.isWhitespace() || it.isISOControl() }) return Result(null, "url must not contain spaces or control characters")
        val uri = runCatching { URI(url) }.getOrNull() ?: return Result(null, "url is not a valid address")
        val scheme = uri.scheme?.lowercase()
        if (scheme !in SCHEMES) return Result(null, "only http, https and market links are opened")
        // A web link needs a host; `market:` links are opaque (`market://details?id=…`).
        if (scheme != "market" && uri.host.isNullOrEmpty()) return Result(null, "url has no host")
        return Result(url, null)
    }

    data class Result(val url: String?, val reason: String?)
}
