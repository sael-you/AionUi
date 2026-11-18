package com.aionui.companion.update

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.pm.PackageInfoCompat
import java.io.File
import java.security.MessageDigest

/**
 * Reads who signed the running app and a downloaded APK. An update is installed only
 * when both are signed by the same certificate (Android checks this again at install).
 */
object ApkCheck {
    class Archive(val packageName: String?, val versionCode: Long?, val signers: Set<String>)

    fun ownSigners(context: Context): Set<String> =
        runCatching { signers(context.packageManager.getPackageInfo(context.packageName, flags())) }.getOrDefault(emptySet())

    fun archive(context: Context, file: File): Archive {
        val info = runCatching { context.packageManager.getPackageArchiveInfo(file.absolutePath, flags()) }.getOrNull()
        return Archive(info?.packageName, info?.let { PackageInfoCompat.getLongVersionCode(it) }, info?.let { signers(it) } ?: emptySet())
    }

    /** Throws [UpdateFailure] unless [file] is this app, the announced version, signed like the running app. */
    fun verify(context: Context, file: File, offer: UpdateOffer, ownVersionCode: Int) {
        val archive = archive(context, file)
        if (!UpdateRules.sameSigner(ownSigners(context), archive.signers)) throw UpdateFailure(UpdateRefusal.SIGNATURE)
        UpdateRules.archiveRefusal(context.packageName, ownVersionCode, archive.packageName, archive.versionCode, offer)
            ?.let { throw UpdateFailure(it) }
    }

    @Suppress("DEPRECATION")
    private fun flags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Set<String> {
        val certificates = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners
        } else {
            info.signatures
        }
        return certificates.orEmpty().map { UpdateRules.hex(MessageDigest.getInstance("SHA-256").digest(it.toByteArray())) }.toSet()
    }
}
