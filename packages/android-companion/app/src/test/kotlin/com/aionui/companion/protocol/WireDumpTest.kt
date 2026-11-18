package com.aionui.companion.protocol

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Test
import java.io.File

/** Writes every frame the app's serialiser produces to build/wire/frames.jsonl (for core's wire test). */
class WireDumpTest {
    @Test
    fun `dump the frames`() {
        val phone = PhoneInfo(name = "OnePlus Nord 4", model = "CPH2663", androidVersion = "15", enabled = true)
        val health = Health(80, true, locked = false, accessibilityOn = true, androidVersion = "15", model = "CPH2663")
        val screenshot = buildJsonObject {
            put("format", "png")
            put("width", 2)
            put("height", 3)
            put("data_base64", "AQID")
        }
        val frames = listOf(
            "pair" to Frames.pair("<CODE>", "OnePlus Nord 4", "0.2.2", health, 5),
            "hello" to Frames.hello("<TOKEN>", "0.2.2", health, 5),
            "event health" to Frames.health(health.copy(batteryPercent = 5, locked = true)),
            "inventory" to Frames.inventory(phone),
            "response ok, no result" to Frames.ok(JsonPrimitive(1), null),
            "response ok, foreground" to Frames.ok(JsonPrimitive(2), buildJsonObject { put("package", "com.example.app") }),
            "response ok, screenshot" to Frames.ok(JsonPrimitive(3), screenshot),
            "response failure" to Frames.failure(JsonPrimitive(4), VerbError.SWITCH_OFF, "the owner switched agents off on this phone"),
            "event local_switch_off" to Frames.event("local_switch_off"),
            "event foreground" to Frames.event("foreground", buildJsonObject { put("package", "com.example.app") }),
            "event update_check" to Frames.updateCheck(),
            "event update" to Frames.update("downloading", 5),
            "event update failed" to Frames.update("failed", 5, "signature_mismatch"),
            "ping" to Frames.ping(),
        )
        val out = File("build/wire").apply { mkdirs() }
        File(out, "frames.jsonl").writeText(frames.joinToString("\n") { it.second } + "\n")
        File(out, "frames.txt").writeText(frames.joinToString("\n") { "${it.first}: ${it.second}" } + "\n")
    }
}
