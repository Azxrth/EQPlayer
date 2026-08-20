package com.eqplayer

import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.min

/**
 * Parse l'en-tête d'un AIFF (chunks COMM + SSND) et sait servir son contenu sous
 * forme de flux WAV PCM little-endian (en-tête synthétique + samples byte-swappés).
 *
 * Toutes les lectures se font par POSITION sur un FileChannel (le fichier vit sur
 * une SD amovible → accessible uniquement via le descripteur MediaStore, pas par
 * chemin direct).
 */
class AiffInfo private constructor(
    private val channels: Int,
    private val bits: Int,
    private val sampleRate: Int,
    private val ssndDataStart: Long, // offset fichier du 1er octet PCM
    private val ssndDataLen: Long,   // nb d'octets PCM
) {
    private val bytesPerSample = bits / 8            // par point d'échantillon (par canal)
    private val header: ByteArray = buildWavHeader()
    val wavTotalSize: Long = HEADER_SIZE + ssndDataLen

    // Sert la plage [offset, offset+size) de la vue WAV virtuelle.
    fun readWav(ch: FileChannel, offset: Long, size: Int, out: ByteArray): Int {
        var produced = 0
        var pos = offset

        // 1) en-tête WAV (44 octets)
        if (pos < HEADER_SIZE) {
            val n = min(size, (HEADER_SIZE - pos).toInt())
            System.arraycopy(header, pos.toInt(), out, 0, n)
            produced += n; pos += n
        }
        if (produced >= size) return produced

        // 2) données PCM byte-swappées (big-endian → little-endian)
        val dataOffset = pos - HEADER_SIZE            // offset dans le PCM virtuel
        if (dataOffset >= ssndDataLen) return produced
        val avail = min((size - produced).toLong(), ssndDataLen - dataOffset).toInt()

        // On lit des échantillons entiers couvrant la plage demandée, on les inverse,
        // puis on renvoie la tranche exacte.
        val ss = bytesPerSample
        val startSample = dataOffset / ss
        val endSample = (dataOffset + avail + ss - 1) / ss
        val readStart = startSample * ss
        val readLen = min((endSample * ss) - readStart, ssndDataLen - readStart).toInt()

        val buf = readAt(ch, ssndDataStart + readStart, readLen)

        // inverse chaque groupe de `ss` octets (échantillon big-endian → little-endian)
        var g = 0
        while (g + ss <= buf.size) {
            var i = 0
            while (i < ss / 2) {
                val tmp = buf[g + i]; buf[g + i] = buf[g + ss - 1 - i]; buf[g + ss - 1 - i] = tmp; i++
            }
            g += ss
        }

        val sliceStart = (dataOffset - readStart).toInt()
        val copy = min(avail, buf.size - sliceStart)
        if (copy > 0) { System.arraycopy(buf, sliceStart, out, produced, copy); produced += copy }
        return produced
    }

    private fun buildWavHeader(): ByteArray {
        val h = ByteArray(HEADER_SIZE.toInt())
        val byteRate = sampleRate * channels * bytesPerSample
        val blockAlign = channels * bytesPerSample
        val dataLen = ssndDataLen.toInt()
        putAscii(h, 0, "RIFF")
        putLe32(h, 4, 36 + dataLen)
        putAscii(h, 8, "WAVE")
        putAscii(h, 12, "fmt ")
        putLe32(h, 16, 16)                // taille du sous-chunk fmt
        putLe16(h, 20, 1)                 // PCM
        putLe16(h, 22, channels)
        putLe32(h, 24, sampleRate)
        putLe32(h, 28, byteRate)
        putLe16(h, 32, blockAlign)
        putLe16(h, 34, bits)
        putAscii(h, 36, "data")
        putLe32(h, 40, dataLen)
        return h
    }

    companion object {
        private const val HEADER_SIZE = 44L

        // Lit exactement (au mieux) `len` octets à la position `pos` du channel.
        private fun readAt(ch: FileChannel, pos: Long, len: Int): ByteArray {
            val bb = ByteBuffer.allocate(len)
            var p = pos
            while (bb.hasRemaining()) {
                val n = ch.read(bb, p)
                if (n < 0) break
                p += n
            }
            return if (bb.position() == len) bb.array() else bb.array().copyOf(bb.position())
        }

        private fun u16(b: ByteArray, o: Int) = ((b[o].toInt() and 0xff) shl 8) or (b[o + 1].toInt() and 0xff)
        private fun u32(b: ByteArray, o: Int): Long {
            var v = 0L; for (i in 0..3) v = (v shl 8) or (b[o + i].toLong() and 0xff); return v
        }

        fun parse(ch: FileChannel): AiffInfo? {
            val head = readAt(ch, 0, 12)
            if (head.size < 12) return null
            if (String(head, 0, 4, Charsets.US_ASCII) != "FORM") return null
            val form = String(head, 8, 4, Charsets.US_ASCII)
            if (form != "AIFF" && form != "AIFC") return null

            var channels = 0; var bits = 0; var rate = 0
            var ssndStart = -1L; var ssndLen = 0L
            var pos = 12L
            val fileLen = ch.size()

            while (pos + 8 <= fileLen) {
                val hdr = readAt(ch, pos, 8)
                if (hdr.size < 8) break
                val ckId = String(hdr, 0, 4, Charsets.US_ASCII)
                val ckSize = u32(hdr, 4)
                val chunkStart = pos + 8
                when (ckId) {
                    "COMM" -> {
                        val c = readAt(ch, chunkStart, 18)
                        if (c.size >= 18) {
                            channels = u16(c, 0)
                            bits = u16(c, 6)
                            rate = extended80ToInt(c, 8)
                        }
                    }
                    "SSND" -> {
                        val s = readAt(ch, chunkStart, 8)
                        if (s.size >= 8) {
                            val dataOffset = u32(s, 0)
                            ssndStart = chunkStart + 8 + dataOffset
                            ssndLen = ckSize - 8 - dataOffset
                        }
                    }
                }
                var next = chunkStart + ckSize
                if (ckSize % 2 == 1L) next += 1
                if (next <= pos) break
                pos = next
                if (channels > 0 && bits > 0 && ssndStart >= 0) break
            }

            if (channels <= 0 || bits <= 0 || rate <= 0 || ssndStart < 0 || ssndLen <= 0) return null
            if (bits != 8 && bits != 16 && bits != 24 && bits != 32) return null
            ssndLen = min(ssndLen, fileLen - ssndStart)
            if (ssndLen <= 0) return null
            return AiffInfo(channels, bits, rate, ssndStart, ssndLen)
        }

        // 80-bit IEEE 754 étendu (SANE) → entier (fréquence d'échantillonnage).
        private fun extended80ToInt(b: ByteArray, off: Int): Int {
            val exponent = ((b[off].toInt() and 0x7f) shl 8) or (b[off + 1].toInt() and 0xff)
            var mantissa = 0L
            for (i in 2..9) mantissa = (mantissa shl 8) or (b[off + i].toLong() and 0xff)
            if (exponent == 0 && mantissa == 0L) return 0
            // mantisse = 64 bits NON signés (le bit de poids fort = bit entier explicite)
            val m = if (mantissa >= 0) mantissa.toDouble() else mantissa.toDouble() + 18446744073709551616.0
            val value = m * Math.pow(2.0, (exponent - 16383 - 63).toDouble())
            return Math.round(value).toInt()
        }

        private fun putAscii(a: ByteArray, off: Int, s: String) { for (i in s.indices) a[off + i] = s[i].code.toByte() }
        private fun putLe16(a: ByteArray, off: Int, v: Int) {
            a[off] = (v and 0xff).toByte(); a[off + 1] = ((v shr 8) and 0xff).toByte()
        }
        private fun putLe32(a: ByteArray, off: Int, v: Int) {
            a[off] = (v and 0xff).toByte(); a[off + 1] = ((v shr 8) and 0xff).toByte()
            a[off + 2] = ((v shr 16) and 0xff).toByte(); a[off + 3] = ((v shr 24) and 0xff).toByte()
        }
    }
}
