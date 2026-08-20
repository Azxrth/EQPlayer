package com.eqplayer

import android.content.ContentProvider
import android.content.ContentUris
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelFileDescriptor
import android.os.ProxyFileDescriptorCallback
import android.os.storage.StorageManager
import android.provider.MediaStore
import android.system.ErrnoException
import android.system.OsConstants
import java.io.FileInputStream

/**
 * Présente un fichier AIFF (PCM big-endian) comme un flux WAV (PCM little-endian)
 * à la volée, via un ProxyFileDescriptor (lecture aléatoire → seek supporté).
 *
 * ExoPlayer 2.19 (react-native-track-player) n'a pas d'extracteur AIFF mais gère
 * le WAV. On expose donc l'AIFF sous `content://com.eqplayer.aiff/<id MediaStore>`.
 * La source AIFF est ouverte via son URI MediaStore (les fichiers sont sur une SD
 * amovible, inaccessibles par chemin direct sous scoped storage). Aucune conversion
 * sur disque (les albums AIFF font plusieurs Go).
 */
class AiffWavProvider : ContentProvider() {

    private lateinit var handler: Handler

    override fun onCreate(): Boolean {
        handler = Handler(HandlerThread("aiff-wav").apply { start() }.looper)
        return true
    }

    override fun getType(uri: Uri): String = "audio/x-wav"

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? = try {
        openAiffAsWav(uri)
    } catch (e: Exception) {
        android.util.Log.e("AiffWavProvider", "openFile failed for $uri", e)
        null
    }

    private fun openAiffAsWav(uri: Uri): ParcelFileDescriptor? {
        val ctx = context ?: return null
        val id = uri.lastPathSegment?.toLongOrNull() ?: return null
        val mediaUri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id)

        val pfd = ctx.contentResolver.openFileDescriptor(mediaUri, "r") ?: run {
            android.util.Log.e("AiffWavProvider", "openFileDescriptor null for $mediaUri"); return null
        }
        val fis = FileInputStream(pfd.fileDescriptor)
        val ch = fis.channel
        val info = AiffInfo.parse(ch)
        if (info == null) {
            android.util.Log.e("AiffWavProvider", "AiffInfo.parse returned null for id=$id")
            try { fis.close(); pfd.close() } catch (_: Exception) {}; return null
        }

        val sm = ctx.getSystemService(StorageManager::class.java)
        return sm.openProxyFileDescriptor(
            ParcelFileDescriptor.MODE_READ_ONLY,
            object : ProxyFileDescriptorCallback() {
                override fun onGetSize(): Long = info.wavTotalSize
                override fun onRead(offset: Long, size: Int, data: ByteArray): Int =
                    try { info.readWav(ch, offset, size, data) }
                    catch (e: Exception) { throw ErrnoException("onRead", OsConstants.EIO) }
                override fun onRelease() { try { fis.close(); pfd.close() } catch (_: Exception) {} }
            },
            handler,
        )
    }

    // ContentProvider requiert ces méthodes ; non utilisées ici.
    override fun query(u: Uri, p: Array<String>?, s: String?, a: Array<String>?, o: String?): Cursor? = null
    override fun insert(u: Uri, v: ContentValues?): Uri? = null
    override fun update(u: Uri, v: ContentValues?, s: String?, a: Array<String>?): Int = 0
    override fun delete(u: Uri, s: String?, a: Array<String>?): Int = 0
}
