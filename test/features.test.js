// Set before the first Date: the daylight saving tests need a fixed time zone.
process.env.TZ = 'Europe/Berlin';

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { generateWAMessageContent } from 'baileys';
import { dailyBackup } from '../src/backup.js';
import { openDatabase } from '../src/db.js';
import { UserError } from '../src/errors.js';
import { exportCsv } from '../src/export.js';
import { overview, queueReports } from '../src/report.js';
import { DAILY, isQuiet, nextReport, parseQuiet, parseReport } from '../src/schedule.js';
import { currentSeries, periodStats, sparkline } from '../src/stats.js';
import { splitText, startWhatsApp } from '../src/whatsapp.js';
import { setup } from './helpers.js';

const U = '491701234567';
const OTHER = '491709999999';
const DAY = 86_400_000;
const local = (...parts) => new Date(...parts).getTime();

async function withProducts(env) {
  const t = setup(env);
  for (const path of 'abc') await t.handle(U, `https://shop.de/${path}`);
  return t;
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pricetracker-features-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// pause
test('paused products are not checked until they continue', async () => {
  const { handle, db } = await withProducts();
  await handle(U, 'pause 2');
  assert.deepEqual(db.due(Infinity).map((p) => p.id).sort(), [1, 3]);
  assert.match(await handle(U, 'liste'), /pausiert/);
  await handle(U, 'weiter 2');
  assert.equal(db.product(2).next_check_at, 0);
  assert.equal(db.product(2).paused, 0);
});

test('pause alle only affects the own products', async () => {
  const { handle, db } = await withProducts();
  await handle(OTHER, 'https://shop.de/other');
  await handle(U, 'Pause alle!');
  assert.deepEqual(db.due(Infinity).map((p) => p.user), [OTHER]);
  assert.match(await handle(U, 'weiter alle'), /Alles läuft wieder \(3 Produkte\)/);
  assert.equal(db.due(Infinity).length, 4);
});

test('a drop during a pause is reported afterwards', async () => {
  const t = await withProducts();
  await t.handle(U, 'pause 1');
  await t.handle(U, 'weiter 1');
  await t.read(1, { cents: 9000 });
  assert.match(t.alerts()[0], /Preis gesunken/);
});

test('pausing also reaches a check that is already waiting', async () => {
  const { handle, db, tracker, state } = await withProducts();
  for (const id of [1, 2, 3]) db.update(id, { next_check_at: 0 });
  db.update(2, { url: 'https://two.de/b' });
  db.update(3, { url: 'https://three.de/c' });
  const before = db.product(3).checked_at;
  state.page.cents = 9000;
  const sweep = tracker.checkDue();
  await handle(U, 'pause 3');
  await sweep;
  assert.equal(db.product(3).checked_at, before);
  assert.equal(db.product(3).price, 10000);
});

test('long lists break between lines', () => {
  const lines = Array.from({ length: 100 }, (_, i) => `${i}. ${'x'.repeat(60)}`);
  for (const part of splitText(lines.join('\n'))) for (const line of part.split('\n')) assert.ok(lines.includes(line));
});

// name
test('an own name survives checks and is used everywhere', async () => {
  const t = await withProducts();
  await t.handle(U, 'name 2 Papas *Kopfhörer*');
  await t.read(2, { cents: 9000, title: 'Sony WH-1000XM5 Wireless' });
  assert.equal(t.db.product(2).name, 'Papas Kopfhörer');
  for (const reply of [await t.handle(U, 'liste'), await t.handle(U, 'verlauf 2'), t.alerts()[0]]) {
    assert.match(reply, /Papas Kopfhörer/);
  }
  assert.match(await t.handle(U, 'löschen kopfhörer'), /löschen 2/);
  assert.match(await t.handle(U, 'name 2 auto'), /Sony/);
});

test('bad names are refused', async () => {
  const { handle, db } = await withProducts();
  for (const value of ['', '***', 'x'.repeat(61), 'https://x.de']) await handle(U, `name 1 ${value}`);
  assert.equal(db.product(1).name, null);
});

// threshold
test('threshold per product, also adding up small drops', async () => {
  const t = await withProducts();
  await t.handle(U, 'schwelle 1 5%');
  await t.read(1, { cents: 9700 });
  assert.equal(t.alerts().length, 0);
  await t.read(1, { cents: 9400 });
  assert.equal(t.alerts().length, 1);
});

test('threshold immer and auto', async () => {
  const t = await withProducts();
  await t.handle(U, 'schwelle 1 immer');
  await t.read(1, { cents: 9990 });
  assert.equal(t.alerts().length, 1);
  await t.handle(U, 'schwelle 1 auto');
  assert.equal(t.db.product(1).min_drop, null);
});

for (const value of ['5', '-5%', '100%', '5 euro', '5% bis morgen']) {
  test(`threshold refuses "${value}"`, async () => {
    const { handle, db } = await withProducts();
    assert.match(await handle(U, `schwelle 1 ${value}`), /So geht es/);
    assert.equal(db.product(1).min_drop, null);
  });
}

// times
const quietHours = {
  '22-7': [1320, 420], '22:30-06:45': [1350, 405], 'von 22 bis 7 Uhr': [1320, 420], '22 – 7': [1320, 420], '13.30-15': [810, 900],
  '20-24': [1200, 0], '22': null, '22-22': null, '25-7': null, '22:70-7': null, '24:30-7': null, 'nachts': null, '1-2-3': null,
};
for (const [input, expected] of Object.entries(quietHours)) {
  test(`quiet hours "${input}"`, () => assert.deepEqual(parseQuiet(input), expected && { from: expected[0], to: expected[1] }));
}

const reportTimes = {
  'täglich 8': [DAILY, 480], 'Täglich um 18:30 Uhr': [DAILY, 1110], 'sonntag 18': [0, 1080], 'freitags 7.15': [5, 435],
  'wöchentlich': [1, 480], 'morgen': null, 'täglich abends': null, 'montag 25': null, 'der Kosten': null,
};
for (const [input, expected] of Object.entries(reportTimes)) {
  test(`report time "${input}"`, () => assert.deepEqual(parseReport(input), expected && { day: expected[0], minute: expected[1] }));
}

test('quiet hours include the start and exclude the end', () => {
  const night = { quiet_from: 1320, quiet_to: 420 };
  const at = (h, m = 0) => isQuiet(night, local(2026, 10, 22, h, m));
  assert.deepEqual([at(21, 59), at(22), at(0), at(6, 59), at(7), at(12)], [false, true, true, true, false, false]);
  const noon = { quiet_from: 780, quiet_to: 900 };
  assert.equal(isQuiet(noon, local(2026, 10, 22, 14)), true);
  assert.equal(isQuiet(noon, local(2026, 10, 22, 16)), false);
});

test('next report is strictly in the future and on the right day', () => {
  const eight = { day: DAILY, minute: 480 };
  assert.equal(nextReport(eight, local(2026, 10, 22, 7)), local(2026, 10, 22, 8));
  assert.equal(nextReport(eight, local(2026, 10, 22, 8)), local(2026, 10, 23, 8));
  assert.equal(nextReport({ day: 0, minute: 1080 }, local(2026, 10, 22, 19)), local(2026, 10, 29, 18));
  assert.equal(nextReport(eight, local(2026, 11, 31, 9)), local(2027, 0, 1, 8));
});

test('reports keep their local time over daylight saving', () => {
  for (const [month, day, hours] of [[2, 27, 23], [9, 30, 25]]) {
    const before = local(2027, month, day, 8);
    const next = nextReport({ day: DAILY, minute: 480 }, before);
    assert.equal(new Date(next).getHours(), 8);
    assert.equal((next - before) / 3_600_000, hours);
  }
});

// report
test('overview groups what changed', async () => {
  const t = await withProducts();
  for (const id of [1, 2, 3]) t.db.clearHistory(id);
  const now = Date.now();
  for (const id of [1, 2, 3]) t.db.record(id, now - 10 * DAY, 10000, 'EUR');
  t.db.update(1, { price: 9000 });
  t.db.update(2, { price: 11000 });
  t.db.update(3, { price: 7000, target: 8000 });
  const text = overview(t.db, U, now);
  assert.match(text, /Zielpreis erreicht\*\n3\./);
  assert.match(text, /Günstiger\*\n1\./);
  assert.match(text, /Teurer\*\n2\./);
});

test('overview does not praise sold-out or paused products', async () => {
  const t = await withProducts();
  t.db.update(1, { target: 20000, available: 0 });
  t.db.update(2, { target: 20000, paused: 1 });
  const text = overview(t.db, U);
  assert.doesNotMatch(text, /Zielpreis erreicht/);
  assert.match(text, /1 pausiert/);
});

test('a report missed for days is sent once', async () => {
  const { db } = await withProducts();
  const now = local(2026, 10, 22, 12);
  db.saveSettings(U, { report_day: DAILY, report_minute: 480, report_next: local(2026, 10, 18, 8) });
  queueReports(db, now);
  queueReports(db, now + 60_000);
  assert.equal(db.queued().length, 1);
  assert.equal(db.settings(U).report_next, local(2026, 10, 23, 8));
});

test('a report waits for the quiet hours to end', async () => {
  const { db } = await withProducts();
  db.saveSettings(U, { quiet_from: 1320, quiet_to: 420, report_day: DAILY, report_minute: 360, report_next: local(2026, 10, 22, 6) });
  queueReports(db, local(2026, 10, 22, 6, 1));
  assert.equal(db.queued().length, 0);
  queueReports(db, local(2026, 10, 22, 7));
  assert.equal(db.queued().length, 1);
});

test('report can be switched on and off in the chat', async () => {
  const { handle, db } = await withProducts();
  assert.match(await handle(U, 'übersicht täglich 8'), /08:00/);
  assert.ok(db.settings(U).report_next > Date.now());
  assert.match(await handle(U, 'übersicht'), /Kommt täglich/);
  await handle(U, 'übersicht aus');
  assert.equal(db.dueReports(Number.MAX_SAFE_INTEGER).length, 0);
});

// statistics
test('average counts how long a price was valid', () => {
  const now = 100 * DAY;
  const series = [{ at: now - 40 * DAY, price: 10000 }, { at: now - 3 * DAY, price: 5000 }];
  assert.deepEqual(periodStats(series, now, 30), { low: 5000, average: 9500, span: 30 * DAY });
});

test('statistics ignore prices in an earlier currency', () => {
  const rows = [{ currency: 'EUR' }, { currency: 'USD' }, { currency: 'EUR', price: 1 }, { currency: 'EUR', price: 2 }];
  assert.deepEqual(currentSeries(rows, 'EUR'), rows.slice(2));
});

test('sparkline runs from high to low', () => {
  const line = sparkline([{ at: 0, price: 200 }, { at: 50, price: 100 }], 100);
  assert.equal(line.length, 20);
  assert.match(line, /^█+▁+$/);
});

test('verlauf shows trend, average and lowest price', async () => {
  const t = await withProducts();
  t.db.clearHistory(1);
  t.db.record(1, Date.now() - 20 * DAY, 12000, 'EUR');
  t.db.record(1, Date.now() - 5 * DAY, 10000, 'EUR');
  const reply = await t.handle(U, 'verlauf 1');
  assert.match(reply, /Ø 115,00/);
  assert.match(reply, /█+▁+/);
  assert.match(reply, /noch nie/);
});

// export
test('export is private and cannot inject formulas', async () => {
  const t = await withProducts();
  await t.handle(OTHER, 'https://shop.de/secret');
  t.db.update(1, { title: '=HYPERLINK("http://evil","Preis")' });
  t.db.update(2, { name: ' @SUM(1)' });
  const csv = exportCsv(t.db, U).toString('utf8');
  assert.ok(csv.startsWith('﻿'));
  assert.doesNotMatch(csv, /secret/);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"",""Preis"")"`));
  assert.ok(csv.includes(`"' @SUM(1)"`));
  assert.match(csv, /;100,00;"EUR";/);
});

