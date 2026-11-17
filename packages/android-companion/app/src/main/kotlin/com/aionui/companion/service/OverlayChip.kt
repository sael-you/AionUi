package com.aionui.companion.service

import android.content.Context
import android.graphics.PixelFormat
import android.provider.Settings
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import com.aionui.companion.R
import com.google.android.material.button.MaterialButton

/**
 * "AionUi is controlling this phone · Stop" floating over every app while agents
 * may act. Needs "Display over other apps"; without it the notification is the only
 * indicator (it always is shown too).
 */
class OverlayChip(private val context: Context, private val onStop: () -> Unit) {
    private val windows = context.getSystemService(WindowManager::class.java)
    private var view: View? = null

    fun show() {
        if (view != null || !Settings.canDrawOverlays(context)) return
        val chip = LayoutInflater.from(context).inflate(R.layout.overlay_chip, null)
        chip.findViewById<MaterialButton>(R.id.overlay_stop).setOnClickListener { onStop() }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = 16
            y = 96
        }
        runCatching { windows.addView(chip, params) }.onSuccess { view = chip }
    }

    fun hide() {
        view?.let { runCatching { windows.removeView(it) } }
        view = null
    }
}
