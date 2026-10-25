/**
 * `fetch` para el actualizador sobre `net.request` (la pila de red de Chromium: usa
 * el proxy y los certificados del sistema). A diferencia de `net.fetch`, devuelve
 * las redirecciones sin seguirlas, para que `fetchAllowed` compruebe cada destino
 * antes de conectarse a él.
 */

import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { net } from 'electron';
import type { FetchLike } from '../update/source';

const NULL_BODY = new Set([101, 204, 205, 304]);

export const electronFetch: FetchLike = (url, init = {}) =>
  new Promise<Response>((resolve, reject) => {
    if (init.signal?.aborted) {
      reject(new DOMException('Cancelado', 'AbortError'));
      return;
    }
    const request = net.request({ url, method: 'GET', redirect: init.redirect === 'follow' ? 'follow' : 'manual', useSessionCookies: false });
    for (const [name, value] of Object.entries(init.headers ?? {})) request.setHeader(name, value);
    let settled = false;
    const onAbort = () => {
      request.abort();
      if (!settled) {
        settled = true;
        reject(new DOMException('Cancelado', 'AbortError'));
      }
    };
    init.signal?.addEventListener('abort', onAbort, { once: true });

    request.on('redirect', (statusCode, _method, redirectUrl) => {
      if (settled) return;
      settled = true;
      // Sin llamar a followRedirect, Chromium cancela la petición.
      resolve(new Response(null, { status: statusCode, headers: { location: redirectUrl } }));
    });
    request.on('response', (response) => {
      if (settled) return;
      settled = true;
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      const body = NULL_BODY.has(response.statusCode)
        ? null
        : (Readable.toWeb(response as unknown as Readable) as NodeReadableStream<Uint8Array> as unknown as ReadableStream<Uint8Array>);
      resolve(new Response(body, { status: response.statusCode, headers }));
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    request.end();
  });