test('export includes products without a price', async () => {
  const { handle, db, state } = setup();
  state.error = new UserError('Fehler', 'blocked');
  await handle(U, 'https://shop.de/a');
  assert.match(exportCsv(db, U).toString(), /shop\.de\/a/);
});

test('Baileys accepts the export as a document', async () => {
  const { handle } = await withProducts();
  const { file, text } = await handle(U, 'export');
  let uploaded = 0;
  const content = await generateWAMessageContent(
    { document: file.data, fileName: file.name, mimetype: file.mimetype, caption: text },
    { upload: async () => (uploaded++, { mediaUrl: 'https://media.invalid/x', directPath: '/x' }) },
  );
  const message = content.documentWithCaptionMessage?.message.documentMessage ?? content.documentMessage;
  assert.equal(uploaded, 1);
  assert.equal(message.fileName, 'preise.csv');
  assert.equal(Number(message.fileLength), file.data.length);
});

// self-chat
const notes = [
  'Pause', 'pause 15 Minuten', 'Pause 15', 'weiter gehts', 'weiter', 'Name', 'Name 12 Max', 'name des Arztes', 'Ruhe',
  'ruhe bitte jetzt', 'Ruhezeit beachten', 'Übersicht der Kosten', 'export der Fotos', 'schwelle', 'pause 2 Minuten', 'alle weiter',
];
for (const note of notes) {
  test(`self-chat ignores new command word "${note}"`, async () => {
    const { handle, db } = await withProducts();
    const before = db.products(U);
    assert.equal(await handle(U, note, { quiet: true }), null);
    assert.deepEqual(db.products(U), before);
  });
}

