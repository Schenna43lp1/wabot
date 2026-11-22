// Used by the start menu, so no npm packages in here.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseEnv } from 'node:util';
import { readConfig } from './config.js';

export function readSettings(root) {
  const file = join(root, '.env');
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  // Same precedence as process.loadEnvFile in the bot.
  return readConfig({ ...fromFile, ...process.env });
}

export function saveNumbers(root, input) {
  const numbers = [...readConfig({ ALLOWED_NUMBERS: input }).allowed].join(',');
  const file = join(root, '.env');
  const before = readFileSync(existsSync(file) ? file : join(root, '.env.example'), 'utf8');
  const line = `ALLOWED_NUMBERS=${numbers}`;
  const pattern = /^[ \t]*ALLOWED_NUMBERS[ \t]*=.*$/gm;
  const after = pattern.test(before) ? before.replace(pattern, line) : `${before.trimEnd()}\n${line}\n`;
  writeFileSync(file, after);
}

export function isLinked(dataDir) {
  try {
    return Boolean(JSON.parse(readFileSync(join(dataDir, 'auth', 'creds.json'), 'utf8')).me?.id);
  } catch {
    return false;
  }
}

export function isRunning(dataDir) {
  const file = join(dataDir, 'instance.lock');
  if (!existsSync(file)) return false;
  const lock = new DatabaseSync(file);
  try {
    lock.exec('BEGIN EXCLUSIVE; ROLLBACK');
    return false;
  } catch {
    return true;
  } finally {
    lock.close();
  }
}

/** Moves the session aside instead of deleting it. */
export function resetLink(dataDir) {
  if (isRunning(dataDir)) throw new Error('Der Bot läuft noch in einem anderen Fenster. Bitte dort zuerst beenden.');
  const auth = join(dataDir, 'auth');
  if (existsSync(auth)) renameSync(auth, join(dataDir, `auth-alt-${Date.now()}`));
}
