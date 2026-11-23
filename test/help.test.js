import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../src/config.js';
import { helpText } from '../src/help.js';
import { queueReminders } from '../src/reminders.js';
import { splitText } from '../src/whatsapp.js';
import { setup } from './helpers.js';

const USER = '491701234567';
const help = (env = {}, topic) => helpText(readConfig(env), topic);
const TOPICS = [undefined, 'prices', 'daily', 'money'];

/** Something of everything, so that every example has a number to work on. */
async function fixture() {
  const t = setup();
  for (const path of ['a', 'b', 'c', 'd']) await t.handle(USER, `https://shop.de/${path}`);
  await t.handle(USER, 'löschen 4');
  await t.handle(USER, 'einkauf Milch, Brot');
  await t.handle(USER, 'todo Steuer');
  await t.handle(USER, 'notiz WLAN Gäste: sonne123');
  await t.handle(USER, 'ort Wien');
  for (const text of ['ausgabe 10 essen', 'ausgabe 5 kaffee', 'ausgabe 20 tanken', 'geburtstag Anna 12.3.1990']) await t.handle(USER, text);
  await t.handle(USER, 'kalender https://calendar.google.com/calendar/ical/secret/basic.ics');
  await t.handle(USER, 'erinnere mich morgen 9 an Arzt');
  await t.handle(USER, 'erinnere mich übermorgen 9 an Paket');
  // A reminder that just fired, for "später"
  t.db.addReminder(USER, { text: 'Wäsche', due: Date.now() - 1000 });
  queueReminders(t.db);
  return t;
}

for (const topic of TOPICS) {
  const examples = [...new Set([...help({}, topic).matchAll(/`([^`]+)`/g)].map((match) => match[1]))];
  for (const example of examples) {
    test(`help ${topic ?? 'overview'} example works: ${example}`, async () => {
      const { handle } = await fixture();
      const reply = await handle(USER, example.replace('Link', 'https://shop.de/new'));
      assert.ok(reply);
      assert.doesNotMatch(reply.text ?? reply, /nicht verstanden|Meintest du|gibt es nicht|So geht es|nichts wiederherzustellen|nicht gefunden|⚠️/);
    });
  }
}

test('price help follows the settings', () => {
  assert.match(help({}, 'prices'), /alle 3 Stunden/);
  assert.match(help({}, 'prices'), /ab 1 % Senkung/);
  assert.doesNotMatch(help({}, 'prices'), /Preis steigt/);

  assert.match(help({ CHECK_INTERVAL_MINUTES: '60' }, 'prices'), /jede Stunde/);
  assert.match(help({ CHECK_INTERVAL_MINUTES: '90' }, 'prices'), /alle 90 Minuten/);
  assert.match(help({ MIN_DROP_PERCENT: '2,5' }, 'prices'), /ab 2,5 % Senkung/);
  assert.match(help({ MIN_DROP_PERCENT: '0' }, 'prices'), /bei jeder Senkung/);
  assert.match(help({ NOTIFY_INCREASE: 'true' }, 'prices'), /Preis steigt/);
});

test('every help page fits into one message', () => {
  for (const topic of TOPICS) assert.equal(splitText(help({ NOTIFY_INCREASE: 'true' }, topic)).length, 1);
});

test('help shows the overview and the topics, unknown input points to it', async () => {
  const { handle } = setup();
  assert.equal(await handle(USER, 'hilfe'), help());
  assert.equal(await handle(USER, 'hilfe preise'), help({}, 'prices'));
  assert.equal(await handle(USER, 'Hilfe Alltag!'), help({}, 'daily'));
  assert.equal(await handle(USER, 'hilfe beim Umzug', { quiet: true }), null);
  assert.match(await handle(USER, 'was geht'), /`hilfe`/);
});