test('new words in shared text still add the product', async () => {
  for (const word of ['Übersicht', 'Ruhe', 'Export', 'Name der Lampe']) {
    const { handle, db } = setup();
    await handle(U, `${word} https://shop.de/a`);
    assert.equal(db.products(U).length, 1, word);
  }
});

test('others cannot change a product', async () => {
  const { handle, db } = await withProducts();
  const before = db.product(1);
  for (const command of ['pause 1', 'name 1 Meins', 'schwelle 1 9%']) assert.match(await handle(OTHER, command), /gibt es nicht/);
  assert.deepEqual(db.product(1), before);
});

test('undo keeps name, pause and threshold', async () => {
  const { handle, db } = await withProducts();
  for (const command of ['name 1 Lampe', 'schwelle 1 5%', 'pause 1']) await handle(U, command);
  const before = db.product(1);
  await handle(U, 'löschen 1');
  await handle(U, 'rückgängig');
  assert.deepEqual(db.product(1), before);
});

// delivery
async function whatsapp(t, { fail = false } = {}) {
  const { db, config, handle } = await withProducts({ ALLOWED_NUMBERS: U });
  config.dataDir = tempDir(t);
  const clock = { now: local(2026, 10, 22, 23) };
  const sent = [];
  const socket = {
    ev: new EventEmitter(),
    user: { id: '491700000000:1@s.whatsapp.net' },
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    end() {},
    async sendMessage(to, content) {
      if (fail && content.document) throw new Error('upload failed');
      sent.push(content);
      return { key: { id: `s${sent.length}` }, message: { conversation: content.text ?? content.caption } };
    },
  };
  const bot = await startWhatsApp({ db, config, handle, log() {}, onFatal: assert.fail, createSocket: () => socket, now: () => clock.now });
  t.after(() => bot.stop());
  socket.ev.emit('connection.update', { connection: 'open' });
  await sleep(20);
  const receive = (text) => socket.ev.emit('messages.upsert', {
    messages: [{ key: { id: `m${Math.random()}`, remoteJid: `${U}@s.whatsapp.net` }, message: { conversation: text }, messageTimestamp: Date.now() / 1000 }],
  });
  return { db, bot, clock, sent, receive };
}

