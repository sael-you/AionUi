package com.aionui.companion.protocol

import com.aionui.companion.device.DeviceActions
import com.aionui.companion.device.Screenshot
import com.aionui.companion.device.TextClick
import com.aionui.companion.device.UiTreeDump
import com.aionui.companion.device.VerbDispatcher
import com.aionui.companion.relay.VerbResult
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * The reply frames exactly as the app's own code produces them (dispatcher result →
 * `Frames`), against the fixtures in `src/test/resources/wire/`. AionCore reads the same
 * files in its tests: a change here is a wire change.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WireFixturesTest {
    private class Phone(var on: Boolean = true) : DeviceActions {
        override fun switchOn() = on
        override suspend fun screenshot(scale: Double, format: String?) = Screenshot("png", 2, 3, byteArrayOf(1, 2, 3))
        override suspend fun uiTree() = UiTreeDump("<hierarchy/>", 0, false)
        override suspend fun global(action: String) = Unit
        override suspend fun openUrl(url: String) = Unit
        override suspend fun tap(x: Int, y: Int) = Unit
        override suspend fun swipe(x1: Int, y1: Int, x2: Int, y2: Int, durationMs: Long) = Unit
        override suspend fun text(value: String) = Unit
        override suspend fun clickText(text: String, index: Int) = TextClick(1, "click")
        override suspend fun setText(value: String) = Unit
        override suspend fun key(code: Int) = Unit
        override suspend fun launch(packageName: String) = Unit
        override fun foregroundPackage() = "com.example.app"
        override fun cancelAll() = Unit
    }

    private fun fixture(name: String): String =
        checkNotNull(javaClass.getResource("/wire/$name.json")) { "missing fixture $name" }.readText()

    private fun json(text: String): JsonElement = RelayJson.parseToJsonElement(text)

    /** Core's request frame in, the app's reply frame out. */
    private fun TestScope.reply(requestJson: String, phone: Phone = Phone()): String {
        val request = Frames.parse(requestJson) as Inbound.Request
        val dispatcher = VerbDispatcher(phone, TestScope(StandardTestDispatcher(testScheduler)))
        val result = CompletableDeferred<VerbResult>()
        dispatcher.handle(request.verb, request.args) { result.complete(it) }
        advanceUntilIdle()
        return when (val done = result.getCompleted()) {
            is VerbResult.Ok -> Frames.ok(request.id, done.result)
            is VerbResult.Failed -> Frames.failure(request.id, done.code, done.message)
        }
    }

    @Test
    fun `foreground - the request as core sends it, the reply with the same numeric id`() = runTest {
        val sent = reply(fixture("request-foreground"))
        assertEquals(json(fixture("response-foreground")), json(sent))
        // The id is a JSON number on the wire, never "7".
        assertFalse(sent.contains("\"id\":\"7\""))
    }

    @Test
    fun `launch - a verb without a result omits it`() = runTest {
        val sent = reply("""{"type":"request","id":8,"device":"self","verb":"launch","args":{"package":"com.totalbattle"}}""")
        assertEquals(json(fixture("response-launch")), json(sent))
    }

    @Test
    fun `screenshot - format, size and padded base64`() = runTest {
        val sent = reply("""{"type":"request","id":9,"device":"self","verb":"screenshot","args":{}}""")
        assertEquals(json(fixture("response-screenshot")), json(sent))
    }

    @Test
    fun `an error reply carries ok false and error code + message`() = runTest {
        val sent = reply("""{"type":"request","id":10,"device":"self","verb":"tap","args":{"x":1,"y":2}}""", Phone(on = false))
        assertEquals(json(fixture("response-error")), json(sent))
    }
}
