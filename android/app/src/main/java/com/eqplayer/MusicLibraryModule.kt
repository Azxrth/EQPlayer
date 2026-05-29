package com.eqplayer

import android.content.ContentUris
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.facebook.react.bridge.*

class MusicLibraryModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "MusicLibrary"

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

                        val mime   = it.getString(mimeCol) ?: ""
                        val format = mimeToFormat(mime)

                        val genre = when {
                            genreColIdx >= 0 -> it.getString(genreColIdx) ?: ""
                            else -> genreMap[id] ?: ""
                        }

                        val year = it.getInt(yearCol).let { y -> if (y > 0) y.toString() else "" }

                        val track = WritableNativeMap().apply {
                            putString("id",       id.toString())
                            putString("title",    it.getString(titleCol)?.trim() ?: "Titre inconnu")
                            putString("artist",   sanitizeUnknown(it.getString(artistCol)))
                            putString("album",    sanitizeUnknown(it.getString(albumCol)))
                            putString("albumId",  albumId.toString())
                            putString("artUri",   artUri)
                            putDouble("duration", it.getLong(durationCol).toDouble())
                            putString("filePath", it.getString(dataCol) ?: "")
                            putString("year",     year)
                            putString("format",   format)
                            putString("genre",    genre)
                            putString("mime",     mime)
                        }
                        tracks.pushMap(track)
                    }
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
