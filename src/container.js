// Entry point in Docker, where the start menu cannot ask questions.
// Used instead of the menu, so no npm packages in here.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { EXIT } from './exit-codes.js';
import { readSettings, resetLink } from './setup.js';

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
    child.on('error', () => done(1));
    child.on('exit', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

for (;;) {
  const code = await run();
  child = undefined;
  // Without this the old session fails again on every restart. A new QR code
  // only links the device the owner scans it with, so it is safe to show.
  if (code === EXIT.loggedOut && !stopping) {
    resetLink(readSettings(ROOT).dataDir);
    log('Neuer QR-Code folgt. Die alte Verknüpfung liegt in data/auth-alt-…');
    continue;
  }
  // Everything else Docker handles: restart after a crash, stop after "docker compose down".
  process.exit(code);
}
