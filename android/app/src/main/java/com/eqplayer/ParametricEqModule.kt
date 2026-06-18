package com.eqplayer

import android.media.audiofx.DynamicsProcessing
import com.facebook.react.bridge.*

/**
 * Égaliseur paramétrique basé sur android.media.audiofx.DynamicsProcessing (API 28+).
 * Contrairement à Equalizer (bandes/fréquences fixes), ici le nombre de bandes ET
 * la fréquence de coupure de chaque bande sont configurables.
 * Attaché à la session 0 (mixage de sortie global) ; nécessite MODIFY_AUDIO_SETTINGS.
 */
class ParametricEqModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var dp: DynamicsProcessing? = null
    // Bandes par défaut (10 bandes octave) — entièrement reconfigurables côté JS.
    private var freqs = floatArrayOf(31f, 62f, 125f, 250f, 500f, 1000f, 2000f, 4000f, 8000f, 16000f)
    private var gains = FloatArray(10)
    private val channels = 2
    private val minDb = -15
    private val maxDb = 15

    override fun getName() = "ParametricEq"

    private fun build() {
        dp?.release()
        dp = null
        val n = freqs.size
        val config = DynamicsProcessing.Config.Builder(
            DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
            channels,
            true, n,   // preEq utilisé, n bandes
            false, 0,  // mbc
            false, 0,  // postEq
            false,     // limiter
        ).build()
        val d = DynamicsProcessing(0, 0, config) // priorité 0, session 0 (global)
        for (ch in 0 until channels) {
            val eq = d.getPreEqByChannelIndex(ch)
            eq.isEnabled = true
            d.setPreEqByChannelIndex(ch, eq)
        }
        for (i in 0 until n) {
            val band = d.getPreEqBandByChannelIndex(0, i)
            band.cutoffFrequency = freqs[i]
            band.gain = gains[i]
            band.isEnabled = true
            d.setPreEqBandAllChannelsTo(i, band)
        }
        d.enabled = true
        dp = d
    }

    private fun ensure(): DynamicsProcessing {
        if (dp == null) build()
        return dp!!
    }

    // Trie les bandes par fréquence croissante (requis par DynamicsProcessing).
    private fun sortBands() {
        val order = freqs.indices.sortedBy { freqs[it] }
        freqs = FloatArray(freqs.size) { freqs[order[it]] }
        gains = FloatArray(gains.size) { gains[order[it]] }
    }

    @ReactMethod
    fun configure(freqList: ReadableArray, gainList: ReadableArray?, promise: Promise) {
        try {
            val n = freqList.size()
            freqs = FloatArray(n) { freqList.getDouble(it).toFloat() }
            gains = FloatArray(n) { if (gainList != null && it < gainList.size()) gainList.getDouble(it).toFloat() else 0f }
            sortBands()
            build()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("PEQ_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getInfo(promise: Promise) {
        try {
            ensure()
            val bands = WritableNativeArray()
            for (i in freqs.indices) {
                bands.pushMap(WritableNativeMap().apply {
                    putInt("index", i)
                    putDouble("freq", freqs[i].toDouble())
                    putDouble("gain", gains[i].toDouble())
                })
            }
            promise.resolve(WritableNativeMap().apply {
                putInt("minDb", minDb)
                putInt("maxDb", maxDb)
                putArray("bands", bands)
                putBoolean("enabled", dp?.enabled ?: false)
            })
        } catch (e: Exception) {
            promise.reject("PEQ_UNAVAILABLE", e.message, e)
        }
    }

    @ReactMethod
    fun setGain(index: Int, db: Double, promise: Promise) {
        try {
            val d = ensure()
            if (index < 0 || index >= gains.size) { promise.resolve(null); return }
            val g = db.toFloat().coerceIn(minDb.toFloat(), maxDb.toFloat())
            gains[index] = g
            val band = d.getPreEqBandByChannelIndex(0, index)
            band.gain = g
            d.setPreEqBandAllChannelsTo(index, band)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("PEQ_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setFreq(index: Int, hz: Double, promise: Promise) {
        try {
            if (index < 0 || index >= freqs.size) { promise.resolve(null); return }
            // Changer une fréquence peut casser l'ordre croissant → on reconfigure.
            freqs[index] = hz.toFloat()
            sortBands()
            build()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("PEQ_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setEnabled(enabled: Boolean, promise: Promise) {
        try {
            ensure().enabled = enabled
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("PEQ_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun release(promise: Promise) {
        try {
            dp?.release(); dp = null; promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("PEQ_ERROR", e.message, e)
        }
    }

    override fun invalidate() {
        super.invalidate()
        dp?.release()
        dp = null
    }
}
