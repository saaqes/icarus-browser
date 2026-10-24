// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonFile } from './jsonFile';
import { isAllowedPageNavigation, isDangerousFile, parseNavigableUrl, protocolOf, sanitizeFileName } from './urlPolicy';
import { assertId, assertRect, IpcValidationError } from './validate';

describe('política de URL', () => {
  it('solo permite navegar a http(s) sin credenciales', () => {
    expect(parseNavigableUrl('https://www.wikipedia.org/')?.href).toBe('https://www.wikipedia.org/');
    expect(parseNavigableUrl('javascript:alert(1)')).toBeNull();
    expect(parseNavigableUrl('file:///C:/Windows')).toBeNull();
    expect(parseNavigableUrl('https://user:pw@example.com/')).toBeNull();
    expect(isAllowedPageNavigation('about:blank')).toBe(true);
    expect(isAllowedPageNavigation('mailto:a@b.c')).toBe(false);
    expect(protocolOf('mailto:a@b.c')).toBe('mailto:');
  });

  it('reconoce archivos peligrosos y sanea nombres', () => {
    expect(isDangerousFile('instalador.EXE')).toBe(true);
    expect(isDangerousFile('script.ps1')).toBe(true);
    expect(isDangerousFile('informe.pdf')).toBe(false);
    expect(sanitizeFileName('a<b>:c?.txt')).toBe('a_b__c_.txt');
    expect(sanitizeFileName('CON')).toBe('descarga-CON');
    expect(sanitizeFileName('...')).toBe('descarga');
  });
});

describe('validación IPC', () => {
  it('rechaza identificadores y rectángulos inválidos', () => {
    expect(assertId('tab-1_A', 'id')).toBe('tab-1_A');
    expect(() => assertId('../x', 'id')).toThrow(IpcValidationError);
    expect(assertRect({ x: 0.4, y: 90, width: 1280.6, height: 700 })).toEqual({ x: 0, y: 90, width: 1281, height: 700 });
    expect(() => assertRect({ x: -1, y: 0, width: 1, height: 1 })).toThrow(IpcValidationError);
    expect(() => assertRect({ x: 0, y: 0, width: Infinity, height: 1 })).toThrow(IpcValidationError);
  });
});

describe('JsonFile', () => {
  it('guarda de forma atómica y recupera archivos dañados', () => {
    const dir = mkdtempSync(join(tmpdir(), 'icarus-'));
    const path = join(dir, 'datos.json');
    const options = { version: 1, defaults: () => ({ n: 0 }), sanitize: (raw: unknown) => ({ n: Number((raw as { n?: number })?.n ?? 0) }) };
    const file = new JsonFile(path, options);
    file.set({ n: 5 });
    file.flush();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ version: 1, data: { n: 5 } });
    expect(new JsonFile(path, options).get()).toEqual({ n: 5 });

    writeFileSync(path, '{roto');
    expect(new JsonFile(path, options).get()).toEqual({ n: 0 });
    expect(readdirSync(dir).some((name) => name.startsWith('datos.json.corrupt-'))).toBe(true);
  });
});
