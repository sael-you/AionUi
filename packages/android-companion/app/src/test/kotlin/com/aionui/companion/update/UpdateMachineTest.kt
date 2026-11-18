package com.aionui.companion.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateMachineTest {
    private val offer = UpdateOffer("0.2.2", 5, "a".repeat(64), "/api/devices/companion.apk?t=T", 1_000, 9_999)
    private fun machine() = UpdateMachine(ownVersionCode = 4)
    private fun UpdateMachine.auto(event: UpdateEvent, busy: Boolean = false) = on(event, UpdateMode.AUTO, busy)

    @Test
    fun `Auto - an offer downloads, verifies and installs by itself`() {
        val m = machine()
        assertEquals(UpdateEffect.DOWNLOAD, m.auto(UpdateEvent.Offered(offer)))
        assertEquals(UpdateState.Downloading(offer, null), m.state)
        assertEquals(UpdateEffect.NONE, m.auto(UpdateEvent.Progress(40)))
        assertEquals(UpdateState.Downloading(offer, 40), m.state)
        assertEquals(UpdateEffect.VERIFY, m.auto(UpdateEvent.Downloaded))
        assertEquals(UpdateEffect.INSTALL, m.auto(UpdateEvent.Verified))
        assertEquals(UpdateState.Installing(offer), m.state)
        assertEquals("installing", m.state.wire)
    }

    @Test
    fun `never installs while an agent action runs - waits until it is quiet`() {
        val m = machine()
        m.auto(UpdateEvent.Offered(offer))
        m.auto(UpdateEvent.Downloaded)
        assertEquals(UpdateEffect.NONE, m.auto(UpdateEvent.Verified, busy = true))
        assertEquals(UpdateState.Ready(offer), m.state)
        assertEquals(UpdateEffect.NONE, m.auto(UpdateEvent.Quiet, busy = true))
        assertEquals(UpdateState.Ready(offer), m.state)
        assertEquals(UpdateEffect.INSTALL, m.auto(UpdateEvent.Quiet, busy = false))
        assertEquals(UpdateState.Installing(offer), m.state)
    }

    @Test
    fun `Ask and Off - an offer only shows - the owner's Install starts it`() {
        for (mode in listOf(UpdateMode.ASK, UpdateMode.OFF)) {
            val m = machine()
            assertEquals(UpdateEffect.NONE, m.on(UpdateEvent.Offered(offer), mode, false))
            assertEquals(UpdateState.Available(offer), m.state)
            assertNull(m.state.wire)
            assertEquals(UpdateEffect.DOWNLOAD, m.on(UpdateEvent.Accepted, mode, false))
            assertEquals(UpdateState.Downloading(offer, null), m.state)
        }
    }

    @Test
    fun `an offer that is not newer is ignored`() {
        val m = machine()
        assertEquals(UpdateEffect.NONE, m.auto(UpdateEvent.Offered(offer.copy(versionCode = 4))))
        assertEquals(UpdateState.Idle, m.state)
    }

    @Test
    fun `a repeated or second offer never restarts an update that is under way`() {
        val m = machine()
        m.auto(UpdateEvent.Offered(offer))
        m.auto(UpdateEvent.Progress(70))
        assertEquals(UpdateEffect.NONE, m.auto(UpdateEvent.Offered(offer)))
        assertEquals(UpdateEffect.NONE, m.auto(UpdateEvent.Offered(offer.copy(versionCode = 6, version = "0.2.3"))))
        assertEquals(UpdateState.Downloading(offer, 70), m.state)
    }

    @Test
    fun `Check now asks core - an answer shows the update, silence means up to date`() {
        val m = machine()
        assertEquals(UpdateEffect.ASK_CORE, m.on(UpdateEvent.CheckRequested, UpdateMode.OFF, false))
        assertEquals(UpdateState.Checking, m.state)
        assertEquals(UpdateEffect.NONE, m.on(UpdateEvent.NothingNewer, UpdateMode.OFF, false))
        assertEquals(UpdateState.UpToDate, m.state)

        m.on(UpdateEvent.CheckRequested, UpdateMode.OFF, false)
        m.on(UpdateEvent.Offered(offer), UpdateMode.OFF, false)
        assertEquals(UpdateState.Available(offer), m.state)
        // A late "nothing newer" timer does not hide what was found.
        m.on(UpdateEvent.NothingNewer, UpdateMode.OFF, false)
        assertEquals(UpdateState.Available(offer), m.state)

        // An answer with our own version is "up to date" too.
        val same = machine()
        same.auto(UpdateEvent.CheckRequested)
        same.auto(UpdateEvent.Offered(offer.copy(versionCode = 4)))
        assertEquals(UpdateState.UpToDate, same.state)
    }

    @Test
    fun `Check now does not disturb a running update`() {
        val m = machine()
        m.auto(UpdateEvent.Offered(offer))
        assertEquals(UpdateEffect.NONE, m.auto(UpdateEvent.CheckRequested))
        assertEquals(UpdateState.Downloading(offer, null), m.state)
    }

    @Test
    fun `Android's own install question - waiting, and a decline is a failure the next offer can retry`() {
        val m = machine()
        m.auto(UpdateEvent.Offered(offer))
        m.auto(UpdateEvent.Downloaded)
        m.auto(UpdateEvent.Verified)
        m.auto(UpdateEvent.ConfirmNeeded)
        assertEquals(UpdateState.WaitingConfirm(offer), m.state)
        assertEquals("waiting_confirm", m.state.wire)
        m.auto(UpdateEvent.Failure(UpdateRefusal.DECLINED))
        assertEquals(UpdateState.Failed(5, UpdateRefusal.DECLINED), m.state)
        assertEquals("failed", m.state.wire)
        assertEquals(UpdateEffect.DOWNLOAD, m.auto(UpdateEvent.Offered(offer)))
    }

    @Test
    fun `a wrong hash or signer ends the update as failed`() {
        for (reason in listOf(UpdateRefusal.BAD_HASH, UpdateRefusal.SIGNATURE)) {
            val m = machine()
            m.auto(UpdateEvent.Offered(offer))
            m.auto(UpdateEvent.Downloaded)
            assertEquals(UpdateEffect.NONE, m.auto(UpdateEvent.Failure(reason)))
            assertEquals(UpdateState.Failed(5, reason), m.state)
            // Nothing can move a failed update on to an install.
            assertEquals(UpdateEffect.NONE, m.auto(UpdateEvent.Verified))
            assertEquals(UpdateEffect.NONE, m.auto(UpdateEvent.Quiet))
            assertTrue(m.state is UpdateState.Failed)
        }
    }

    @Test
    fun `events out of order do nothing`() {
        val m = machine()
        assertEquals(UpdateEffect.NONE, m.auto(UpdateEvent.Downloaded))
        assertEquals(UpdateEffect.NONE, m.auto(UpdateEvent.Verified))
        assertEquals(UpdateEffect.NONE, m.auto(UpdateEvent.Accepted))
        assertEquals(UpdateEffect.NONE, m.auto(UpdateEvent.Failure(UpdateRefusal.DOWNLOAD)))
        assertEquals(UpdateState.Idle, m.state)
    }
}
