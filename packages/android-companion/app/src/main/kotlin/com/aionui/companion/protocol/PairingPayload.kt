package com.aionui.companion.protocol

import java.net.URI
import java.net.URLDecoder

/**
 * Where to connect and with which code. From the pairing QR
 * (`aionui-pair:v1?host=<public host>&code=<CODE>`) or typed by the owner.
 */
data class PairingPayload(val host: String, val code: String) {
    /** `wss://<host>/api/devices/relay` — the token never goes in the URL. */
    val relayUrl: String get() = relayUrlFor(host)

    companion object {
        private const val SCHEME_PREFIX = "aionui-pair:v1?"
        private val CODE = Regex("^[A-Za-z0-9-]{4,64}$")
        private val HOST = Regex("^[A-Za-z0-9.-]+(:[0-9]{1,5})?$")

        /** `wss://<host>/api/devices/relay` for a validated host. */
        fun relayUrlFor(host: String): String = "wss://$host${Relay.PATH}"

        /** The QR text; null when it is not a v1 pairing payload or a field is malformed. */
        fun parseQr(text: String): PairingPayload? {
            val trimmed = text.trim()
            if (!trimmed.startsWith(SCHEME_PREFIX)) return null
            val query = trimmed.removePrefix(SCHEME_PREFIX)
            val params = query.split('&').mapNotNull { part ->
                val index = part.indexOf('=')
                if (index <= 0) null else part.substring(0, index) to decode(part.substring(index + 1))
            }.toMap()
            return of(params["host"].orEmpty(), params["code"].orEmpty())
        }

        /** Typed by the owner: a host (or a pasted https URL) and the code shown in AionUi. */
        fun of(hostInput: String, codeInput: String): PairingPayload? {
            val host = normaliseHost(hostInput) ?: return null
            val code = codeInput.trim()
            if (!CODE.matches(code)) return null
            return PairingPayload(host, code)
        }

        /** `y.example.com`, `y.example.com:8443` or a pasted `https://y.example.com/...` → host[:port]. */
        fun normaliseHost(input: String): String? {
            val trimmed = input.trim().trimEnd('/')
            if (trimmed.isEmpty()) return null
            val host = if (trimmed.contains("://")) {
                val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null
                // Only a secure origin: the relay is wss, never plain ws.
                if (uri.scheme != "https" && uri.scheme != "wss") return null
                val name = uri.host ?: return null
                if (uri.port > 0) "$name:${uri.port}" else name
            } else {
                trimmed
            }
            return host.lowercase().takeIf { HOST.matches(it) }
        }

        private fun decode(value: String): String = runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)
    }
}
