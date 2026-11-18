package com.aionui.companion.update

/** The owner's choice: update by itself, ask first, or never. */
enum class UpdateMode { AUTO, ASK, OFF }

/** Where an update stands; the app's update row and the `update` event show it. */
sealed interface UpdateState {
    data object Idle : UpdateState
    /** "Check now" was pressed; no answer yet. */
    data object Checking : UpdateState
    data object UpToDate : UpdateState
    /** A newer build exists and waits for the owner (mode Ask or Off). */
    data class Available(val offer: UpdateOffer) : UpdateState
    data class Downloading(val offer: UpdateOffer, val percent: Int?) : UpdateState
    data class Verifying(val offer: UpdateOffer) : UpdateState
    /** Verified and ready, held back while an agent action runs. */
    data class Ready(val offer: UpdateOffer) : UpdateState
    /** Android shows its own install question (first update, or Android before 12). */
    data class WaitingConfirm(val offer: UpdateOffer) : UpdateState
    data class Installing(val offer: UpdateOffer) : UpdateState
    data class Failed(val versionCode: Int, val reason: UpdateRefusal) : UpdateState

    /** The `state` of the `update` event; null = nothing to tell core. */
    val wire: String?
        get() = when (this) {
            is Downloading -> "downloading"
            is Verifying, is Ready -> "verifying"
            is WaitingConfirm -> "waiting_confirm"
            is Installing -> "installing"
            is Failed -> "failed"
            Idle, Checking, UpToDate, is Available -> null
        }
}

sealed interface UpdateEvent {
    /** `update_available` from core. */
    data class Offered(val offer: UpdateOffer) : UpdateEvent
    /** The owner pressed "Check now". */
    data object CheckRequested : UpdateEvent
    /** Core did not answer a check (nothing newer is published). */
    data object NothingNewer : UpdateEvent
    /** The owner pressed Install on an available update. */
    data object Accepted : UpdateEvent
    data class Progress(val percent: Int?) : UpdateEvent
    data object Downloaded : UpdateEvent
    data object Verified : UpdateEvent
    /** No agent action is running any more. */
    data object Quiet : UpdateEvent
    data object ConfirmNeeded : UpdateEvent
    data class Failure(val reason: UpdateRefusal) : UpdateEvent
}

/** What the caller has to do after an event. */
enum class UpdateEffect { NONE, ASK_CORE, DOWNLOAD, VERIFY, INSTALL }

/**
 * The update flow as a state machine. Plain Kotlin, unit-tested: no download, no
 * install here, only what happens next.
 *
 * Auto starts on an offer; Ask and Off wait for the owner (Off still shows what a
 * "Check now" found). A running update is never restarted by a repeated offer, and
 * the install waits until no agent action runs.
 */
class UpdateMachine(private val ownVersionCode: Int) {
    var state: UpdateState = UpdateState.Idle
        private set

    fun on(event: UpdateEvent, mode: UpdateMode, agentBusy: Boolean): UpdateEffect {
        val current = state
        return when (event) {
            is UpdateEvent.Offered -> offered(event.offer, mode, current)
            UpdateEvent.CheckRequested ->
                if (inProgress(current)) UpdateEffect.NONE else move(UpdateState.Checking, UpdateEffect.ASK_CORE)
            UpdateEvent.NothingNewer ->
                if (current == UpdateState.Checking) move(UpdateState.UpToDate, UpdateEffect.NONE) else UpdateEffect.NONE
            UpdateEvent.Accepted ->
                if (current is UpdateState.Available) move(UpdateState.Downloading(current.offer, null), UpdateEffect.DOWNLOAD) else UpdateEffect.NONE
            is UpdateEvent.Progress ->
                if (current is UpdateState.Downloading) move(current.copy(percent = event.percent), UpdateEffect.NONE) else UpdateEffect.NONE
            UpdateEvent.Downloaded ->
                if (current is UpdateState.Downloading) move(UpdateState.Verifying(current.offer), UpdateEffect.VERIFY) else UpdateEffect.NONE
            UpdateEvent.Verified ->
                if (current !is UpdateState.Verifying) {
                    UpdateEffect.NONE
                } else if (agentBusy) {
                    move(UpdateState.Ready(current.offer), UpdateEffect.NONE)
                } else {
                    move(UpdateState.Installing(current.offer), UpdateEffect.INSTALL)
                }
            UpdateEvent.Quiet ->
                if (current is UpdateState.Ready && !agentBusy) move(UpdateState.Installing(current.offer), UpdateEffect.INSTALL) else UpdateEffect.NONE
            UpdateEvent.ConfirmNeeded ->
                if (current is UpdateState.Installing) move(UpdateState.WaitingConfirm(current.offer), UpdateEffect.NONE) else UpdateEffect.NONE
            is UpdateEvent.Failure -> {
                val code = offerOf(current)?.versionCode ?: ownVersionCode
                if (inProgress(current) || current is UpdateState.Available) move(UpdateState.Failed(code, event.reason), UpdateEffect.NONE) else UpdateEffect.NONE
            }
        }
    }

    private fun offered(offer: UpdateOffer, mode: UpdateMode, current: UpdateState): UpdateEffect {
        if (offer.versionCode <= ownVersionCode) {
            return if (current == UpdateState.Checking) move(UpdateState.UpToDate, UpdateEffect.NONE) else UpdateEffect.NONE
        }
        // The same build is already on its way: a repeated frame changes nothing.
        if (inProgress(current) && offerOf(current)?.versionCode == offer.versionCode) return UpdateEffect.NONE
        if (inProgress(current)) return UpdateEffect.NONE
        return if (mode == UpdateMode.AUTO) {
            move(UpdateState.Downloading(offer, null), UpdateEffect.DOWNLOAD)
        } else {
            move(UpdateState.Available(offer), UpdateEffect.NONE)
        }
    }

    private fun inProgress(state: UpdateState): Boolean = when (state) {
        is UpdateState.Downloading, is UpdateState.Verifying, is UpdateState.Ready,
        is UpdateState.Installing, is UpdateState.WaitingConfirm,
        -> true
        UpdateState.Idle, UpdateState.Checking, UpdateState.UpToDate, is UpdateState.Available, is UpdateState.Failed -> false
    }

    private fun offerOf(state: UpdateState): UpdateOffer? = when (state) {
        is UpdateState.Available -> state.offer
        is UpdateState.Downloading -> state.offer
        is UpdateState.Verifying -> state.offer
        is UpdateState.Ready -> state.offer
        is UpdateState.Installing -> state.offer
        is UpdateState.WaitingConfirm -> state.offer
        UpdateState.Idle, UpdateState.Checking, UpdateState.UpToDate, is UpdateState.Failed -> null
    }

    private fun move(next: UpdateState, effect: UpdateEffect): UpdateEffect {
        state = next
        return effect
    }
}
