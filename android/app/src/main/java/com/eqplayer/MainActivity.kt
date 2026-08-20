package com.eqplayer

import android.os.Bundle
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

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
