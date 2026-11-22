import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { isLinked, resetLink, saveNumbers } from '../src/setup.js';

function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pricetracker-setup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('saving numbers keeps every other setting', (t) => {
  const dir = temp(t);
  writeFileSync(join(dir, '.env'), '# note\r\nALLOWED_NUMBERS=491111111111\r\nMIN_DROP_PERCENT=5\r\n');
  saveNumbers(dir, '+49 170 1234567, 0043 664 1234567');
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'),
    '# note\r\nALLOWED_NUMBERS=491701234567,436641234567\r\nMIN_DROP_PERCENT=5\r\n');
});

test('first setup starts from the example', (t) => {
  const dir = temp(t);
  writeFileSync(join(dir, '.env.example'), 'ALLOWED_NUMBERS=\nDATA_DIR=data\n');
  saveNumbers(dir, '491701234567');
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'ALLOWED_NUMBERS=491701234567\nDATA_DIR=data\n');
});

test('invalid number writes nothing', (t) => {
  const dir = temp(t);
  assert.throws(() => saveNumbers(dir, '0170 1234567'));
  assert.equal(existsSync(join(dir, '.env')), false);
});

test('relinking moves the session and refuses while the bot runs', (t) => {
  const dir = temp(t);
  mkdirSync(join(dir, 'auth'));
  writeFileSync(join(dir, 'auth', 'creds.json'), '{"me":{"id":"1"}}');
  assert.equal(isLinked(dir), true);

  const lock = new DatabaseSync(join(dir, 'instance.lock'));
  lock.exec('BEGIN EXCLUSIVE');
  assert.throws(() => resetLink(dir), /läuft noch/);
  lock.close();

  resetLink(dir);
  assert.equal(isLinked(dir), false);
  assert.ok(readdirSync(dir).some((name) => name.startsWith('auth-alt-')));
});
