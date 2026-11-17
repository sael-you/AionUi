package com.aionui.companion.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairingPayloadTest {
    @Test
    fun `reads the v1 pairing QR`() {
        val payload = PairingPayload.parseQr("aionui-pair:v1?host=y.example.com&code=K7Q2-9XZD")
        assertEquals(PairingPayload("y.example.com", "K7Q2-9XZD"), payload)
        assertEquals("wss://y.example.com/api/devices/relay", payload!!.relayUrl)
    }

    @Test
    fun `keeps a port and decodes escaped values`() {
        val payload = PairingPayload.parseQr("aionui-pair:v1?code=ABCD&host=y.example.com%3A8443")
        assertEquals("wss://y.example.com:8443/api/devices/relay", payload!!.relayUrl)
    }

    @Test
    fun `refuses other schemes, versions and malformed fields`() {
        assertNull(PairingPayload.parseQr("https://y.example.com/?code=ABCD"))
        assertNull(PairingPayload.parseQr("aionui-pair:v2?host=y.example.com&code=ABCD"))
        assertNull(PairingPayload.parseQr("aionui-pair:v1?host=y.example.com"))
        assertNull(PairingPayload.parseQr("aionui-pair:v1?host=evil.com/path&code=ABCD"))
        assertNull(PairingPayload.parseQr("aionui-pair:v1?host=y.example.com&code=AB"))
        assertNull(PairingPayload.parseQr("aionui-pair:v1?host=y.example.com&code=AB CD"))
    }

    @Test
    fun `typed input accepts a host or an https address, never plain http`() {
        assertEquals("y.example.com", PairingPayload.of(" Y.Example.com/ ", "ABCD")!!.host)
        assertEquals("y.example.com", PairingPayload.of("https://y.example.com/settings/devices", "ABCD")!!.host)
        assertEquals("y.example.com:8443", PairingPayload.of("https://y.example.com:8443", "ABCD")!!.host)
        assertNull(PairingPayload.of("http://y.example.com", "ABCD"))
        assertNull(PairingPayload.of("", "ABCD"))
        assertNull(PairingPayload.of("y.example.com", ""))
    }
}
