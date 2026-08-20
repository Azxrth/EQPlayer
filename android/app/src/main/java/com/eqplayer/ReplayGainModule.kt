package com.eqplayer

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.RandomAccessFile

/**
 * Lecture des gains ReplayGain dans les tags d'un fichier (FLAC pour l'instant :
 * bloc VORBIS_COMMENT). Renvoie le gain piste/album en dB, ou null si absent.
 * Le calcul du facteur de volume + l'application sont faits côté JS.
 * S'appuie sur l'accès « tous les fichiers » (déjà demandé pour les paroles).
 */
class ReplayGainModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName() = "ReplayGain"

    @ReactMethod
    fun read(path: String, promise: Promise) {
        try {
            promise.resolve(readGains(path))
        } catch (e: Exception) {
            promise.resolve(null) // pas de gain → pas de normalisation pour cette piste
        }
    }

    private fun readGains(path: String): WritableMap? {
        val f = File(path)
        if (!f.canRead()) return null
        RandomAccessFile(f, "r").use { raf ->
            val magic = ByteArray(4)
            if (raf.read(magic) != 4 || String(magic) != "fLaC") return null // FLAC only
            // Parcours des blocs de métadonnées jusqu'au VORBIS_COMMENT (type 4).
            while (true) {
                val head = raf.read()
                if (head < 0) return null
                val isLast = (head and 0x80) != 0
                val type = head and 0x7F
                val b1 = raf.read(); val b2 = raf.read(); val b3 = raf.read()
                if (b1 < 0 || b2 < 0 || b3 < 0) return null
                val len = (b1 shl 16) or (b2 shl 8) or b3
                if (type == 4) {
                    val data = ByteArray(len)
                    if (raf.read(data) != len) return null
                    return parseVorbis(data)
                }
                raf.seek(raf.filePointer + len)
                if (isLast) return null
            }
        }
        @Suppress("UNREACHABLE_CODE")
        return null
    }

    // VORBIS_COMMENT : vendor (LE len + str), puis N commentaires (LE len + "K=V").
    private fun parseVorbis(d: ByteArray): WritableMap? {
        var p = 0
        fun u32(): Int {
            val v = (d[p].toInt() and 0xFF) or ((d[p + 1].toInt() and 0xFF) shl 8) or
                ((d[p + 2].toInt() and 0xFF) shl 16) or ((d[p + 3].toInt() and 0xFF) shl 24)
            p += 4; return v
        }
        if (d.size < 8) return null
        val vlen = u32(); p += vlen                 // saute le vendor
        if (p + 4 > d.size) return null
        val count = u32()
        var trackGain: Double? = null
        var albumGain: Double? = null
        var trackR128: Double? = null
        var albumR128: Double? = null
        for (i in 0 until count) {
            if (p + 4 > d.size) break
            val clen = u32()
            if (clen < 0 || p + clen > d.size) break
            val comment = String(d, p, clen, Charsets.UTF_8); p += clen
            val eq = comment.indexOf('='); if (eq < 0) continue
            val key = comment.substring(0, eq).uppercase()
            val value = comment.substring(eq + 1).trim()
            when (key) {
                "REPLAYGAIN_TRACK_GAIN" -> trackGain = parseDb(value)
                "REPLAYGAIN_ALBUM_GAIN" -> albumGain = parseDb(value)
                // R128 (Q7.8, référence -23 LUFS) → dB, aligné approx. sur ReplayGain (+5).
                "R128_TRACK_GAIN" -> value.toIntOrNull()?.let { trackR128 = it / 256.0 + 5.0 }
                "R128_ALBUM_GAIN" -> value.toIntOrNull()?.let { albumR128 = it / 256.0 + 5.0 }
            }
        }
        val track = trackGain ?: trackR128
        val album = albumGain ?: albumR128
        if (track == null && album == null) return null
        val map = Arguments.createMap()
        if (track != null) map.putDouble("track", track)
        if (album != null) map.putDouble("album", album)
        return map
    }

    // « -7.89 dB » / « -7.89 » → -7.89
    private fun parseDb(v: String): Double? =
        Regex("-?\\d+(\\.\\d+)?").find(v)?.value?.toDoubleOrNull()
}
