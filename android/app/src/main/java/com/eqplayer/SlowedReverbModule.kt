package com.eqplayer

import android.media.audiofx.PresetReverb
import com.facebook.react.bridge.*

/**
 * Réverbération globale via android.media.audiofx.PresetReverb, attachée à la
 * session 0 (mix de sortie global) — comme l'égaliseur. Effet « insert » : il
 * s'applique à tout l'audio de l'app sans router chaque piste. Nécessite
 * MODIFY_AUDIO_SETTINGS (déjà accordée pour l'EQ).
 *
 * Couplé au pitch/vitesse abaissés (réglés côté track-player, voir le patch
 * setRatePitch), ça donne le rendu « slowed + reverb ».
 *
 * `preset` : 0 = désactivée, 1..6 = presets PresetReverb
 * (SMALLROOM, MEDIUMROOM, LARGEROOM, MEDIUMHALL, LARGEHALL, PLATE).
 */
class SlowedReverbModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var reverb: PresetReverb? = null
    private var preset = 0

    override fun getName() = "SlowedReverb"

    private fun build() {
        reverb?.release()
        reverb = null
        if (preset <= 0) return
        // priorité 0, session 0 (mix global). preset déjà borné 1..6.
        val r = PresetReverb(0, 0)
        r.preset = preset.toShort()
        r.enabled = true
        reverb = r
    }

    @ReactMethod
    fun isAvailable(promise: Promise) {
        try {
            // Instanciation test : certaines ROM n'exposent pas la réverbération.
            val r = PresetReverb(0, 0)
            r.release()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun setPreset(level: Int, promise: Promise) {
        try {
            preset = level.coerceIn(0, 6)
            build()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("REVERB_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setEnabled(enabled: Boolean, promise: Promise) {
        try {
            reverb?.enabled = enabled
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("REVERB_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun release(promise: Promise) {
        try {
            reverb?.release(); reverb = null; promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("REVERB_ERROR", e.message, e)
        }
    }

    override fun invalidate() {
        super.invalidate()
        reverb?.release()
        reverb = null
    }
}
