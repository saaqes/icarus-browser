package io.github.saaqes.icarusbrowser

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import io.github.saaqes.icarusbrowser.core.ThemeId

/**
 * Icono y nombre del lanzador según el estilo: cada estilo tiene un alias de MainActivity
 * en AndroidManifest.xml (ICARUS, ICARUS Esencial e ICARUS Panorama, con su icono) y solo
 * uno está activo. Son diseños propios de ICARUS, no logotipos de otros navegadores.
 *
 * Android no permite cambiar el icono de otra forma. Algunos lanzadores tardan unos
 * segundos en mostrar el nuevo o quitan el acceso de la pantalla de inicio del anterior
 * (queda en el cajón de aplicaciones).
 */
object LauncherIcons {
    private val ALIASES = mapOf(ThemeId.ICARUS to "LauncherIcarus", ThemeId.ESSENTIAL to "LauncherEsencial", ThemeId.PANORAMA to "LauncherPanorama")

    /** Los alias están en el paquete de las clases (namespace), no en el applicationId. */
    private fun component(context: Context, theme: ThemeId) =
        ComponentName(context.packageName, "${MainActivity::class.java.name.substringBeforeLast('.')}.${ALIASES.getValue(theme)}")

    /** Activo según el sistema o, si nunca se cambió, según el manifiesto (solo ICARUS). */
    private fun isEnabled(manager: PackageManager, component: ComponentName, theme: ThemeId) = when (manager.getComponentEnabledSetting(component)) {
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
        PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> theme == ThemeId.ICARUS
        else -> false
    }

    /** Primero activa el del estilo y después desactiva los demás: nunca se queda sin icono. */
    fun apply(context: Context, theme: ThemeId) {
        val manager = context.packageManager
        val wanted = component(context, theme)
        if (!isEnabled(manager, wanted, theme)) {
            manager.setComponentEnabledSetting(wanted, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
        }
        for (other in ThemeId.entries) {
            if (other == theme) continue
            val alias = component(context, other)
            if (isEnabled(manager, alias, other)) {
                manager.setComponentEnabledSetting(alias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
            }
        }
    }
}
