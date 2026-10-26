// @vitest-environment node
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextZoom, sanitizeZoom, zoomSite, ZoomStore } from './zoom';

describe('zoom de las páginas', () => {
  it('sube y baja por los niveles de Chrome y Edge, con límites', () => {
    expect(nextZoom(1, 'in')).toBe(1.1);
    expect(nextZoom(1.1, 'in')).toBe(1.25);
    expect(nextZoom(1, 'out')).toBe(0.9);
    expect(nextZoom(5, 'in')).toBe(5);
    expect(nextZoom(0.25, 'out')).toBe(0.25);
    expect(nextZoom(1.75, 'reset')).toBe(1);
    // Desde un factor intermedio (gesto del panel táctil) va al nivel siguiente.
    expect(nextZoom(1.17, 'in')).toBe(1.25);
    expect(nextZoom(1.17, 'out')).toBe(1.1);
  });

  it('se guarda por sitio (host con puerto) y solo para páginas web', () => {
    expect(zoomSite('https://Ejemplo.com/a#b')).toBe('ejemplo.com');
    expect(zoomSite('http://localhost:3000/')).toBe('localhost:3000');
    expect(zoomSite('icarus://configuracion')).toBeNull();
    expect(zoomSite('no es una url')).toBeNull();
  });

  it('se conserva al reiniciar y descarta valores inválidos', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'icarus-zoom-')), 'zoom.json');
    const store = new ZoomStore(path);
    store.set('https://ejemplo.com/a', 1.25);
    store.set('http://localhost:3000/', 0.9);
    store.set('icarus://historial', 2);
    store.flush();
    const again = new ZoomStore(path);
    expect(again.get('https://ejemplo.com/otra')).toBe(1.25);
    expect(again.get('http://localhost:3000/x')).toBe(0.9);
    expect(again.get('https://otro.com/')).toBe(1);
    again.set('https://ejemplo.com/', 1);
    again.flush();
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')).data)).toEqual(['localhost:3000']);
    expect(sanitizeZoom({ 'a.com': 1.25, 'b.com': 7, 'c.com': 1, 'd.com': 'x' })).toEqual({ 'a.com': 1.25 });
  });
});
