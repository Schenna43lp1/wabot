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
const jid = (number) => `${number}@s.whatsapp.net`;

test('WhatsApp: access, self-chat, alerts and no loops', async (t) => {
  const { db, config, handle, tracker, state } = setup({ ALLOWED_NUMBERS: FRIEND });
  config.dataDir = mkdtempSync(join(tmpdir(), 'pricetracker-test-'));
  const sent = [];
  const socket = {
    ev: new EventEmitter(),
    user: { id: `${ME}:7@s.whatsapp.net`, lid: '111:7@lid' },
    signalRepository: { lidMapping: { getPNForLID: async (lid) => (lid === '333@lid' ? `${FRIEND}:0@s.whatsapp.net` : null) } },
    end() {},
    async sendMessage(to, { text }) {
      sent.push({ to, text });
      const result = { key: { id: `sent${sent.length}`, remoteJid: to, fromMe: true }, message: { conversation: text } };
      // Baileys echoes our own messages, just like this.
      process.nextTick(() => socket.ev.emit('messages.upsert', {
        messages: [{ ...result, messageTimestamp: Date.now() / 1000 }],
      }));
      return result;
    },
  };
  const bot = await startWhatsApp({ db, config, handle, log() {}, onFatal: assert.fail, createSocket: () => socket });
  t.after(() => {
    bot.stop();
    rmSync(config.dataDir, { recursive: true, force: true });
  });
  socket.ev.emit('connection.update', { connection: 'open' });

  let next = 0;
  async function receive(key, text, { id = `m${next++}`, age = 0 } = {}) {
    sent.length = 0;
    socket.ev.emit('messages.upsert', {
      messages: [{ key: { id, ...key }, message: { conversation: text }, messageTimestamp: Date.now() / 1000 - age }],
    });
    await sleep(60);
    return [...sent];
  }

  const fromFriend = { remoteJid: jid(FRIEND) };
  assert.equal((await receive(fromFriend, 'hilfe')).length, 1, 'allowed number');
  assert.equal((await receive({ remoteJid: '222@lid', remoteJidAlt: jid(FRIEND) }, 'hilfe')).length, 1, 'LID with number');
  assert.equal((await receive({ remoteJid: '333@lid' }, 'hilfe')).length, 1, 'LID through mapping');
  assert.equal((await receive({ remoteJid: jid(ME), fromMe: true }, 'hilfe')).length, 1, 'self-chat without loop');
  assert.equal((await receive({ remoteJid: '111@lid', fromMe: true }, 'hilfe')).length, 1, 'self-chat by LID');
  assert.equal((await receive({ remoteJid: jid(ME), fromMe: true }, 'Milch kaufen')).length, 0, 'note');
  assert.equal((await receive({ remoteJid: jid(FRIEND), fromMe: true }, 'hilfe')).length, 0, 'owner writing to others');
  assert.equal((await receive({ remoteJid: jid('499999999999') }, 'hilfe')).length, 0, 'stranger');
  assert.equal((await receive({ remoteJid: '444@lid' }, 'hilfe')).length, 0, 'unknown LID');
  assert.equal((await receive({ remoteJid: '1@g.us', participant: jid(FRIEND) }, 'hilfe')).length, 0, 'group');
  assert.equal((await receive(fromFriend, 'hilfe', { age: 2 * 86_400 })).length, 0, 'old message');
  assert.equal((await receive(fromFriend, 'hilfe', { id: 'same' })).length, 1);
  assert.equal((await receive(fromFriend, 'hilfe', { id: 'same' })).length, 0, 'redelivery');

  assert.match((await receive(fromFriend, 'https://shop.de/p 95'))[0].text, /beobachtet/);
  state.page.cents = 9000;
  await tracker.check(1);
  sent.length = 0;
  await bot.flush();
  assert.equal(sent[0].to, jid(FRIEND));
  assert.match(sent[0].text, /Zielpreis/);
  assert.equal(db.queued().length, 0);

  socket.ev.emit('connection.update', { connection: 'open' });
  db.queue('499999999999', 'secret');
  sent.length = 0;
  await bot.flush();
  await sleep(20);
  assert.equal(sent.length, 0, 'no alerts for removed numbers');
});
