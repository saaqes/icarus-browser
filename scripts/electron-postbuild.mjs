/**
 * El proyecto usa módulos ES («type": "module"), pero el proceso principal y el
 * preload de Electron se compilan como CommonJS. Este archivo lo indica a Node
 * para la carpeta dist-electron/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('dist-electron', { recursive: true });
writeFileSync('dist-electron/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