test('quiet hours hold alerts, not replies', async (t) => {
  const { db, bot, clock, sent, receive } = await whatsapp(t);
  db.saveSettings(U, { quiet_from: 1320, quiet_to: 420 });
  db.queue(U, 'Alarm', { at: clock.now });
  db.queue(U, 'Antwort', { at: clock.now, urgent: true });
  await bot.flush();
  assert.deepEqual(sent.map((m) => m.text), ['🤖 Antwort']);

  receive('liste');
  await sleep(100);
  assert.match(sent[1].text, /3 Produkte/);

  clock.now = local(2026, 10, 23, 7);
  await bot.flush();
  assert.match(sent[2].text, /^🤖 Alarm\n\n_Stand: 22\.11\..* 23:00 Uhr_$/);
  assert.equal(db.queued().length, 0);
});

test('export arrives as a marked document', async (t) => {
  const { sent, receive } = await whatsapp(t);
  receive('export');
  await sleep(150);
  assert.ok(Buffer.isBuffer(sent[0].document));
  assert.match(sent[0].caption, /^🤖 /);
});

test('a failed export is explained', async (t) => {
  const { db, receive } = await whatsapp(t, { fail: true });
  receive('export');
  await sleep(150);
  assert.match(db.queued()[0].text, /nicht senden/);
  assert.equal(db.queued()[0].urgent, 1);
});

// backup
test('backup is readable and runs once a day', async (t) => {
  const dir = tempDir(t);
  const db = openDatabase(join(dir, 'tracker.db'));
  db.add(U, "https://shop.de/it's");
  assert.equal(dailyBackup(db, dir, new Date(2026, 10, 22)), true);
  assert.equal(dailyBackup(db, dir, new Date(2026, 10, 22)), false);
  const copy = new DatabaseSync(join(dir, 'backup', 'tracker-2026-11-22.db'));
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM products').get().n, 1);
  copy.close();
  db.close();
});

test('backup keeps seven copies and foreign files', (t) => {
  const dir = tempDir(t);
  const db = openDatabase(join(dir, 'tracker.db'));
  dailyBackup(db, dir, new Date(2026, 10, 1));
  writeFileSync(join(dir, 'backup', 'tracker-wichtig.db'), 'mine');
  for (let day = 2; day <= 10; day++) dailyBackup(db, dir, new Date(2026, 10, day));
  const files = readdirSync(join(dir, 'backup')).sort();
  assert.equal(files.length, 8);
  assert.equal(files[0], 'tracker-2026-11-04.db');
  assert.ok(files.includes('tracker-wichtig.db'));
  db.close();
});
