// Entry point in Docker, where the start menu cannot ask questions.
// Used instead of the menu, so no npm packages in here.
import { spawn } from 'node:child_process';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { EXIT } from './exit-codes.js';
import { readSettings, resetLink } from './setup.js';
import { supervise } from './supervise.js';

const ROOT = join(import.meta.dirname, '..');
const log = (text) => process.stdout.write(`[${new Date().toLocaleString('de-DE')}] ${text}\n`);

let child;
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopping = true;
    if (child) child.kill(signal);
    else process.exit(EXIT.stopped);
  });
}

function run() {
  return new Promise((done) => {
    child = spawn(process.execPath, [join(import.meta.dirname, 'index.js')], { cwd: ROOT, stdio: 'inherit' });
    const finish = (code) => {
      child = undefined;
      done(stopping ? null : code);
    };
    child.on('error', () => finish(1));
    child.on('exit', (code) => finish(code ?? 1));
  });
}

function checkData() {
  let dataDir;
  try {
    dataDir = readSettings(ROOT).dataDir;
  } catch (error) {
    throw new Error(`Fehler in .env: ${error.message}`);
  }
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.W_OK);
  } catch {
    // Docker creates a missing bind-mount folder as root, the bot runs as user 1000.
    throw new Error('Der Ordner data ist nicht beschreibbar. Auf dem Host: sudo chown -R 1000:1000 data, dann docker compose restart');
  }
}

await supervise({
  run,
  relink: () => resetLink(readSettings(ROOT).dataDir),
  checkData,
  log,
  // Waits for "docker compose restart" or "down" instead of a restart loop.
  idle: () => new Promise(() => setInterval(() => {}, 2 ** 30)),
  exit: (code) => process.exit(code),
  sleep,
});
