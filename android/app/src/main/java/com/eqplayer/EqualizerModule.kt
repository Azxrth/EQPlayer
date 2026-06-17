package com.eqplayer

import android.media.audiofx.Equalizer
import com.facebook.react.bridge.*

/**
 * Égaliseur audio réel basé sur android.media.audiofx.Equalizer.
 * Attaché à la session audio globale (0) = mixage de sortie : agit sur
 * toute la lecture de l'app. Nécessite la permission MODIFY_AUDIO_SETTINGS.
 */
class EqualizerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var equalizer: Equalizer? = null

    override fun getName() = "EqualizerModule"

    private fun ensure(): Equalizer {
        var eq = equalizer
        if (eq == null) {
            // priorité 0, session 0 = sortie audio globale
            eq = Equalizer(0, 0)
            equalizer = eq
        }
        return eq
    }

    @ReactMethod
    fun getInfo(promise: Promise) {
        try {
            val eq = ensure()
            val numBands = eq.numberOfBands.toInt()
            val range = eq.bandLevelRange // millibels : [min, max]
            val bands = WritableNativeArray()
            for (i in 0 until numBands) {
                val band = WritableNativeMap().apply {
                    putInt("index", i)
                    putInt("centerFreq", eq.getCenterFreq(i.toShort())) // milliHz
                    putInt("level", eq.getBandLevel(i.toShort()).toInt())
                }
                bands.pushMap(band)
            }
            val presets = WritableNativeArray()
            for (i in 0 until eq.numberOfPresets.toInt()) {
                presets.pushString(eq.getPresetName(i.toShort()))
            }
            val result = WritableNativeMap().apply {
                putInt("numberOfBands", numBands)
                putInt("minLevel", range[0].toInt())
                putInt("maxLevel", range[1].toInt())
                putArray("bands", bands)
                putArray("presets", presets)
                putBoolean("enabled", eq.enabled)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("EQ_UNAVAILABLE", e.message ?: "Égaliseur indisponible", e)
        }
    }

    @ReactMethod
    fun setEnabled(enabled: Boolean, promise: Promise) {
        try {
            ensure().enabled = enabled
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("EQ_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setBandLevel(band: Int, millibels: Int, promise: Promise) {
        try {
            ensure().setBandLevel(band.toShort(), millibels.toShort())
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("EQ_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun usePreset(preset: Int, promise: Promise) {
        try {
            ensure().usePreset(preset.toShort())
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("EQ_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun release(promise: Promise) {
        try {
            equalizer?.release()
            equalizer = null
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("EQ_ERROR", e.message, e)
        }
    }

    override fun invalidate() {
        super.invalidate()
        equalizer?.release()
        equalizer = null
    }
}
