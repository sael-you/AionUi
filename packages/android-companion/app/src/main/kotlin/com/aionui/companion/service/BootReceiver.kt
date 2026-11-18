package com.aionui.companion.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.aionui.companion.store.TokenStore

/**
 * After a reboot or an update of the app: back on the relay, if the owner had it
 * connected (paired and not stopped). The owner's switch stays as they left it.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action !in ACTIONS) return
        if (!CompanionState.keepConnected(context) || TokenStore(context).load() == null) return
        // Android may refuse a foreground start in rare states; the owner opens the app then.
        runCatching {
            ContextCompat.startForegroundService(context, CompanionService.intent(context, CompanionService.ACTION_START))
        }
    }

    private companion object {
        val ACTIONS = setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)
    }
}
