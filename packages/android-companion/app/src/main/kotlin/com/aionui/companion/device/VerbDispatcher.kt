package com.aionui.companion.device

import com.aionui.companion.protocol.UrlGuard
import com.aionui.companion.protocol.VerbError
import com.aionui.companion.protocol.boolean
import com.aionui.companion.protocol.number
import com.aionui.companion.protocol.string
import com.aionui.companion.relay.VerbHandler
import com.aionui.companion.relay.VerbResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Android KeyEvent codes the companion serves for `key{code}`. */
object Keys {
    const val HOME = 3
    const val BACK = 4
    const val ENTER = 66
    const val APP_SWITCH = 187
    val SERVED = setOf(HOME, BACK, ENTER, APP_SWITCH)
}

/**
 * Checks each request's args, enforces the owner's local switch (defence in depth:
 * core checks too) and runs one verb at a time on [DeviceActions].
 */
class VerbDispatcher(
    private val actions: DeviceActions,
    private val scope: CoroutineScope,
    private val timeoutMs: Long = 30_000,
    private val base64: (ByteArray) -> String = { java.util.Base64.getEncoder().encodeToString(it) },
) : VerbHandler {
    private val oneAtATime = Mutex()
    private val running = mutableSetOf<Job>()

    override fun handle(verb: String, args: JsonObject, reply: (VerbResult) -> Unit) {
        if (verb == "stop") {
            stopAll()
            reply(VerbResult.Ok(null))
            return
        }
        if (!actions.switchOn()) {
            reply(VerbResult.Failed(VerbError.SWITCH_OFF, SWITCHED_OFF))
            return
        }
        val call = try {
            parse(verb, args)
        } catch (error: VerbException) {
            reply(VerbResult.Failed(error.code, error.message))
            return
        }
        val job = scope.launch {
            val result = try {
                oneAtATime.withLock {
                    // Again at its turn: a verb queued (or racing a stop) before the owner's
                    // switch-off must not run after it.
                    if (!actions.switchOn()) throw VerbException(VerbError.SWITCH_OFF, SWITCHED_OFF)
                    withTimeout(timeoutMs) { call() }
                }
            } catch (error: VerbException) {
                VerbResult.Failed(error.code, error.message)
            } catch (_: TimeoutCancellationException) {
                VerbResult.Failed(VerbError.TIMEOUT, "$verb took longer than ${timeoutMs / 1000} s")
            } catch (error: CancellationException) {
                VerbResult.Failed(VerbError.FAILED, "stopped")
            } catch (error: Exception) {
                VerbResult.Failed(VerbError.FAILED, error.message ?: error.javaClass.simpleName)
            }
            reply(result)
        }
        synchronized(running) { running += job }
        job.invokeOnCompletion { synchronized(running) { running -= job } }
    }

    /** An agent action is running or waiting its turn. */
    fun busy(): Boolean = synchronized(running) { running.isNotEmpty() }

    override fun stopAll() {
        actions.cancelAll()
        synchronized(running) { running.toList() }.forEach { it.cancel() }
    }

    /** Validate args up front; the returned block runs the verb. */
    private fun parse(verb: String, args: JsonObject): suspend () -> VerbResult = when (verb) {
        "screenshot" -> {
            val scale = args.number("scale") ?: 1.0
            if (scale <= 0.0 || scale > 1.0) throw badArgs("scale must be in (0, 1]")
            val format = args.string("format")
            if (format != null && format !in ScreenshotPolicy.FORMATS) throw badArgs("format must be png or jpeg")
            suspend {
                val shot = actions.screenshot(scale, format)
                VerbResult.Ok(buildJsonObject {
                    put("format", shot.format)
                    put("width", shot.width)
                    put("height", shot.height)
                    put("data_base64", base64(shot.bytes))
                })
            }
        }
        "ui_tree" -> suspend {
            val dump = actions.uiTree()
            VerbResult.Ok(buildJsonObject {
                put("xml", dump.xml)
                put("nodes", dump.nodes)
                put("truncated", dump.truncated)
            })
        }
        "tap" -> {
            val x = coordinate(args, "x")
            val y = coordinate(args, "y")
            suspend {
                actions.tap(x, y)
                VerbResult.Ok(null)
            }
        }
        "swipe" -> {
            val x1 = coordinate(args, "x1")
            val y1 = coordinate(args, "y1")
            val x2 = coordinate(args, "x2")
            val y2 = coordinate(args, "y2")
            val duration = (args.number("duration_ms") ?: 300.0).toLong().coerceIn(1, 10_000)
            suspend {
                actions.swipe(x1, y1, x2, y2, duration)
                VerbResult.Ok(null)
            }
        }
        "text" -> {
            val value = args.string("value") ?: throw badArgs("value is required")
            if (value.length > 10_000) throw badArgs("value is longer than 10000 characters")
            // Appends by default (like `adb shell input text`); replace=true sets the whole field.
            val replace = args.boolean("replace") ?: false
            suspend {
                if (replace) actions.setText(value) else actions.text(value)
                VerbResult.Ok(null)
            }
        }
        "global" -> {
            val action = args.string("action") ?: throw badArgs("action is required")
            if (action !in GlobalActions.SERVED) throw badArgs("action $action is not served; use ${GlobalActions.SERVED}")
            suspend {
                actions.global(action)
                VerbResult.Ok(null)
            }
        }
        "open_url" -> {
            val checked = UrlGuard.check(args.string("url").orEmpty())
            val url = checked.url ?: throw badArgs(checked.reason ?: "url is not allowed")
            suspend {
                actions.openUrl(url)
                VerbResult.Ok(null)
            }
        }
        "click_text" -> {
            val text = args.string("text")?.trim().orEmpty()
            if (text.isEmpty()) throw badArgs("text is required")
            if (text.length > 500) throw badArgs("text is longer than 500 characters")
            val index = (args.number("index") ?: 0.0).toInt()
            if (index !in 0..99) throw badArgs("index must be 0..99")
            suspend {
                val click = actions.clickText(text, index)
                VerbResult.Ok(buildJsonObject {
                    put("matches", click.matches)
                    put("method", click.method)
                })
            }
        }
        "set_text" -> {
            val value = args.string("value") ?: throw badArgs("value is required")
            if (value.length > 10_000) throw badArgs("value is longer than 10000 characters")
            suspend {
                actions.setText(value)
                VerbResult.Ok(null)
            }
        }
        "key" -> {
            val code = args.number("code")?.toInt() ?: throw badArgs("code is required")
            if (code !in Keys.SERVED) throw badArgs("key $code is not served; use ${Keys.SERVED.sorted()}")
            suspend {
                actions.key(code)
                VerbResult.Ok(null)
            }
        }
        "launch" -> {
            val pkg = args.string("package") ?: throw badArgs("package is required")
            if (!PACKAGE.matches(pkg)) throw badArgs("package is not a valid Android package name")
            suspend {
                actions.launch(pkg)
                VerbResult.Ok(null)
            }
        }
        "foreground" -> suspend {
            VerbResult.Ok(buildJsonObject { put("package", actions.foregroundPackage()) })
        }
        else -> throw VerbException(VerbError.REFUSED, "verb $verb is not served by the companion")
    }

    private fun coordinate(args: JsonObject, key: String): Int {
        val value = args.number(key) ?: throw badArgs("$key is required")
        if (value < 0 || value > 100_000) throw badArgs("$key is out of range")
        return value.toInt()
    }

    private fun badArgs(message: String) = VerbException(VerbError.BAD_ARGS, message)

    private companion object {
        val PACKAGE = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$")
        const val SWITCHED_OFF = "the owner switched agents off on this phone"
    }
}
