package com.eqplayer

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.modules.core.DeviceEventManagerModule

class MainActivity : ReactActivity() {

  // ─── Boutons physiques prev/suivant : appui court = piste, appui long = seek ──
  // Sur le JM21 (comme FiiO Music), maintenir « suivant »/« précédent » doit faire
  // avancer/reculer dans le morceau au lieu de changer de piste. Quand l'app est au
  // premier plan, la ROM délivre ces touches à l'activité : on intercepte pour
  // distinguer un tap (→ on émet un événement « piste ») d'un maintien (→ on émet
  // des « ticks » de seek répétés). Le JS (setupMediaKeys) fait l'action réelle en
  // réutilisant les contrôles existants. Si la ROM ne route PAS les touches ici,
  // rien n'est intercepté et le comportement d'origine (skip via MediaSession)
  // reste inchangé — pas de régression.
  private val keyHandler = Handler(Looper.getMainLooper())
  private var seeking = false            // un maintien de seek est en cours
  private var seekForward = true         // direction du maintien courant
  private var pendingKey = 0             // touche dont on attend tap-vs-maintien

  private val startSeekRunnable = Runnable {
    seeking = true
    keyHandler.post(seekTickRunnable)
  }
  private val seekTickRunnable = object : Runnable {
    override fun run() {
      emitSeekTick(if (seekForward) SEEK_STEP_SEC else -SEEK_STEP_SEC)
      keyHandler.postDelayed(this, SEEK_INTERVAL_MS)
    }
  }

  private fun isForwardKey(code: Int) =
    code == KeyEvent.KEYCODE_MEDIA_NEXT || code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD
  private fun isBackwardKey(code: Int) =
    code == KeyEvent.KEYCODE_MEDIA_PREVIOUS || code == KeyEvent.KEYCODE_MEDIA_REWIND
  private fun isSeekKey(code: Int) = isForwardKey(code) || isBackwardKey(code)

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if (isSeekKey(keyCode)) {
      // repeatCount == 0 → première pression ; on ignore les auto-répétitions.
      if (event.repeatCount == 0) {
        // Signale au JS que le bouton physique est actif pour qu'il bloque
        // le RemotePrevious/RemoteNext de la MediaSession (qui reçoit aussi
        // l'événement sur certaines ROMs comme le JM21).
        emitJs("EqKeyDown", Arguments.createMap())
        pendingKey = keyCode
        seekForward = isForwardKey(keyCode)
        seeking = false
        keyHandler.removeCallbacks(startSeekRunnable)
        keyHandler.postDelayed(startSeekRunnable, LONG_PRESS_MS)
      }
      return true // on consomme → pas de double action via la MediaSession
    }
    return super.onKeyDown(keyCode, event)
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
    if (isSeekKey(keyCode)) {
      keyHandler.removeCallbacks(startSeekRunnable)
      if (seeking) {
        stopSeek() // c'était un maintien → on arrête simplement (pas de skip)
      } else {
        emitKeyTap(isForwardKey(keyCode)) // c'était un tap → piste suiv./préc.
      }
      pendingKey = 0
      return true
    }
    return super.onKeyUp(keyCode, event)
  }

  private fun stopSeek() {
    seeking = false
    keyHandler.removeCallbacks(seekTickRunnable)
  }

  override fun onPause() {
    super.onPause()
    keyHandler.removeCallbacks(startSeekRunnable)
    stopSeek() // ne pas laisser un seek tourner si on quitte l'app touche enfoncée
  }

  private fun emitJs(name: String, params: com.facebook.react.bridge.WritableMap?) {
    val ctx = (application as? ReactApplication)?.reactHost?.currentReactContext ?: return
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(name, params)
  }

  private fun emitKeyTap(forward: Boolean) {
    val p = Arguments.createMap().apply { putString("dir", if (forward) "next" else "prev") }
    emitJs("EqMediaKeyTap", p)
  }

  private fun emitSeekTick(deltaSec: Int) {
    val p = Arguments.createMap().apply { putInt("delta", deltaSec) }
    emitJs("EqMediaKeySeek", p)
  }

  companion object {
    private const val LONG_PRESS_MS = 400L   // au-delà = maintien (seek), en-deçà = tap
    private const val SEEK_INTERVAL_MS = 200L // fréquence des ticks de seek
    private const val SEEK_STEP_SEC = 3       // avance/recul par tick (~15 s/s)
  }

  // Plein écran immersif : l'app dessine derrière les barres système (edge-to-edge)
  // ET la barre de navigation est masquée pour occuper tout l'espace (la ROM du JM21
  // la dessine en gris opaque sinon). Elle réapparaît temporairement par un swipe
  // depuis le bord, puis se re-cache. La barre de statut (haut) reste visible.
  override fun onCreate(savedInstanceState: Bundle?) {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    super.onCreate(savedInstanceState)
    hideNavBar()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideNavBar()
  }

  @Suppress("DEPRECATION")
  private fun hideNavBar() {
    // API moderne (AndroidX) …
    WindowInsetsControllerCompat(window, window.decorView).apply {
      hide(WindowInsetsCompat.Type.navigationBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
    // … + flags hérités (immersive sticky) : certaines ROMs custom (JM21/FiiO)
    // n'honorent que ceux-ci pour masquer la barre de navigation par gestes.
    window.decorView.systemUiVisibility = (
      android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        or android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    )
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "EQPlayer"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
