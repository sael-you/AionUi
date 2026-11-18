package com.aionui.companion.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.content.IntentCompat
import java.io.File

/**
 * Installs a verified APK over the running app with a PackageInstaller session.
 * Android 12+: Android may skip its question for an app that updates itself, declares
 * UPDATE_PACKAGES_WITHOUT_USER_ACTION and asks for USER_ACTION_NOT_REQUIRED (the documented
 * conditions of `SessionParams.setRequireUserAction`). It is never guaranteed: the
 * question (STATUS_PENDING_USER_ACTION) is always handled. Older Android always asks.
 */
object UpdateInstaller {
    fun install(context: Context, file: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(file.length())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val sessionId = installer.createSession(params)
        try {
            installer.openSession(sessionId).use { session ->
                session.openWrite("base.apk", 0, file.length()).use { out ->
                    file.inputStream().use { it.copyTo(out, 64 * 1024) }
                    session.fsync(out)
                }
                val result = PendingIntent.getBroadcast(
                    context,
                    sessionId,
                    Intent(context, UpdateResultReceiver::class.java).setPackage(context.packageName),
                    // Android fills in the status extras: the intent has to be mutable.
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                )
                session.commit(result.intentSender)
            }
        } catch (error: Exception) {
            runCatching { installer.abandonSession(sessionId) }
            throw UpdateFailure(UpdateRefusal.INSTALL, error.message)
        }
    }
}

/** What Android answers to the install: its own question, or a failure. Success ends this process. */
class UpdateResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_SUCCESS -> Unit
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
                UpdateCenter.confirmNeeded(context, confirm)
            }
            PackageInstaller.STATUS_FAILURE_ABORTED -> UpdateCenter.failed(UpdateRefusal.DECLINED)
            else -> UpdateCenter.failed(UpdateRefusal.INSTALL)
        }
    }
}

/** Where Android's install answers reach the running updater (the receiver has no other way to it). */
object UpdateCenter {
    @Volatile
    var updater: Updater? = null

    /** Android's own install question, kept so the app's Install button can show it again. */
    @Volatile
    var pendingConfirm: Intent? = null
        private set

    fun confirmNeeded(context: Context, confirm: Intent?) {
        pendingConfirm = confirm
        updater?.confirmNeeded()
        // Shown at once when Android lets a background app open a screen; else from the app's button.
        confirm?.let { runCatching { context.startActivity(Intent(it).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
    }

    fun failed(reason: UpdateRefusal) {
        pendingConfirm = null
        updater?.failed(reason)
    }

    fun clear() {
        pendingConfirm = null
    }
}
