package io.github.saaqes.icarusbrowser

import android.app.Dialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.text.InputType
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView

/** Fábrica de vistas con los colores del estilo activo (la interfaz se construye en código). */
class Widgets(val context: Context, val look: Look) {
    private val p get() = look.palette

    fun dp(value: Number) = context.dp(value)

    fun vertical(paddingDp: Int = 0, spacingDp: Int = 0, block: LinearLayout.() -> Unit = {}) = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(paddingDp), dp(paddingDp), dp(paddingDp), dp(paddingDp))
        if (spacingDp > 0) {
            showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
            dividerDrawable = spacer(spacingDp)
        }
        block()
    }

    fun horizontal(spacingDp: Int = 0, block: LinearLayout.() -> Unit = {}) = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        if (spacingDp > 0) {
            showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
            dividerDrawable = spacer(spacingDp)
        }
        block()
    }

    private fun spacer(sizeDp: Int) = object : ColorDrawable(Color.TRANSPARENT) {
        override fun getIntrinsicWidth() = dp(sizeDp)
        override fun getIntrinsicHeight() = dp(sizeDp)
    }

    fun text(value: CharSequence, sizeSp: Float = 15f, color: Int = p.fg1, bold: Boolean = false, maxLines: Int = Int.MAX_VALUE) =
        TextView(context).apply {
            text = value
            textStyle(sizeSp, color, bold)
            if (maxLines != Int.MAX_VALUE) {
                this.maxLines = maxLines
                ellipsize = TextUtils.TruncateAt.END
            }
            setLineSpacing(0f, 1.15f)
        }

    fun title(value: CharSequence) = text(value, 22f, p.fg1, bold = true)

    fun sectionLabel(value: CharSequence) = text(value.toString().uppercase(), 12f, p.fg3, bold = true).apply {
        letterSpacing = 0.06f
        setPadding(dp(4), dp(18), dp(4), dp(6))
    }

    fun hint(value: CharSequence) = text(value, 13f, p.fg3)

    /** Botón de icono con área táctil de 48 dp y descripción para lectores de pantalla. */
    fun iconButton(iconRes: Int, description: String, color: Int = p.fg2, onClick: (View) -> Unit) = ImageButton(context).apply {
        setIcon(iconRes, color)
        contentDescription = description
        scaleType = ImageView.ScaleType.CENTER
        background = context.pressable(look, null, 24)
        layoutParams = LinearLayout.LayoutParams(dp(44), dp(44))
        minimumWidth = dp(44)
        minimumHeight = dp(44)
        setOnClickListener(onClick)
    }

    fun button(label: String, primary: Boolean = false, danger: Boolean = false, onClick: (View) -> Unit) = Button(context).apply {
        text = label
        isAllCaps = false
        stateListAnimator = null
        minHeight = dp(44)
        minimumHeight = dp(44)
        setPadding(dp(18), 0, dp(18), 0)
        val fill = when {
            primary -> look.accent
            else -> p.surface2
        }
        textStyle(15f, if (primary) look.onAccent else if (danger) p.danger else p.fg1, bold = true)
        background = context.pressable(look, context.rounded(fill, 22), 22)
        setOnClickListener(onClick)
    }

    fun field(label: String, value: String = "", hintText: String = "", multiline: Boolean = false, inputType: Int? = null): Field {
        val edit = EditText(context).apply {
            setText(value)
            hint = hintText
            textStyle(16f, p.fg1)
            setHintTextColor(p.fg3)
            background = context.rounded(p.surface2, 12, p.border1)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            this.inputType = inputType ?: if (multiline) {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            } else {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            }
            if (multiline) {
                minLines = 5
                gravity = Gravity.TOP or Gravity.START
                setHorizontallyScrolling(false)
            } else {
                isSingleLine = true
            }
        }
        val error = text("", 13f, p.danger).apply { visibility = View.GONE }
        val labelView = text(label, 14f, p.fg2, bold = true)
        val container = vertical(spacingDp = 6) {
            addView(labelView)
            addView(edit, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(error)
        }
        return Field(container, edit, error)
    }

    class Field(val view: LinearLayout, val edit: EditText, private val errorView: TextView) {
        val value: String get() = edit.text.toString()
        fun setError(message: String?) {
            errorView.text = message.orEmpty()
            errorView.visibility = if (message.isNullOrEmpty()) View.GONE else View.VISIBLE
        }
    }

    fun switchRow(title: String, subtitle: String? = null, checked: Boolean, onChange: (Boolean) -> Unit): LinearLayout {
        val toggle = Switch(context).apply {
            isChecked = checked
            thumbTintList = ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
                intArrayOf(look.accent, if (look.dark) p.fg2 else Color.WHITE),
            )
            trackTintList = ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
                intArrayOf(Look.withAlpha(look.accent, 0x80), p.border1 or 0x40000000),
            )
            contentDescription = title
            setOnCheckedChangeListener { _, value -> onChange(value) }
        }
        return horizontal(spacingDp = 12) {
            minimumHeight = dp(56)
            setPadding(dp(16), dp(10), dp(12), dp(10))
            val texts = vertical(spacingDp = 2) {
                addView(text(title, 16f, p.fg1))
                if (subtitle != null) addView(hint(subtitle))
            }
            addView(texts, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            addView(toggle)
            background = context.pressable(look, null, 16)
            setOnClickListener { toggle.toggle() }
        }
    }

    /** Fila pulsable con icono, título y subtítulo opcional. */
    fun row(iconRes: Int?, title: String, subtitle: String? = null, trailing: View? = null, onClick: ((View) -> Unit)?): LinearLayout =
        horizontal(spacingDp = 14) {
            minimumHeight = dp(52)
            setPadding(dp(16), dp(10), dp(12), dp(10))
            if (iconRes != null) {
                addView(ImageView(context).apply { setIcon(iconRes, p.fg2) }, LinearLayout.LayoutParams(dp(22), dp(22)))
            }
            val texts = vertical(spacingDp = 2) {
                addView(text(title, 16f, p.fg1, maxLines = 2))
                if (subtitle != null) addView(text(subtitle, 13f, p.fg3, maxLines = 3))
            }
            addView(texts, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            if (trailing != null) addView(trailing)
            if (onClick != null) {
                background = context.pressable(look, null, 16)
                setOnClickListener(onClick)
            }
        }

    /** Tarjeta de sección con las filas separadas por líneas finas. */
    fun card(block: LinearLayout.() -> Unit) = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        background = context.rounded(p.surface1, 18, p.border1)
        showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
        dividerDrawable = object : ColorDrawable(p.border1) {
            override fun getIntrinsicHeight() = maxOf(1, dp(0.5f))
        }
        clipToOutline = true
        block()
    }

    fun scroll(content: View) = ScrollView(context).apply {
        isFillViewport = true
        addView(content, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    }

    /** Diálogo con el estilo de ICARUS (los diálogos del sistema no siguen la paleta). */
    fun dialog(
        title: String,
        message: CharSequence? = null,
        content: View? = null,
        positive: String? = null,
        negative: String? = "Cancelar",
        destructive: Boolean = false,
        onNegative: () -> Unit = {},
        /** Al cerrar sin elegir (tocar fuera o «Atrás»). Por defecto equivale a `negative`. */
        onCancel: () -> Unit = onNegative,
        onPositive: (Dialog) -> Boolean = { true },
    ): Dialog {
        val dialog = Dialog(context)
        val body = vertical(paddingDp = 22, spacingDp = 14) {
            background = context.rounded(p.surface1, 26)
            addView(text(title, 19f, p.fg1, bold = true))
            if (message != null) addView(text(message, 15f, p.fg2))
            if (content != null) addView(content, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            val actions = horizontal(spacingDp = 8) {
                gravity = Gravity.END or Gravity.CENTER_VERTICAL
                if (negative != null) addView(button(negative) { onNegative(); dialog.dismiss() })
                if (positive != null) {
                    addView(button(positive, primary = !destructive, danger = destructive) { if (onPositive(dialog)) dialog.dismiss() })
                }
            }
            addView(actions, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        }
        dialog.setContentView(scroll(body).apply { isFillViewport = false })
        dialog.setOnCancelListener { onCancel() }
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setLayout(minOf(context.resources.displayMetrics.widthPixels - dp(32), dp(520)), WRAP_CONTENT)
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
        return dialog
    }

    /** Hoja inferior (menú principal, Shield, pestañas): un diálogo anclado abajo. */
    fun sheet(content: View): Dialog {
        val dialog = Dialog(context)
        val frame = FrameLayout(context).apply {
            background = context.rounded(p.surface1, 28)
            setPadding(0, dp(8), 0, dp(12))
            addView(content, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        }
        dialog.setContentView(scroll(frame).apply { isFillViewport = false })
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setGravity(Gravity.BOTTOM)
            setLayout(minOf(context.resources.displayMetrics.widthPixels, dp(560)), WRAP_CONTENT)
            attributes = attributes.apply { y = dp(8) }
        }
        return dialog
    }

    companion object {
        fun matchWidth() = ViewGroup.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
    }
}
