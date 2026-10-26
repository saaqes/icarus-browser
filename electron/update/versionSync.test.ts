/**
 * Versión única: package.json manda; Android la lee en Gradle e iPhone la recibe
 * en project.yml (node scripts/release/version.mjs sync). Si alguien cambia una sin
 * las demás, esta prueba falla.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { androidVersionCode, parseVersion, VERSION_PATTERN } from './version';

const root = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const version = JSON.parse(read('package.json')).version as string;

describe('versión única', () => {
  it('package.json tiene una versión válida para todas las plataformas', () => {
    expect(parseVersion(version)).not.toBeNull();
  });

  it('iPhone/iPad usa la misma versión y el mismo código que Android', () => {
    const parsed = parseVersion(version)!;
    const project = read('mobile/ios/App/project.yml');
    expect(/MARKETING_VERSION:\s*"([^"]*)"/.exec(project)?.[1]).toBe(`${parsed.major}.${parsed.minor}.${parsed.patch}`);
    expect(/CURRENT_PROJECT_VERSION:\s*"([^"]*)"/.exec(project)?.[1]).toBe(String(androidVersionCode(parsed)));
  });

  it('Android calcula la versión desde package.json con la misma fórmula', () => {
    const gradle = read('mobile/android/app/build.gradle.kts');
    expect(gradle).toContain('versionName = icarusVersion');
    expect(gradle).toContain('versionCode = icarusVersionCode');
    expect(gradle).not.toMatch(/versionName\s*=\s*"/);
    expect(gradle).toContain('((major.toInt() * 100 + minor.toInt()) * 100 + patch.toInt()) * 100 + (preview.toIntOrNull() ?: 99)');
    // El mismo patrón de versión que electron/update/version.ts.
    const kotlin = /Regex\("(.*)"\)\.matchEntire\(icarusVersion\)/.exec(gradle)?.[1].replace(/\\\\/g, '\\');
    expect(kotlin).toBe(VERSION_PATTERN.source);
  });
});
