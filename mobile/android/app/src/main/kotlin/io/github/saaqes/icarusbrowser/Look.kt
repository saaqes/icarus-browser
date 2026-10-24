package io.github.saaqes.icarusbrowser

import android.app.Activity
import android.app.UiModeManager
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.util.TypedValue
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.ImageView
import android.widget.TextView
import io.github.saaqes.icarusbrowser.core.ColorMode
import io.github.saaqes.icarusbrowser.core.Palette
import io.github.saaqes.icarusbrowser.core.ThemeId
import io.github.saaqes.icarusbrowser.core.Themes

/** Estilo resuelto: qué distribución usar y con qué colores. */
data class Look(val theme: ThemeId, val dark: Boolean, val palette: Palette) {
    val accent get() = palette.accent
    val onAccent get() = Themes.contrastOn(palette.accent)
    /** Color de pulsación: el acento con poca opacidad. */
    val ripple get() = withAlpha(palette.accent, if (dark) 0x40 else 0x2A)
    val accentSoft get() = withAlpha(palette.accent, if (dark) 0x33 else 0x1F)

    /** Cada estilo coloca la barra de direcciones en un sitio distinto (como en escritorio, la distribución cambia). */
    val omniboxAtBottom get() = theme == ThemeId.ICARUS
    val hasNavigationBar get() = theme == ThemeId.PANORAMA

    companion object {
        fun withAlpha(color: Int, alpha: Int) = (color and 0x00FFFFFF) or (alpha shl 24)
    }
}

fun Context.dp(value: Number): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

fun Context.rounded(color: Int, radiusDp: Number, strokeColor: Int? = null, strokeDp: Number = 1): GradientDrawable =
    GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radiusDp).toFloat()
        if (strokeColor != null) setStroke(maxOf(1, dp(strokeDp)), strokeColor)
    }

/** Fondo con efecto de pulsación; `content` puede ser null (solo se ve al pulsar). */
fun Context.pressable(look: Look, content: Drawable?, radiusDp: Number = 12): Drawable {
    val mask = rounded(Color.WHITE, radiusDp)
    return RippleDrawable(ColorStateList.valueOf(look.ripple), content, mask)
}

fun Context.icon(resId: Int, color: Int): Drawable = getDrawable(resId)!!.mutate().apply { setTint(color) }

fun ImageView.setIcon(resId: Int, color: Int) {
    setImageDrawable(context.icon(resId, color))
}

fun TextView.textStyle(sizeSp: Float, color: Int, bold: Boolean = false) {
    setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
    setTextColor(color)
    typeface = if (bold) Typeface.create(Typeface.DEFAULT, Typeface.BOLD) else Typeface.DEFAULT
}

/** Insets de barras del sistema, recorte de pantalla y teclado (Android 15 dibuja de borde a borde). */
data class Insets(val left: Int, val top: Int, val right: Int, val bottom: Int)

@Suppress("DEPRECATION")
fun WindowInsets.safeArea(): Insets {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val bars = getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
        val ime = getInsets(WindowInsets.Type.ime())
        return Insets(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
    }
    return Insets(systemWindowInsetLeft, systemWindowInsetTop, systemWindowInsetRight, systemWindowInsetBottom)
}

/** Dibuja la ventana de borde a borde y ajusta el color de los iconos de las barras del sistema. */
@Suppress("DEPRECATION")
fun Activity.applySystemBars(look: Look) {
    // Crea la DecorView si aún no existe (antes de setContentView): sin ella,
    // window.insetsController lanza NullPointerException.
    val decor = window.decorView
    window.setDecorFitsSystemWindowsCompat()
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        window.isNavigationBarContrastEnforced = false
        window.isStatusBarContrastEnforced = false
    }
    window.setBackgroundDrawable(ColorDrawable(look.palette.appBg))
    val lightBars = !look.dark
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        window.insetsController?.setSystemBarsAppearance(if (lightBars) mask else 0, mask)
    } else {
        var flags = decor.systemUiVisibility or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        val lightFlags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        flags = if (lightBars) flags or lightFlags else flags and lightFlags.inv()
        decor.systemUiVisibility = flags
    }
}

@Suppress("DEPRECATION")
private fun android.view.Window.setDecorFitsSystemWindowsCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) setDecorFitsSystemWindows(false)
    else decorView.systemUiVisibility = decorView.systemUiVisibility or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
}

/**
 * Las páginas web usan prefers-color-scheme según el modo de la app. En Android 12+
 * se puede fijar por app; en Android 10 y 11 las páginas siguen el modo del sistema.
 */
fun Context.applyNightMode(mode: ColorMode) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    val manager = getSystemService(UiModeManager::class.java) ?: return
    manager.setApplicationNightMode(
        when (mode) {
            ColorMode.LIGHT -> UiModeManager.MODE_NIGHT_NO
            ColorMode.DARK -> UiModeManager.MODE_NIGHT_YES
            ColorMode.SYSTEM -> UiModeManager.MODE_NIGHT_AUTO
        },
    )
}
