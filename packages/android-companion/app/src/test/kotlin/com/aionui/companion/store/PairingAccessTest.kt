package com.aionui.companion.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingAccessTest {
    @Test
    fun `only the adb shell and root may read`() {
        assertTrue(PairingAccess.allowed(2000))
        assertTrue(PairingAccess.allowed(0))
        assertFalse(PairingAccess.allowed(1000))
        assertFalse(PairingAccess.allowed(10_123))
        assertFalse(PairingAccess.allowed(-1))
    }

    @Test(expected = SecurityException::class)
    fun `an app on the phone is refused`() {
        PairingAccess.check(10_123, listOf("client"))
    }

    @Test
    fun `the shell reads exactly the client path`() {
        PairingAccess.check(2000, listOf("client"))
        PairingAccess.check(0, listOf("client"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `any other path is refused`() {
        PairingAccess.check(2000, listOf("token"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `the root path is refused`() {
        PairingAccess.check(2000, emptyList())
    }

    @Test
    fun `answers the client id, empty when not paired or malformed`() {
        assertEquals("cl_01a1-XYZ", PairingAccess.clientIdOf("cl_01a1-XYZ"))
        assertEquals("", PairingAccess.clientIdOf(null))
        assertEquals("", PairingAccess.clientIdOf(""))
        assertEquals("", PairingAccess.clientIdOf("has space"))
        assertEquals("", PairingAccess.clientIdOf("x".repeat(65)))
    }

    @Test
    fun `the names the Mac helper and core rely on`() {
        assertEquals("com.aionui.companion.pairing", PairingAccess.AUTHORITY)
        assertEquals("client", PairingAccess.PATH)
        assertEquals("client_id", PairingAccess.COLUMN)
    }
}
