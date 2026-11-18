package com.aionui.companion.protocol

/** What the scanner does with a decoded QR text. Plain Kotlin, unit-tested. */
object PairingScan {
    enum class Verdict {
        /** A v1 pairing payload with a valid host and code: return it. */
        PAIRING,

        /** Anything else (the install link shown next to it, any other QR): keep scanning. */
        OTHER,
    }

    fun judge(text: String?): Verdict =
        if (text != null && PairingPayload.parseQr(text) != null) Verdict.PAIRING else Verdict.OTHER
}
