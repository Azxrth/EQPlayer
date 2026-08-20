package com.eqplayer

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Lecture des paroles en fichier sidecar « .lrc » posé à côté du morceau
 * (même dossier, même nom de base). Les fichiers de la carte SD appartiennent au
 * groupe media_rw et ne sont PAS lisibles par l'app en accès direct sous le
 * stockage cloisonné d'Android 13 → on s'appuie sur l'accès « tous les fichiers »
 * (MANAGE_EXTERNAL_STORAGE), classique pour un lecteur audio sideloadé sur DAP.
 */
class LyricsModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName() = "Lyrics"

    // L'accès « tous les fichiers » est-il accordé ? (avant Android 11 : rien à demander)
    @ReactMethod
    fun isGranted(promise: Promise) {
        val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
            Environment.isExternalStorageManager() else true
        promise.resolve(ok)
    }

    // Ouvre l'écran système « Accès à tous les fichiers » pour cette app.
    @ReactMethod
    fun requestAccess(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                    .setData(Uri.parse("package:${ctx.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(intent)
            }
            promise.resolve(null)
        } catch (e: Exception) {
            // Repli : page de réglages générale de l'accès tous fichiers
            try {
                val intent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(intent)
            } catch (_: Exception) {}
            promise.resolve(null)
        }
    }

    // Renvoie le texte brut du .lrc voisin du morceau, ou null s'il n'y en a pas
    // (ou fichier vide / illisible). Le parsing LRC est fait côté JS.
    @ReactMethod
    fun read(audioPath: String, promise: Promise) {
        try {
            val lrcPath = lrcPathFor(audioPath)
            if (lrcPath == null) { promise.resolve(null); return }
            val f = File(lrcPath)
            if (!f.exists() || !f.canRead() || f.length() == 0L) { promise.resolve(null); return }
            promise.resolve(decode(f.readBytes()))
        } catch (e: Exception) {
            promise.resolve(null) // pas de paroles → l'UI l'affiche simplement
        }
    }

    // Remplace l'extension du morceau par « .lrc ».
    private fun lrcPathFor(audioPath: String): String? {
        val slash = audioPath.lastIndexOf('/')
        val dot = audioPath.lastIndexOf('.')
        if (dot <= slash) return null
        return audioPath.substring(0, dot) + ".lrc"
    }

    // Décode en tenant compte d'un éventuel BOM (UTF-8 / UTF-16), défaut UTF-8.
    private fun decode(bytes: ByteArray): String {
        if (bytes.size >= 3 && bytes[0] == 0xEF.toByte() && bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte())
            return String(bytes, 3, bytes.size - 3, Charsets.UTF_8)
        if (bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte())
            return String(bytes, 2, bytes.size - 2, Charsets.UTF_16LE)
        if (bytes.size >= 2 && bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte())
            return String(bytes, 2, bytes.size - 2, Charsets.UTF_16BE)
        return String(bytes, Charsets.UTF_8)
    }
}
