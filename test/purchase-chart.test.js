import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { inflateSync } from 'node:zlib';
import { generateWAMessageContent } from 'baileys';
import { axis, HEIGHT, priceChart, WIDTH } from '../src/chart.js';
import { startWhatsApp } from '../src/whatsapp.js';
import { setup } from './helpers.js';

const U = '491701234567';
const OTHER = '491709999999';
const DAY = 86_400_000;

async function withHistory(prices = [10000, 9000, 9500]) {
  const t = setup();
  await t.handle(U, 'https://shop.de/a');
  t.db.clearHistory(1);
  const start = Date.now() - prices.length * DAY;
  prices.forEach((price, i) => t.db.record(1, start + i * DAY, price, 'EUR'));
  t.db.update(1, { price: prices.at(-1), currency: 'EUR', available: 1 });
  return t;
}

/** Decodes our own PNG output: 8 bit RGB, filter 0. */
function decode(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  let offset = 8;
  const data = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') data.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const pixel = (x, y) => [...raw.subarray(y * (width * 3 + 1) + 1 + x * 3, y * (width * 3 + 1) + 4 + x * 3)];
  return { width, height, pixel, raw };
}

// purchase
test('gekauft records the saving and ends tracking', async () => {
  const t = await withHistory();
  const reply = await t.handle(U, 'gekauft 1');
  assert.match(reply, /Gespart: \*5,00\s€\* \(−5 %\)/);
  assert.equal(t.db.product(1), undefined);
  assert.match(await t.handle(U, 'ersparnis'), /\(1 Kauf\)\nGespart: \*5,00\s€\*/);
});

test('gekauft with the price actually paid', async () => {
  const t = await withHistory();
  assert.match(await t.handle(U, 'gekauft 1 79,90'), /für \*79,90\s€\*/);
  assert.equal(t.db.purchases(U)[0].paid, 7990);
  assert.match(await t.handle(U, 'ersparnis'), /20,10\s€/);
});

test('paying more is shown honestly', async () => {
  const t = await withHistory();
  assert.match(await t.handle(U, 'gekauft 1 120'), /kostete es 100,00\s€/);
  assert.match(await t.handle(U, 'ersparnis'), /Mehr bezahlt: \*20,00\s€\*/);
});

test('undo brings the product back and removes the purchase', async () => {
  const t = await withHistory();
  const before = { product: t.db.product(1), history: t.db.history(1, 10) };
  await t.handle(U, 'gekauft 1');
  assert.match(await t.handle(U, 'rückgängig'), /aus der Ersparnis entfernt/);
  assert.deepEqual({ product: t.db.product(1), history: t.db.history(1, 10) }, before);
  assert.equal(t.db.purchases(U).length, 0);
});

test('a later delete keeps the purchase', async () => {
  const t = await withHistory();
  await t.handle(U, 'https://shop.de/b');
  await t.handle(U, 'gekauft 1');
  await t.handle(U, 'löschen 2');
  await t.handle(U, 'rückgängig');
  assert.equal(t.db.purchases(U).length, 1);
});

test('gekauft without a known price asks for it', async () => {
  const { handle, db, state } = setup();
  state.error = new Error('offline');
  await handle(U, 'https://shop.de/a');
  assert.match(await handle(U, 'gekauft 1'), /gekauft 1 79,90/);
  assert.equal(db.product(1).id, 1);
});

for (const value of ['morgen', '-10%', 'zwei']) {
  test(`gekauft refuses "${value}"`, async () => {
    const t = await withHistory();
    assert.match(await t.handle(U, `gekauft 1 ${value}`), /verstehe ich nicht/);
    assert.equal(t.db.product(1).id, 1);
  });
}

test('savings are private and summed per currency', async () => {
  const t = await withHistory();
  await t.handle(U, 'gekauft 1');
  await t.handle(OTHER, 'https://shop.de/x');
  await t.handle(OTHER, 'gekauft 2');
  t.db.buy({ id: 99, user: U, url: 'https://shop.ch/y' }, { title: 'Uhr', paid: 9000, start: 10000, currency: 'CHF', at: Date.now() });
  const reply = await t.handle(U, 'ersparnis');
  assert.match(reply, /5,00\s€/);
  assert.match(reply, /CHF/);
  assert.match(reply, /\(2 Käufe\)/);
  assert.match(await t.handle(OTHER, 'ersparnis'), /\(1 Kauf\)/);
});

test('others cannot mark a product as bought', async () => {
  const t = await withHistory();
  assert.match(await t.handle(OTHER, 'gekauft 1'), /gibt es nicht/);
  assert.equal(t.db.product(1).id, 1);
});

test('price alert suggests gekauft', async () => {
  const t = await withHistory([10000]);
  await t.handle(U, 'ziel 1 95');
  await t.read(1, { cents: 9000 });
  assert.match(t.alerts()[0], /`gekauft 1`/);
});

