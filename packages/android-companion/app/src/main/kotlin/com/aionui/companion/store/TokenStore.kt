package com.aionui.companion.store

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** What the phone keeps after pairing. */
data class Pairing(val host: String, val clientId: String, val token: String)

/**
 * The pairing token, encrypted with an AES-GCM key that never leaves the Android
 * Keystore; app-private storage, excluded from backups (manifest). The token is the
 * phone's only credential: core sends it once, at pairing.
 */
class TokenStore(context: Context) {
    private val prefs = context.getSharedPreferences("pairing", Context.MODE_PRIVATE)

    fun load(): Pairing? {
        val host = prefs.getString(KEY_HOST, null) ?: return null
        val clientId = prefs.getString(KEY_CLIENT, null) ?: return null
        val sealed = prefs.getString(KEY_TOKEN, null) ?: return null
        val token = runCatching { open(sealed) }.getOrNull() ?: return null
        return Pairing(host, clientId, token)
    }

    fun save(pairing: Pairing) {
        prefs.edit()
            .putString(KEY_HOST, pairing.host)
            .putString(KEY_CLIENT, pairing.clientId)
            .putString(KEY_TOKEN, seal(pairing.token))
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun seal(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val encoder = Base64.getEncoder()
        return encoder.encodeToString(cipher.iv) + ":" + encoder.encodeToString(sealed)
    }

    private fun open(stored: String): String {
        val (iv, sealed) = stored.split(':', limit = 2).also { require(it.size == 2) }
        val decoder = Base64.getDecoder()
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, decoder.decode(iv)))
        }
        return String(cipher.doFinal(decoder.decode(sealed)), Charsets.UTF_8)
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "aionui_companion_token"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val KEY_HOST = "host"
        const val KEY_CLIENT = "client_id"
        const val KEY_TOKEN = "token"
    }
}
