package com.aionui.companion.device

import com.aionui.companion.protocol.RelayJson
import com.aionui.companion.relay.VerbResult
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class VerbDispatcherTest {
    private class FakeActions : DeviceActions {
        var on = true
        val calls = mutableListOf<String>()
        var hang = false
        var cancelled = 0

        override fun switchOn() = on
        override suspend fun screenshot(scale: Double, format: String?): Screenshot {
            calls += "screenshot $scale ${format ?: "auto"}"
            return Screenshot(format ?: "png", 2, 3, byteArrayOf(1, 2, 3))
        }
        override suspend fun uiTree(): UiTreeDump = UiTreeDump("<hierarchy/>", 0, truncated).also { calls += "ui_tree" }
        var truncated = false
        override suspend fun global(action: String) {
            calls += "global $action"
        }
        override suspend fun openUrl(url: String) {
            calls += "open_url $url"
        }
        override suspend fun tap(x: Int, y: Int) {
            calls += "tap $x $y"
            if (hang) awaitCancellation()
        }
        override suspend fun swipe(x1: Int, y1: Int, x2: Int, y2: Int, durationMs: Long) {
            calls += "swipe $x1 $y1 $x2 $y2 $durationMs"
        }
        override suspend fun text(value: String) {
            calls += "text $value"
        }
        override suspend fun clickText(text: String, index: Int): TextClick {
            calls += "click_text $text $index"
            return TextClick(2, "click")
        }
        override suspend fun setText(value: String) {
            calls += "set_text $value"
        }
        override suspend fun key(code: Int) {
            calls += "key $code"
        }
        override suspend fun launch(packageName: String) {
            calls += "launch $packageName"
        }
        override fun foregroundPackage() = "com.example.app"
        override fun cancelAll() {
            cancelled += 1
        }
    }

    private val actions = FakeActions()

    private fun TestScope.dispatcher(timeoutMs: Long = 30_000) =
        VerbDispatcher(actions, TestScope(StandardTestDispatcher(testScheduler)), timeoutMs)

    private fun args(json: String): JsonObject = RelayJson.parseToJsonElement(json).jsonObject

    private fun TestScope.run(d: VerbDispatcher, verb: String, json: String = "{}"): VerbResult {
        val result = CompletableDeferred<VerbResult>()
        d.handle(verb, args(json)) { result.complete(it) }
        advanceUntilIdle()
        return result.getCompleted()
    }

    @Test
    fun `runs each verb with its args`() = runTest {
        val d = dispatcher()
        assertEquals(VerbResult.Ok(null), run(d, "tap", """{"x":10,"y":20}"""))
        run(d, "swipe", """{"x1":1,"y1":2,"x2":3,"y2":4,"duration_ms":250}""")
        run(d, "text", """{"value":"hello"}""")
        run(d, "key", """{"code":4}""")
        run(d, "launch", """{"package":"com.android.chrome"}""")
        assertEquals(
            listOf("tap 10 20", "swipe 1 2 3 4 250", "text hello", "key 4", "launch com.android.chrome"),
            actions.calls,
        )
    }

    @Test
    fun `screenshot returns format, size and base64 bytes`() = runTest {
        val result = run(dispatcher(), "screenshot", """{"scale":0.5}""") as VerbResult.Ok
        val shot = result.result!!.jsonObject
        assertEquals("png", shot["format"]!!.jsonPrimitive.content)
        assertEquals("2", shot["width"]!!.jsonPrimitive.content)
        assertEquals("AQID", shot["data_base64"]!!.jsonPrimitive.content)
        assertEquals("screenshot 0.5 auto", actions.calls.single())
    }

    @Test
    fun `ui_tree and foreground answer with their fields`() = runTest {
        val d = dispatcher()
        assertEquals("<hierarchy/>", ((run(d, "ui_tree") as VerbResult.Ok).result!!.jsonObject["xml"])!!.jsonPrimitive.content)
        assertEquals(
            "com.example.app",
            ((run(d, "foreground") as VerbResult.Ok).result!!.jsonObject["package"])!!.jsonPrimitive.content,
        )
    }

    @Test
    fun `the owner's switch off refuses every verb but stop`() = runTest {
        actions.on = false
        val d = dispatcher()
        assertEquals("switch_off", (run(d, "tap", """{"x":1,"y":1}""") as VerbResult.Failed).code)
        assertEquals("switch_off", (run(d, "screenshot") as VerbResult.Failed).code)
        assertEquals(VerbResult.Ok(null), run(d, "stop"))
        assertTrue(actions.calls.isEmpty())
    }

    @Test
    fun `bad args are refused before anything runs`() = runTest {
        val d = dispatcher()
        val cases = listOf(
            "tap" to """{"x":1}""",
            "tap" to """{"x":-1,"y":1}""",
            "swipe" to """{"x1":1,"y1":2,"x2":3}""",
            "text" to """{}""",
            "key" to """{"code":25}""",
            "launch" to """{"package":"not a package"}""",
            "screenshot" to """{"scale":0}""",
            "screenshot" to """{"scale":2}""",
        )
        for ((verb, json) in cases) {
            assertEquals("$verb $json", "bad_args", (run(d, verb, json) as VerbResult.Failed).code)
        }
        assertEquals("refused", (run(d, "logcat") as VerbResult.Failed).code)
        assertTrue(actions.calls.isEmpty())
    }

    @Test
    fun `swipe duration is clamped to 1 to 10000 ms`() = runTest {
        val d = dispatcher()
        run(d, "swipe", """{"x1":0,"y1":0,"x2":1,"y2":1,"duration_ms":999999}""")
        run(d, "swipe", """{"x1":0,"y1":0,"x2":1,"y2":1,"duration_ms":0}""")
        assertEquals(listOf("swipe 0 0 1 1 10000", "swipe 0 0 1 1 1"), actions.calls)
    }

    @Test
    fun `a verb that hangs times out`() = runTest {
        actions.hang = true
        val result = run(dispatcher(timeoutMs = 5_000), "tap", """{"x":1,"y":1}""") as VerbResult.Failed
        assertEquals("timeout", result.code)
    }

    @Test
    fun `click_text clicks the exact text and says how, set_text replaces the field`() = runTest {
        val d = dispatcher()
        val clicked = run(d, "click_text", """{"text":"  Sign in ","index":1}""") as VerbResult.Ok
        assertEquals(2, clicked.result!!.jsonObject["matches"]!!.jsonPrimitive.content.toInt())
        assertEquals("click", clicked.result!!.jsonObject["method"]!!.jsonPrimitive.content)
        assertEquals(VerbResult.Ok(null), run(d, "set_text", """{"value":""}"""))
        assertEquals(listOf("click_text Sign in 1", "set_text "), actions.calls)
    }

    @Test
    fun `text appends by default and replaces the field with replace=true`() = runTest {
        val d = dispatcher()
        run(d, "text", """{"value":"a"}""")
        run(d, "text", """{"value":"b","replace":true}""")
        run(d, "text", """{"value":"c","replace":false}""")
        assertEquals(listOf("text a", "set_text b", "text c"), actions.calls)
    }

    @Test
    fun `global serves notifications, quick settings and lock, nothing else`() = runTest {
        val d = dispatcher()
        for (action in listOf("notifications", "quick_settings", "lock")) {
            assertEquals(VerbResult.Ok(null), run(d, "global", """{"action":"$action"}"""))
        }
        assertEquals("bad_args", (run(d, "global", """{"action":"power_dialog"}""") as VerbResult.Failed).code)
        assertEquals("bad_args", (run(d, "global", """{}""") as VerbResult.Failed).code)
        assertEquals(listOf("global notifications", "global quick_settings", "global lock"), actions.calls)
    }

    @Test
    fun `open_url opens web and market links only`() = runTest {
        val d = dispatcher()
        assertEquals(VerbResult.Ok(null), run(d, "open_url", """{"url":"https://example.com/a?b=1"}"""))
        assertEquals(VerbResult.Ok(null), run(d, "open_url", """{"url":"market://details?id=com.example"}"""))
        for (bad in listOf("""{}""", """{"url":"intent://x#Intent;end"}""", """{"url":"file:///sdcard/a"}""", """{"url":"javascript:alert(1)"}""")) {
            assertEquals("bad_args", (run(d, "open_url", bad) as VerbResult.Failed).code)
        }
        assertEquals(listOf("open_url https://example.com/a?b=1", "open_url market://details?id=com.example"), actions.calls)
    }

    @Test
    fun `screenshot takes scale and an optional format, ui_tree says when it was cut`() = runTest {
        val d = dispatcher()
        val jpeg = run(d, "screenshot", """{"scale":1,"format":"jpeg"}""") as VerbResult.Ok
        assertEquals("jpeg", jpeg.result!!.jsonObject["format"]!!.jsonPrimitive.content)
        assertEquals("bad_args", (run(d, "screenshot", """{"format":"webp"}""") as VerbResult.Failed).code)
        actions.truncated = true
        val tree = (run(d, "ui_tree") as VerbResult.Ok).result!!.jsonObject
        assertEquals("true", tree["truncated"]!!.jsonPrimitive.content)
        assertEquals("<hierarchy/>", tree["xml"]!!.jsonPrimitive.content)
        assertEquals(listOf("screenshot 1.0 jpeg", "ui_tree"), actions.calls)
    }

    @Test
    fun `click_text and set_text check their args`() = runTest {
        val d = dispatcher()
        for (bad in listOf("""{}""", """{"text":"  "}""", """{"text":"x","index":-1}""", """{"text":"x","index":100}""")) {
            assertEquals("bad_args", (run(d, "click_text", bad) as VerbResult.Failed).code)
        }
        assertEquals("bad_args", (run(d, "set_text", """{}""") as VerbResult.Failed).code)
        assertTrue(actions.calls.isEmpty())
    }

    @Test
    fun `stop cancels the running verb and the device work`() = runTest {
        actions.hang = true
        val d = dispatcher()
        val result = CompletableDeferred<VerbResult>()
        d.handle("tap", args("""{"x":1,"y":1}""")) { result.complete(it) }
        testScheduler.runCurrent()
        d.stopAll()
        advanceUntilIdle()
        assertEquals("failed", (result.getCompleted() as VerbResult.Failed).code)
        assertEquals(1, actions.cancelled)
    }

    @Test
    fun `owner stop - switch off then stopAll - ends the running verb and runs nothing queued`() = runTest {
        actions.hang = true
        val d = dispatcher()
        val running = CompletableDeferred<VerbResult>()
        val queued = CompletableDeferred<VerbResult>()
        d.handle("tap", args("""{"x":1,"y":1}""")) { running.complete(it) }
        testScheduler.runCurrent()
        d.handle("key", args("""{"code":4}""")) { queued.complete(it) }
        testScheduler.runCurrent()

        actions.on = false
        d.stopAll()
        advanceUntilIdle()

        assertEquals("failed", (running.getCompleted() as VerbResult.Failed).code)
        assertTrue(queued.getCompleted() is VerbResult.Failed)
        assertEquals(listOf("tap 1 1"), actions.calls)
        assertEquals(1, actions.cancelled)
    }

    @Test
    fun `a verb accepted just before the switch went off does not run`() = runTest {
        val d = dispatcher()
        val result = CompletableDeferred<VerbResult>()
        // Accepted while on; its turn comes after the owner switched off (a stop that missed it).
        d.handle("tap", args("""{"x":5,"y":5}""")) { result.complete(it) }
        actions.on = false
        advanceUntilIdle()
        assertEquals("switch_off", (result.getCompleted() as VerbResult.Failed).code)
        assertTrue(actions.calls.isEmpty())
    }
}
