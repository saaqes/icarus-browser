package io.github.saaqes.icarusbrowser.core

import io.github.saaqes.icarusbrowser.core.shield.ResourceType
import io.github.saaqes.icarusbrowser.core.shield.ResourceTypes
import kotlin.test.Test
import kotlin.test.assertEquals

class ResourceTypesTest {
    private fun infer(url: String, headers: Map<String, String> = emptyMap(), mainFrame: Boolean = false) =
        ResourceTypes.infer(url, mainFrame, headers)

    @Test
    fun `la página principal siempre es document`() {
        assertEquals(ResourceType.DOCUMENT, infer("https://ejemplo.com/app.js", mainFrame = true))
    }

    @Test
    fun `Sec-Fetch-Dest tiene prioridad`() {
        assertEquals(ResourceType.IMAGE, infer("https://cdn.com/x.js", mapOf("sec-fetch-dest" to "image")))
        assertEquals(ResourceType.SUBDOCUMENT, infer("https://anuncios.com/marco", mapOf("Sec-Fetch-Dest" to "iframe")))
        assertEquals(ResourceType.XMLHTTPREQUEST, infer("https://api.com/v1", mapOf("Sec-Fetch-Dest" to "empty")))
        assertEquals(ResourceType.MEDIA, infer("https://cdn.com/clip", mapOf("Sec-Fetch-Dest" to "video")))
    }

    @Test
    fun `sin Sec-Fetch-Dest se usan Accept y la extensión`() {
        assertEquals(ResourceType.STYLESHEET, infer("https://cdn.com/estilos", mapOf("Accept" to "text/css,*/*;q=0.1")))
        assertEquals(ResourceType.IMAGE, infer("https://cdn.com/p", mapOf("Accept" to "image/avif,image/webp,*/*")))
        assertEquals(ResourceType.XMLHTTPREQUEST, infer("https://api.com/datos", mapOf("X-Requested-With" to "XMLHttpRequest")))
        assertEquals(ResourceType.SCRIPT, infer("https://cdn.com/lib.min.js?v=3#x"))
        assertEquals(ResourceType.FONT, infer("https://fonts.com/a.woff2"))
        assertEquals(ResourceType.IMAGE, infer("https://px.com/pixel.GIF"))
        assertEquals(ResourceType.OTHER, infer("https://px.com/collect"))
        assertEquals(ResourceType.WEBSOCKET, infer("wss://chat.com/socket"))
    }
}
