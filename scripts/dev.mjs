/**
 * Desarrollo de la aplicación de escritorio: compila el proceso principal,
 * arranca el servidor de Vite (con recarga en caliente de la interfaz) y abre
 * Electron apuntando a él. Los cambios en electron/ requieren reiniciar.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const tscPath = require.resolve('typescript/bin/tsc');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} terminó con código ${code}`))));
  });
}

await run(process.execPath, [tscPath, '-p', 'tsconfig.electron.json']);
await run(process.execPath, ['scripts/electron-postbuild.mjs']);

const server = await createServer({ server: { port: 5173, strictPort: true } });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';
console.log(`Interfaz en ${url}`);

const env = { ...process.env, ICARUS_DEV_SERVER_URL: url };
delete env.ELECTRON_RUN_AS_NODE;
const electron = spawn(electronPath, ['.'], { stdio: 'inherit', env });
electron.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
