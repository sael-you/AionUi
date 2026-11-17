package com.aionui.companion.store

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Binder

/**
 * The one thing a computer over adb may read from the app: which AionUi client this
 * phone is paired as, so core can merge a Mac-relay phone with its companion card
 * (K3). `adb shell content query --uri content://com.aionui.companion.pairing/client`
 * → one row, column `client_id` (empty when not paired).
 *
 * Exported because the shell user cannot reach a private provider, but it answers only
 * the shell (2000) and root (0) uids: any app on the phone is refused. Read-only;
 * never the token or the host.
 */
class PairingProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor {
        PairingAccess.check(Binder.getCallingUid(), uri.pathSegments)
        val stored = context?.let { TokenStore(it).load()?.clientId }
        return MatrixCursor(arrayOf(PairingAccess.COLUMN)).apply { addRow(arrayOf(PairingAccess.clientIdOf(stored))) }
    }

    override fun getType(uri: Uri): String? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw PairingAccess.readOnly()

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int =
        throw PairingAccess.readOnly()

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int =
        throw PairingAccess.readOnly()
}

/** Who may read the pairing provider and what it answers; plain Kotlin, unit-tested. */
object PairingAccess {
    const val AUTHORITY = "com.aionui.companion.pairing"
    const val PATH = "client"
    const val COLUMN = "client_id"
    const val SHELL_UID = 2000
    const val ROOT_UID = 0
    private val CLIENT_ID = Regex("[A-Za-z0-9_-]{1,64}")

    fun allowed(callingUid: Int): Boolean = callingUid == SHELL_UID || callingUid == ROOT_UID

    /** Throws unless an adb shell (or root) asks for exactly `/client`. */
    fun check(callingUid: Int, pathSegments: List<String>) {
        if (!allowed(callingUid)) throw SecurityException("only adb shell may read the pairing")
        require(pathSegments == listOf(PATH)) { "unknown path; use content://$AUTHORITY/$PATH" }
    }

    /** The stored id when it is a well-formed client id, else empty (= not paired). */
    fun clientIdOf(stored: String?): String = stored?.takeIf { CLIENT_ID.matches(it) } ?: ""

    fun readOnly() = UnsupportedOperationException("the pairing provider is read-only")
}
