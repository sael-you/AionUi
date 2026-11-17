package com.aionui.companion.protocol

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FramesTest {
    private fun obj(text: String): JsonObject = RelayJson.parseToJsonElement(text).jsonObject

    @Test
    fun `pair carries the code, kind companion and the served verbs`() {
        val frame = obj(Frames.pair("ABCD-1234", "Pixel 8", "0.1.0"))
        assertEquals("pair", frame["type"]!!.jsonPrimitive.content)
        assertEquals("ABCD-1234", frame["code"]!!.jsonPrimitive.content)
        assertEquals("companion", frame["kind"]!!.jsonPrimitive.content)
        assertEquals("Pixel 8", frame["name"]!!.jsonPrimitive.content)
        assertEquals(Relay.VERBS, frame["capabilities"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertFalse("never logcat/install_apk/cdp on the companion", frame.toString().contains("logcat"))
    }

    @Test
    fun `hello carries the token and no code`() {
        val frame = obj(Frames.hello("tok", "0.1.0"))
        assertEquals("hello", frame["type"]!!.jsonPrimitive.content)
        assertEquals("tok", frame["token"]!!.jsonPrimitive.content)
        assertNull(frame["code"])
    }

    @Test
    fun `inventory describes this phone as device self`() {
        val frame = obj(Frames.inventory(PhoneInfo("Pixel", "Pixel 8", "15", enabled = true)))
        val phone = frame["phones"]!!.jsonArray.single().jsonObject
        assertEquals("self", phone["serial"]!!.jsonPrimitive.content)
        assertEquals("self", phone["transport"]!!.jsonPrimitive.content)
        assertFalse(phone["chrome"]!!.jsonPrimitive.boolean)
        assertTrue(phone["enabled"]!!.jsonPrimitive.boolean)
        assertEquals("15", phone["android_version"]!!.jsonPrimitive.content)
        assertTrue(frame["addons"]!!.jsonArray.isEmpty())
        assertNull(frame["mac"])
    }

    @Test
    fun `responses and events have the W2 shape`() {
        val ok = obj(Frames.ok("r1", JsonPrimitive("x")))
        assertEquals("response", ok["type"]!!.jsonPrimitive.content)
        assertTrue(ok["ok"]!!.jsonPrimitive.boolean)
        val failed = obj(Frames.failure("r2", VerbError.BAD_ARGS, "nope"))
        assertFalse(failed["ok"]!!.jsonPrimitive.boolean)
        assertEquals("bad_args", failed["error"]!!.jsonObject["code"]!!.jsonPrimitive.content)
        val event = obj(Frames.event("local_switch_off"))
        assertEquals("self", event["device"]!!.jsonPrimitive.content)
        assertEquals("local_switch_off", event["name"]!!.jsonPrimitive.content)
        assertEquals("ping", obj(Frames.ping())["type"]!!.jsonPrimitive.content)
    }

    @Test
    fun `parses what core sends and ignores the rest`() {
        assertEquals(Inbound.Welcome("c1", "tok"), Frames.parse("""{"type":"welcome","client_id":"c1","token":"tok"}"""))
        assertEquals(Inbound.Welcome("c1", null), Frames.parse("""{"type":"welcome","client_id":"c1"}"""))
        assertEquals(Inbound.Error("DEVICE_REVOKED", null), Frames.parse("""{"type":"error","code":"DEVICE_REVOKED"}"""))
        val request = Frames.parse("""{"type":"request","id":"7","device":"self","verb":"tap","args":{"x":1,"y":2}}""")
        assertTrue(request is Inbound.Request)
        assertEquals("tap", (request as Inbound.Request).verb)
        assertEquals(Inbound.Stop("self"), Frames.parse("""{"type":"stop","device":"self"}"""))
        assertEquals(Inbound.Pong, Frames.parse("""{"type":"pong"}"""))
        assertEquals(Inbound.Unknown("future"), Frames.parse("""{"type":"future","x":1}"""))
        assertNull(Frames.parse("not json"))
        assertNull(Frames.parse("""{"no":"type"}"""))
        assertNull(Frames.parse("""{"type":"request","verb":"tap"}"""))
    }
}
