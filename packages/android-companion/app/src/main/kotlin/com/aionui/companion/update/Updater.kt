package com.aionui.companion.update

import android.content.Context
import com.aionui.companion.BuildConfig
import com.aionui.companion.protocol.Frames
import com.aionui.companion.relay.OkHttpSockets
import com.aionui.companion.service.CompanionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File

/**
 * Runs the update flow on the phone: what [UpdateMachine] decides, done for real.
 * Every event goes through one lock, so the machine sees them in order.
 *
 * @param pairedHost the host this app is paired with (downloads go nowhere else).
 * @param agentBusy an agent action runs or waits: no install now.
 * @param send a frame for core (`update_check`, `update` progress); dropped when offline.
 */
class Updater(
    appContext: Context,
    private val scope: CoroutineScope,
    private val pairedHost: () -> String?,
    private val agentBusy: () -> Boolean,
    private val send: (String) -> Unit,
) : UpdateSignals {
    private val context: Context = appContext.applicationContext
    private val machine = UpdateMachine(BuildConfig.VERSION_CODE)
    private val downloader = UpdateDownloader(OkHttpSockets.defaultClient(), File(context.cacheDir, "update"))
    private var work: Job? = null
    private var file: File? = null

    init {
        // "Never while an agent action runs": a verified update waits here until it is quiet.
        scope.launch {
            while (isActive) {
                delay(QUIET_POLL_MS)
                if (machine.state is UpdateState.Ready) dispatch(UpdateEvent.Quiet)
            }
        }
    }

    fun offered(offer: UpdateOffer) = dispatch(UpdateEvent.Offered(offer))
    fun checkNow() = dispatch(UpdateEvent.CheckRequested)
    fun accept() = dispatch(UpdateEvent.Accepted)
    override fun confirmNeeded() = dispatch(UpdateEvent.ConfirmNeeded)
    override fun failed(reason: UpdateRefusal) = dispatch(UpdateEvent.Failure(reason))

    @Synchronized
    private fun dispatch(event: UpdateEvent) {
        val before = machine.state
        val effect = machine.on(event, CompanionState.updateMode(context), agentBusy())
        val state = machine.state
        if (state != before) {
            CompanionState.setUpdate(state)
            report(state, before)
        }
        when (effect) {
            UpdateEffect.NONE -> Unit
            UpdateEffect.ASK_CORE -> askCore()
            UpdateEffect.DOWNLOAD -> (state as? UpdateState.Downloading)?.let { download(it.offer) }
            UpdateEffect.VERIFY -> (state as? UpdateState.Verifying)?.let { verify(it.offer) }
            UpdateEffect.INSTALL -> (state as? UpdateState.Installing)?.let { install(it.offer) }
        }
    }

    /** One `update` event per step (not per percent). */
    private fun report(state: UpdateState, before: UpdateState) {
        val wire = state.wire ?: return
        if (wire == before.wire && state !is UpdateState.Failed) return
        val (code, error) = when (state) {
            is UpdateState.Failed -> state.versionCode to state.reason.code
            is UpdateState.Downloading -> state.offer.versionCode to null
            is UpdateState.Verifying -> state.offer.versionCode to null
            is UpdateState.Ready -> state.offer.versionCode to null
            is UpdateState.WaitingConfirm -> state.offer.versionCode to null
            is UpdateState.Installing -> state.offer.versionCode to null
            else -> return
        }
        send(Frames.update(wire, code, error))
    }

    private fun askCore() {
        send(Frames.updateCheck())
        scope.launch {
            delay(CHECK_TIMEOUT_MS)
            dispatch(UpdateEvent.NothingNewer)
        }
    }

    private fun download(offer: UpdateOffer) {
        work?.cancel()
        work = scope.launch(Dispatchers.IO) {
            val host = pairedHost().orEmpty()
            val refusal = UpdateRules.refusal(offer, BuildConfig.VERSION_CODE, host, System.currentTimeMillis())
            val url = UpdateRules.resolveUrl(offer.url, host)
            if (refusal != null || url == null) {
                // A dead link is asked for again: core answers with a fresh offer.
                if (refusal == UpdateRefusal.EXPIRED) send(Frames.updateCheck())
                dispatch(UpdateEvent.Failure(refusal ?: UpdateRefusal.BAD_URL))
                return@launch
            }
            try {
                file = downloader.download(url, offer) { percent -> dispatch(UpdateEvent.Progress(percent)) }
                dispatch(UpdateEvent.Downloaded)
            } catch (failure: UpdateFailure) {
                if (failure.reason == UpdateRefusal.EXPIRED) send(Frames.updateCheck())
                dispatch(UpdateEvent.Failure(failure.reason))
            }
        }
    }

    private fun verify(offer: UpdateOffer) {
        work = scope.launch(Dispatchers.IO) {
            val apk = file
            try {
                if (apk == null || !apk.isFile) throw UpdateFailure(UpdateRefusal.DOWNLOAD)
                ApkCheck.verify(context, apk, offer, BuildConfig.VERSION_CODE)
                dispatch(UpdateEvent.Verified)
            } catch (failure: UpdateFailure) {
                apk?.delete()
                dispatch(UpdateEvent.Failure(failure.reason))
            }
        }
    }

    private fun install(offer: UpdateOffer) {
        work = scope.launch(Dispatchers.IO) {
            val apk = file
            try {
                if (apk == null || !apk.isFile) throw UpdateFailure(UpdateRefusal.DOWNLOAD)
                // Remembered so the new build can say "Updated to x" when it starts.
                CompanionState.setUpdatingTo(context, offer.versionCode, offer.version)
                UpdateInstaller.install(context, apk)
            } catch (failure: UpdateFailure) {
                dispatch(UpdateEvent.Failure(failure.reason))
            }
        }
    }

    private companion object {
        const val CHECK_TIMEOUT_MS = 10_000L
        const val QUIET_POLL_MS = 5_000L
    }
}
