package com.eqplayer

import android.app.Activity
import android.content.ContentUris
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import com.facebook.react.bridge.*
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

class MusicLibraryModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "MusicLibrary"

    private var pendingDelete: Promise? = null
    private val deleteReqCode = 7321

    init {
        // Récupère le résultat de la confirmation système de suppression.
        reactContext.addActivityEventListener(object : BaseActivityEventListener() {
            override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
                if (requestCode == deleteReqCode) {
                    pendingDelete?.resolve(resultCode == Activity.RESULT_OK)
                    pendingDelete = null
                }
            }
        })
    }

    // Supprime le fichier audio via MediaStore. Sur Android 11+ l'OS affiche une
    // boîte de confirmation système (createDeleteRequest) → résultat via l'activity.
    @ReactMethod
    fun deleteTrack(id: String, promise: Promise) {
        try {
            val resolver = reactApplicationContext.contentResolver
            val uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id.toLong())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val activity = reactApplicationContext.currentActivity
                    ?: return promise.reject("NO_ACTIVITY", "Activité indisponible")
                val pi = MediaStore.createDeleteRequest(resolver, listOf(uri))
                pendingDelete = promise
                activity.startIntentSenderForResult(pi.intentSender, deleteReqCode, null, 0, 0, 0)
            } else {
                val n = resolver.delete(uri, null, null)
                promise.resolve(n > 0)
            }
        } catch (e: Exception) {
            pendingDelete = null
            promise.reject("DELETE_ERROR", e.message, e)
        }
    }

    // Holder intermédiaire : on collecte les lignes du curseur puis on remplit
    // sampleRate/bitDepth en parallèle avant de construire le tableau JS.
    private class Row(
        val id: String, val title: String, val artist: String, val album: String,
        val albumId: String, var artUri: String, val duration: Double, val filePath: String,
        val year: String, val format: String, val genre: String, val mime: String,
    ) {
        var sampleRate = 0
        var bitDepth = 0
    }

    @ReactMethod
    fun getTracks(promise: Promise) {
        Thread {
            try {
                val tracks = WritableNativeArray()
                val resolver = reactApplicationContext.contentResolver

                // Colonnes du scan principal
                val projection = buildList {
                    add(MediaStore.Audio.Media._ID)
                    add(MediaStore.Audio.Media.TITLE)
                    add(MediaStore.Audio.Media.ARTIST)
                    add(MediaStore.Audio.Media.ALBUM)
                    add(MediaStore.Audio.Media.ALBUM_ID)
                    add(MediaStore.Audio.Media.DURATION)
                    add(MediaStore.Audio.Media.DATA)
                    add(MediaStore.Audio.Media.YEAR)
                    add(MediaStore.Audio.Media.MIME_TYPE)
                    add(MediaStore.Audio.Media.DATE_ADDED)
                    add(MediaStore.Audio.Media.SIZE)
                    // GENRE disponible nativement à partir de Android 11 (API 30)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        add(MediaStore.Audio.Media.GENRE)
                    }
                    // NB : SAMPLERATE/BITS_PER_SAMPLE (colonnes API 31) ne sont pas
                    // exposées par toutes les ROMs (ex. FiiO) et font planter la
                    // requête → on lit le taux par fichier via MediaExtractor plus bas.
                }.toTypedArray()

                val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND ${MediaStore.Audio.Media.DURATION} > 10000"
                val sortOrder = "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC"

                val cursor = resolver.query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    selection,
                    null,
                    sortOrder
                )

                // Map genre pour Android < 11
                val genreMap: Map<Long, String> = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                    buildGenreMap()
                } else emptyMap()

                val rows = ArrayList<Row>()
                cursor?.use {
                    val idCol         = it.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                    val titleCol      = it.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                    val artistCol     = it.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                    val albumCol      = it.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                    val albumIdCol    = it.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
                    val durationCol   = it.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                    val dataCol       = it.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA)
                    val yearCol       = it.getColumnIndexOrThrow(MediaStore.Audio.Media.YEAR)
                    val mimeCol       = it.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE)
                    val genreColIdx   = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
                                           it.getColumnIndex(MediaStore.Audio.Media.GENRE)
                                       else -1

                    while (it.moveToNext()) {
                        val id      = it.getLong(idCol)
                        val albumId = it.getLong(albumIdCol)

                        // URI cover compatible API 29+ et API < 29
                        val artUri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            "content://media/external/audio/media/$id/albumart"
                        } else {
                            ContentUris.withAppendedId(
                                Uri.parse("content://media/external/audio/albumart"),
                                albumId
                            ).toString()
                        }

                        val mime     = it.getString(mimeCol) ?: ""
                        val filePath = it.getString(dataCol) ?: ""
                        // DSD : MediaStore renvoie souvent un mime générique → on
                        // retombe sur l'extension du fichier.
                        val isDsd  = mime.contains("dsd") || mime.contains("dsf") ||
                                     filePath.endsWith(".dsf", true) || filePath.endsWith(".dff", true)
                        val format = if (isDsd) "DSD" else mimeToFormat(mime)

                        val genre = when {
                            genreColIdx >= 0 -> it.getString(genreColIdx) ?: ""
                            else -> genreMap[id] ?: ""
                        }

                        val year = it.getInt(yearCol).let { y -> if (y > 0) y.toString() else "" }

                        rows.add(Row(
                            id = id.toString(),
                            title = it.getString(titleCol)?.trim() ?: "Titre inconnu",
                            artist = sanitizeUnknown(it.getString(artistCol)),
                            album = sanitizeUnknown(it.getString(albumCol)),
                            albumId = albumId.toString(),
                            artUri = artUri,
                            duration = it.getLong(durationCol).toDouble(),
                            filePath = filePath,
                            year = year,
                            format = format,
                            genre = genre,
                            mime = mime,
                        ))
                    }
                }

                // Lecture parallèle des en-têtes (I/O bound) : indispensable pour
                // ne pas bloquer ~30 s à scanner des milliers de fichiers en série.
                val pool = Executors.newFixedThreadPool(8)
                try {
                    rows.map { row ->
                        pool.submit {
                            val (sr, bd) = readAudioFormat(row.filePath)
                            row.sampleRate = sr
                            row.bitDepth = bd
                        }
                    }.forEach { it.get() }
                } finally {
                    pool.shutdown()
                }

                // Extraction des pochettes vers un cache fichier (file://).
                // POURQUOI : une <Image source={content://...}> force Fresco à appeler
                // ContentResolver.getType() de façon SYNCHRONE sur le thread UI ; sur
                // certaines ROMs (FiiO) ce provider est très lent → ANR. Une URI file://
                // évite complètement ce chemin. On extrait ici, sur des threads de fond,
                // une seule fois (cache disque persistant), dédupliqué par album.
                resolveArtwork(rows)

                for (row in rows) {
                    tracks.pushMap(WritableNativeMap().apply {
                        putString("id",       row.id)
                        putString("title",    row.title)
                        putString("artist",   row.artist)
                        putString("album",    row.album)
                        putString("albumId",  row.albumId)
                        putString("artUri",   row.artUri)
                        putDouble("duration", row.duration)
                        putString("filePath", row.filePath)
                        putString("year",     row.year)
                        putString("format",   row.format)
                        putString("genre",    row.genre)
                        putString("mime",     row.mime)
                        putInt("sampleRate",  row.sampleRate)
                        putInt("bitDepth",    row.bitDepth)
                    })
                }

                promise.resolve(tracks)
            } catch (e: Exception) {
                promise.reject("SCAN_ERROR", e.message ?: "Erreur inconnue", e)
            }
        }.start()
    }

    // Construit la map trackId -> genre pour Android < API 30
    private fun buildGenreMap(): Map<Long, String> {
        val map = mutableMapOf<Long, String>()
        val resolver = reactApplicationContext.contentResolver
        try {
            val genreCursor = resolver.query(
                MediaStore.Audio.Genres.EXTERNAL_CONTENT_URI,
                arrayOf(MediaStore.Audio.Genres._ID, MediaStore.Audio.Genres.NAME),
                null, null, null
            ) ?: return map

            genreCursor.use { gc ->
                val gIdCol   = gc.getColumnIndexOrThrow(MediaStore.Audio.Genres._ID)
                val gNameCol = gc.getColumnIndexOrThrow(MediaStore.Audio.Genres.NAME)
                while (gc.moveToNext()) {
                    val genreId   = gc.getLong(gIdCol)
                    val genreName = gc.getString(gNameCol) ?: continue
                    val membersUri = MediaStore.Audio.Genres.Members.getContentUri("external", genreId)
                    resolver.query(
                        membersUri,
                        arrayOf(MediaStore.Audio.Genres.Members.AUDIO_ID),
                        null, null, null
                    )?.use { mc ->
                        val audioIdCol = mc.getColumnIndexOrThrow(MediaStore.Audio.Genres.Members.AUDIO_ID)
                        while (mc.moveToNext()) {
                            map[mc.getLong(audioIdCol)] = genreName
                        }
                    }
                }
            }
        } catch (_: Exception) {}
        return map
    }

    // Lit (sampleRate Hz, bitDepth bits) depuis l'en-tête du fichier audio.
    // MediaExtractor ne décode pas : il ne parse que le format → rapide.
    // Best-effort : renvoie (0, 0) si illisible (ex. DSD non supporté).
    private fun readAudioFormat(path: String): Pair<Int, Int> {
        if (path.isEmpty()) return 0 to 0
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(path)
            for (i in 0 until extractor.trackCount) {
                val fmt = extractor.getTrackFormat(i)
                val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
                if (!mime.startsWith("audio/")) continue
                val sampleRate = if (fmt.containsKey(MediaFormat.KEY_SAMPLE_RATE))
                    fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 0
                // Pas de clé standard pour la profondeur ; certaines pistes l'exposent.
                val bitDepth = when {
                    fmt.containsKey("bits-per-sample") -> fmt.getInteger("bits-per-sample")
                    fmt.containsKey(MediaFormat.KEY_PCM_ENCODING) -> when (fmt.getInteger(MediaFormat.KEY_PCM_ENCODING)) {
                        2 -> 16  // ENCODING_PCM_16BIT
                        3 -> 8   // ENCODING_PCM_8BIT
                        4 -> 32  // ENCODING_PCM_FLOAT
                        0x15000001 -> 32 // ENCODING_PCM_24BIT_PACKED → reporté 24 plus bas
                        else -> 0
                    }
                    else -> 0
                }
                return sampleRate to bitDepth
            }
        } catch (_: Exception) {
            // fichier illisible par MediaExtractor (DSD, corrompu…) → 0/0
        } finally {
            extractor.release()
        }
        return 0 to 0
    }

    // Remplit row.artUri avec une URI file:// pointant vers une pochette extraite
    // en cache. Dédupliqué par album (clé = albumId, ou id de piste si album inconnu).
    // Échec / pas de pochette → artUri = "" (l'UI affiche alors une tuile par genre).
    private fun resolveArtwork(rows: List<Row>) {
        val dir = File(reactApplicationContext.filesDir, "albumart").apply { mkdirs() }

        // Clé de cache d'une ligne : par album si possible, sinon par piste.
        fun keyOf(row: Row): String =
            if (row.albumId.isNotBlank() && row.albumId != "0") "al_${row.albumId}"
            else "tr_${row.id}"

        // Une ligne représentative par clé (la première rencontrée).
        val repByKey = LinkedHashMap<String, Row>()
        for (row in rows) repByKey.getOrPut(keyOf(row)) { row }

        // Extraction en parallèle, une fois par clé.
        val pool = Executors.newFixedThreadPool(6)
        val pathByKey = java.util.concurrent.ConcurrentHashMap<String, String>()
        try {
            repByKey.map { (key, rep) ->
                pool.submit {
                    val dest = File(dir, "$key.jpg")
                    val ok = dest.length() > 0 || extractArtwork(rep, dest)
                    if (ok) pathByKey[key] = "file://${dest.absolutePath}"
                }
            }.forEach { it.get() }
        } finally {
            pool.shutdown()
        }

        for (row in rows) row.artUri = pathByKey[keyOf(row)] ?: ""
    }

    // Écrit une pochette JPEG (~512 px) dans dest. true si réussi.
    // 1) pochette embarquée dans le fichier (lecture directe, rapide, indépendante
    //    du MediaProvider lent) ; 2) repli sur loadThumbnail (API 29+) pour les
    //    pochettes externes (folder.jpg…). Décodage échantillonné pour la mémoire.
    private fun extractArtwork(rep: Row, dest: File): Boolean {
        // 1) Pochette embarquée
        if (rep.filePath.isNotEmpty()) {
            val mmr = MediaMetadataRetriever()
            try {
                mmr.setDataSource(rep.filePath)
                val bytes = mmr.embeddedPicture
                if (bytes != null && bytes.isNotEmpty()) {
                    val bmp = decodeSampled(bytes, 512)
                    if (bmp != null && writeJpeg(bmp, dest)) { bmp.recycle(); return true }
                }
            } catch (_: Exception) {
            } finally {
                mmr.release()
            }
        }
        // 2) Repli MediaStore (peut être lent, mais ici hors thread UI)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                val uri = ContentUris.withAppendedId(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, rep.id.toLong())
                val bmp = reactApplicationContext.contentResolver
                    .loadThumbnail(uri, Size(512, 512), null)
                if (writeJpeg(bmp, dest)) { bmp.recycle(); return true }
            } catch (_: Exception) {}
        }
        return false
    }

    private fun writeJpeg(bmp: Bitmap, dest: File): Boolean = try {
        FileOutputStream(dest).use { bmp.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        dest.length() > 0
    } catch (_: Exception) {
        dest.delete(); false
    }

    // Décode des octets JPEG/PNG en limitant la taille (inSampleSize) pour ne pas
    // saturer le tas avec des pochettes haute résolution.
    private fun decodeSampled(bytes: ByteArray, target: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val maxDim = maxOf(bounds.outWidth, bounds.outHeight)
        var sample = 1
        while (maxDim / sample > target * 2) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
    }

    private fun mimeToFormat(mime: String) = when {
        mime.contains("flac")              -> "FLAC"
        mime.contains("mp4") ||
        mime.contains("aac")  ||
        mime.contains("m4a")               -> "AAC"
        mime.contains("mpeg") ||
        mime.contains("mp3")               -> "MP3"
        mime.contains("ogg")               -> "OGG"
        mime.contains("wav")               -> "WAV"
        mime.contains("opus")              -> "OPUS"
        mime.contains("alac")              -> "ALAC"
        else -> mime.substringAfterLast("/").uppercase().take(5)
    }

    private fun sanitizeUnknown(s: String?): String {
        if (s.isNullOrBlank()) return "Inconnu"
        // Certains tags MediaStore renvoient "<unknown>" ou "<inconnu>"
        if (s.startsWith("<") && s.endsWith(">")) return "Inconnu"
        return s.trim()
    }
}