// chart
test('chart is a valid PNG with line, target and low point', async () => {
  const now = Date.now();
  const series = [{ at: now - 3 * DAY, price: 10000 }, { at: now - 2 * DAY, price: 8000 }, { at: now - DAY, price: 9000 }];
  const { width, height, pixel, raw } = decode(priceChart(series, { now, target: 8500 }));
  assert.deepEqual([width, height], [WIDTH, HEIGHT]);
  assert.equal(raw.length, (WIDTH * 3 + 1) * HEIGHT);
  const colors = new Set();
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) colors.add(pixel(x, y).join());
  for (const color of ['37,99,235', '22,163,74', '220,38,38', '255,255,255']) assert.ok(colors.has(color), color);
});

test('axis steps are round and cover the prices', () => {
  for (const [min, max] of [[27499, 37999], [999, 1099], [4999, 4999], [1, 3], [12900000, 13100000]]) {
    const { low, high, step } = axis(min, max);
    assert.ok(low <= min && high >= max && low >= 0);
    assert.ok(Number.isInteger(step) && /^(1|2|25|5)0*$/.test(String(step)), String(step));
    assert.ok((high - low) / step <= 8);
  }
});

test('diagramm needs at least one change', async () => {
  const t = await withHistory([10000]);
  assert.match(await t.handle(U, 'diagramm 1'), /ab der ersten Änderung/);
  const t2 = await withHistory();
  const reply = await t2.handle(U, 'diagramm 1');
  assert.equal(reply.image.mimetype, 'image/png');
  assert.match(reply.text, /Tief 90,00\s€ · Hoch 100,00\s€/);
});

test('chart ignores an older currency', async () => {
  const t = await withHistory();
  t.db.record(1, Date.now() - 10 * DAY, 1, 'USD');
  t.db.clearHistory(1);
  t.db.record(1, Date.now() - 3 * DAY, 500, 'USD');
  t.db.record(1, Date.now() - 2 * DAY, 9000, 'EUR');
  t.db.record(1, Date.now() - DAY, 9500, 'EUR');
  assert.match((await t.handle(U, 'diagramm 1')).text, /Tief 90,00\s€/);
});

test('Baileys accepts the chart without sharp or jimp', async () => {
  const t = await withHistory();
  const { image, text } = await t.handle(U, 'diagramm 1');
  const content = await generateWAMessageContent(
    { image: image.data, mimetype: image.mimetype, caption: text, width: image.width, height: image.height, jpegThumbnail: '' },
    { upload: async () => ({ mediaUrl: 'https://media.invalid/x', directPath: '/x' }) },
  );
  assert.equal(content.imageMessage.mimetype, 'image/png');
  assert.equal(Number(content.imageMessage.fileLength), image.data.length);
  assert.equal(content.imageMessage.width, WIDTH);
});

// self-chat
for (const note of ['gekauft', 'Gekauft 12 Eier', 'gekauft 1 Brot', 'Diagramm', 'Diagramm 7 zeichnen', 'bestellt am Montag', 'gespart haben wir', 'Grafik 5']) {
  test(`self-chat ignores "${note}"`, async () => {
    const t = await withHistory();
    assert.equal(await t.handle(U, note, { quiet: true }), null);
    assert.equal(t.db.product(1).id, 1);
  });
}

// delivery
test('chart is sent as a marked image, failure is explained', async (t) => {
  const { db, config, handle } = await withHistory();
  config.allowed = new Set([U]);
  config.dataDir = mkdtempSync(join(tmpdir(), 'pricetracker-chart-'));
  t.after(() => rmSync(config.dataDir, { recursive: true, force: true }));
  const sent = [];
  let fail = false;
  const socket = {
    ev: new EventEmitter(),
    user: { id: '491700000000:1@s.whatsapp.net' },
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    end() {},
    async sendMessage(to, content) {
      if (fail && content.image) throw new Error('upload failed');
      sent.push(content);
      return { key: { id: `s${sent.length}` }, message: {} };
    },
  };
  const bot = await startWhatsApp({ db, config, handle, log() {}, onFatal: assert.fail, createSocket: () => socket });
  t.after(() => bot.stop());
  socket.ev.emit('connection.update', { connection: 'open' });
  const receive = (text) => socket.ev.emit('messages.upsert', {
    messages: [{ key: { id: `m${Math.random()}`, remoteJid: `${U}@s.whatsapp.net` }, message: { conversation: text }, messageTimestamp: Date.now() / 1000 }],
  });

  receive('diagramm 1');
  await sleep(150);
  assert.ok(Buffer.isBuffer(sent[0].image));
  assert.match(sent[0].caption, /^🤖 📈/);

  fail = true;
  receive('diagramm 1');
  await sleep(150);
  assert.match(db.queued()[0].text, /Tief 90,00\s€[\s\S]*Diagramm konnte ich nicht senden/);
});
