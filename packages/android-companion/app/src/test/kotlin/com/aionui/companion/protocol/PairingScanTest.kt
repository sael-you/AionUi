package com.aionui.companion.protocol

import com.aionui.companion.protocol.PairingScan.Verdict
import org.junit.Assert.assertEquals
import org.junit.Test

class PairingScanTest {
    @Test
    fun `the payload exactly as AionCore formats it is a pairing code`() {
        // crates/aionui-devices/src/relay.rs: format!("aionui-pair:v1?host={}&code={}", host, code),
        // code = groups of the 32-letter alphabet joined by '-'.
        assertEquals(Verdict.PAIRING, PairingScan.judge("aionui-pair:v1?host=y.talkseeds.com&code=K7QM-2XPA"))
        assertEquals(Verdict.PAIRING, PairingScan.judge("aionui-pair:v1?host=y.talkseeds.com:8443&code=ABCD2345"))
        assertEquals(Verdict.PAIRING, PairingScan.judge("  aionui-pair:v1?host=Y.TalkSeeds.com&code=K7QM-2XPA\n"))
    }

    @Test
    fun `the install link shown next to it keeps the scanner looking`() {
        assertEquals(Verdict.OTHER, PairingScan.judge("https://y.talkseeds.com/api/devices/companion/apk?t=abc"))
        assertEquals(Verdict.OTHER, PairingScan.judge("https://example.com"))
        assertEquals(Verdict.OTHER, PairingScan.judge("WIFI:S:home;T:WPA;P:secret;;"))
    }

    @Test
    fun `a pairing payload without a usable host or code is not accepted`() {
        // AionCore writes an empty host when it cannot tell the public host.
        assertEquals(Verdict.OTHER, PairingScan.judge("aionui-pair:v1?host=&code=K7QM-2XPA"))
        assertEquals(Verdict.OTHER, PairingScan.judge("aionui-pair:v1?host=y.talkseeds.com&code="))
        assertEquals(Verdict.OTHER, PairingScan.judge("aionui-pair:v2?host=y.talkseeds.com&code=K7QM-2XPA"))
        assertEquals(Verdict.OTHER, PairingScan.judge(""))
        assertEquals(Verdict.OTHER, PairingScan.judge(null))
    }
}
