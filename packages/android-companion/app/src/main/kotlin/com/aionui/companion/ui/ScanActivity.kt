package com.aionui.companion.ui

import android.os.Bundle
import android.view.KeyEvent
import androidx.appcompat.app.AppCompatActivity
import com.aionui.companion.R
import com.aionui.companion.protocol.PairingScan
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.CaptureManager
import com.journeyapps.barcodescanner.DecoratedBarcodeView

/**
 * The pairing scanner. Our own screen instead of the library's CaptureActivity, which
 * is fixed to landscape in its manifest: this one has no orientation of its own, so the
 * preview follows the phone (the library maps sensor to display rotation from there).
 *
 * AionUi shows the pairing QR next to the install-link QR: a code that is not a pairing
 * code is not an answer, the scanner says so and keeps looking.
 */
class ScanActivity : AppCompatActivity() {
    private lateinit var capture: CaptureManager
    private lateinit var scanner: DecoratedBarcodeView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_scan)
        scanner = findViewById(R.id.scanner)
        capture = object : CaptureManager(this, scanner) {
            override fun returnResult(rawResult: BarcodeResult) {
                when (PairingScan.judge(rawResult.text)) {
                    PairingScan.Verdict.PAIRING -> super.returnResult(rawResult)
                    PairingScan.Verdict.OTHER -> {
                        // The library paused the preview for its result: look again.
                        scanner.setStatusText(getString(R.string.scan_other_code))
                        scanner.resume()
                        decode()
                    }
                }
            }
        }
        capture.initializeFromIntent(intent, savedInstanceState)
        capture.decode()
    }

    override fun onResume() {
        super.onResume()
        capture.onResume()
    }

    override fun onPause() {
        super.onPause()
        capture.onPause()
    }

    override fun onDestroy() {
        super.onDestroy()
        capture.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        capture.onSaveInstanceState(outState)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        capture.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean =
        scanner.onKeyDown(keyCode, event) || super.onKeyDown(keyCode, event)
}
