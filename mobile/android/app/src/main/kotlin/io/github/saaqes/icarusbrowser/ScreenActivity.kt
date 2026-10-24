package io.github.saaqes.icarusbrowser

import android.app.Activity
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.window.OnBackInvokedDispatcher

/**
 * Pantalla secundaria (configuración, historial, descargas) con cabecera y
 * páginas apiladas: «Atrás» vuelve a la página anterior antes de cerrar.
 */
abstract class ScreenActivity : Activity() {
    protected val app get() = IcarusApp.instance
    protected lateinit var look: Look
    protected lateinit var w: Widgets

    private class Page(val title: String, val build: () -> View)

    private val pages = ArrayList<Page>()
    private lateinit var body: FrameLayout
    private lateinit var header: LinearLayout
    private val profileListener: () -> Unit = { if (app.look() != look) rebuild() else onDataChanged() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app.addProfileListener(profileListener)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { back() }
        }
        setup()
        pages.add(Page(rootTitle()) { buildRoot() })
        openInitialPage()
        show()
    }

    override fun onDestroy() {
        app.removeProfileListener(profileListener)
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (app.look(newConfig) != look) rebuild()
    }

    @Deprecated("Android 12 y anteriores")
    override fun onBackPressed() = back()

    protected abstract fun rootTitle(): String
    protected abstract fun buildRoot(): View
    protected open fun openInitialPage() = Unit
    /** Los datos cambiaron desde otra pantalla: vuelve a dibujar la página actual. */
    protected open fun onDataChanged() = show()

    /** Título de la página visible. */
    protected val currentTitle: String get() = pages.last().title

    protected fun push(title: String, build: () -> View) {
        pages.add(Page(title, build))
        show()
    }

    protected fun refresh() = show()

    protected fun back() {
        if (pages.size > 1) {
            pages.removeAt(pages.lastIndex)
            show()
        } else {
            finish()
        }
    }

    private fun setup() {
        look = app.look()
        w = Widgets(this, look)
        applySystemBars(look)
        val p = look.palette
        header = w.horizontal(spacingDp = 4) { setPadding(dp(4), dp(4), dp(16), dp(4)) }
        body = FrameLayout(this)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(p.pageBg)
            addView(header, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(body, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        }
        val root = FrameLayout(this).apply {
            setBackgroundColor(p.pageBg)
            addView(column, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            setOnApplyWindowInsetsListener { _, insets ->
                val safe = insets.safeArea()
                column.setPadding(safe.left, safe.top, safe.right, safe.bottom)
                insets
            }
        }
        setContentView(root)
    }

    private fun rebuild() {
        setup()
        show()
    }

    private fun show() {
        val page = pages.last()
        header.removeAllViews()
        header.addView(w.iconButton(R.drawable.icarus_back, "Atrás") { back() })
        header.addView(w.text(page.title, 20f, look.palette.fg1, bold = true, maxLines = 1), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        body.removeAllViews()
        body.addView(page.build(), FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
    }

    /** Columna desplazable con márgenes de página. */
    protected fun pageColumn(block: LinearLayout.() -> Unit): View = w.scroll(w.vertical(spacingDp = 6) {
        setPadding(dp(16), dp(4), dp(16), dp(32))
        block()
    })
}
