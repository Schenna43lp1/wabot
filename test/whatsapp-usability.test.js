import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { startWhatsApp } from '../src/whatsapp.js';
import { setup } from './helpers.js';

const ME = '491700000000';
const FRIEND = '491701234567';

async function start(t, { allowed = FRIEND, delay = 0, presenceFails = false } = {}) {
  const { db, config } = setup({ ALLOWED_NUMBERS: allowed });
  config.dataDir = mkdtempSync(join(tmpdir(), 'pricetracker-ux-'));
  const logs = [];
  const sent = [];
  const presence = [];
  const socket = {
    ev: new EventEmitter(),
    user: { id: `${ME}:3@s.whatsapp.net` },
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    end() {},
    async sendPresenceUpdate(state) {
      presence.push(state);
      if (presenceFails) throw new Error('no presence');
    },
    async sendMessage(to, { text }) {
      sent.push(text);
      return { key: { id: `s${sent.length}` }, message: { conversation: text } };
    },
  };
  const handle = async () => {
    await sleep(delay);
    return 'ok';
  };
  const bot = await startWhatsApp({ db, config, handle, log: (x) => logs.push(x), onFatal: assert.fail, createSocket: () => socket });
  t.after(() => {
    bot.stop();
    rmSync(config.dataDir, { recursive: true, force: true });
  });
  socket.ev.emit('connection.update', { connection: 'open' });

  let id = 0;
  const receive = (from, message, fromMe = false) => socket.ev.emit('messages.upsert', {
    messages: [{ key: { id: `m${id++}`, remoteJid: `${from}@s.whatsapp.net`, fromMe }, message, messageTimestamp: Date.now() / 1000 }],
  });
  return { logs, sent, presence, receive };
}

test('slow replies show typing, and a presence error does not matter', async (t) => {
  const { sent, presence, receive } = await start(t, { delay: 800, presenceFails: true });
  receive(FRIEND, { conversation: 'x' });
  await sleep(1100);
  assert.deepEqual(presence, ['composing', 'paused']);
  assert.equal(sent.length, 1);
});

test('voice messages get a hint, but not in the self-chat or from strangers', async (t) => {
  const { sent, receive } = await start(t);
  receive(FRIEND, { audioMessage: {} });
  receive(ME, { audioMessage: {} }, true);
  receive('499999999999', { audioMessage: {} });
  await sleep(150);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /nur Text/);
});

test('window explains which number writes to which', async (t) => {
  const { logs } = await start(t);
  assert.ok(logs.some((line) => line.includes(`von +${FRIEND}`) && line.includes(`an +${ME}`)));
});

test('window warns if the bot number is entered as the user', async (t) => {
  const { logs } = await start(t, { allowed: ME });
  assert.ok(logs.some((line) => line.startsWith('Achtung')));
});

test('a wrong number is mentioned once, without revealing it', async (t) => {
  const { logs, receive } = await start(t);
  receive('499999999999', { conversation: 'a' });
  receive('499999999999', { conversation: 'b' });
  await sleep(100);
  const warnings = logs.filter((line) => line.includes('nicht erlaubten'));
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0], /499999999999/);
});
