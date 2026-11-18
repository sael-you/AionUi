package com.aionui.companion.protocol

import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthTest {
    private val health = Health(
        batteryPercent = 5, charging = false, locked = true, accessibilityOn = true, androidVersion = "15", model = "CPH2663",
    )

    @Test
    fun `battery level and scale become a percentage, unknown stays unknown`() {
        assertEquals(5, Health.percent(5, 100))
        assertEquals(50, Health.percent(100, 200))
        assertEquals(100, Health.percent(100, 100))
        assertNull(Health.percent(-1, 100))
        assertNull(Health.percent(50, 0))
    }

    @Test
    fun `the wire fields, unknown ones left out`() {
        assertEquals(
            RelayJson.parseToJsonElement(
                """{"battery_percent":5,"charging":false,"locked":true,"accessibility_on":true,"android_version":"15","model":"CPH2663"}""",
            ),
            health.toJson(),
        )
        val unknown = health.copy(batteryPercent = null, charging = null).toJson()
        assertEquals(setOf("locked", "accessibility_on", "android_version", "model"), unknown.keys)
    }

    @Test
    fun `health rides in pair and hello and as the health event`() {
        for (frame in listOf(Frames.pair("CODE", "phone", "0.2.0", health), Frames.hello("tok", "0.2.0", health))) {
            assertEquals(health.toJson(), RelayJson.parseToJsonElement(frame).jsonObject["health"])
        }
        // Without health the frame is exactly the old one.
        assertNull(RelayJson.parseToJsonElement(Frames.hello("tok", "0.2.0")).jsonObject["health"])
        val event = RelayJson.parseToJsonElement(Frames.health(health)).jsonObject
        assertEquals(RelayJson.parseToJsonElement("\"health\""), event["name"])
        assertEquals(health.toJson(), event["data"])
        assertTrue(Relay.VERBS.containsAll(listOf("global", "open_url", "click_text", "set_text")))
    }
}
