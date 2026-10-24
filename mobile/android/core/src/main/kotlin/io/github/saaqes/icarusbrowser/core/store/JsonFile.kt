package io.github.saaqes.icarusbrowser.core.store

import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Valor guardado en un archivo de texto (normalmente JSON), igual que
 * electron/main/jsonFile.ts:
 * - Se lee una vez al crearlo; si el archivo falta o está dañado, se usa `defaults`.
 * - Los cambios se escriben con retardo (`delayMs`) para agrupar ráfagas.
 * - La escritura es atómica: archivo temporal + renombrado, así que un corte
 *   nunca deja un archivo a medias.
 *
 * Es seguro usarlo desde varios hilos.
 */
class JsonFile<T>(
    private val file: File,
    private val encode: (T) -> String,
    decode: (String) -> T?,
    defaults: () -> T,
    private val delayMs: Long = 1000,
) {
    private val lock = Any()
    private var value: T
    private var pending: ScheduledFuture<*>? = null

    init {
        value = runCatching { if (file.isFile) decode(file.readText()) else null }.getOrNull() ?: defaults()
    }

    fun get(): T = synchronized(lock) { value }

    fun set(next: T) = synchronized(lock) {
        value = next
        schedule()
    }

    fun update(transform: (T) -> T): T = synchronized(lock) {
        value = transform(value)
        schedule()
        value
    }

    /** Escribe ya los cambios pendientes (al pasar la app a segundo plano). */
    fun flush() {
        val snapshot = synchronized(lock) {
            val task = pending ?: return
            task.cancel(false)
            pending = null
            value
        }
        write(snapshot)
    }

    private fun schedule() {
        if (pending != null) return
        pending = SCHEDULER.schedule({
            val snapshot = synchronized(lock) {
                pending = null
                value
            }
            write(snapshot)
        }, delayMs, TimeUnit.MILLISECONDS)
    }

    private fun write(snapshot: T) {
        synchronized(file) {
            file.parentFile?.mkdirs()
            val temp = File(file.parentFile, "${file.name}.tmp")
            temp.writeText(encode(snapshot))
            if (!temp.renameTo(file)) {
                file.delete()
                temp.renameTo(file)
            }
        }
    }

    companion object {
        private val SCHEDULER = Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "icarus-store").apply { isDaemon = true }
        }

        /** Escribe un archivo de forma atómica (para datos que no usan JsonFile, como las listas). */
        fun writeAtomically(file: File, text: String) {
            file.parentFile?.mkdirs()
            val temp = File(file.parentFile, "${file.name}.tmp")
            temp.writeText(text)
            if (!temp.renameTo(file)) {
                file.delete()
                temp.renameTo(file)
            }
        }
    }
}
