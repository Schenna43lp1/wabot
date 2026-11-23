// Set before the first Date: times are local.
process.env.TZ = 'Europe/Berlin';

import assert from 'node:assert/strict';
import test from 'node:test';
import { queueBriefings } from '../src/briefing.js';
import { queueReminders } from '../src/reminders.js';
import { nextReport, parseReport, WORKDAYS } from '../src/schedule.js';
import { createWeather, weatherText } from '../src/weather.js';
import { dueText, nextTime, parseLater, parseReminder } from '../src/when.js';
import { fakeWeather, setup } from './helpers.js';

const U = '491701234567';
const OTHER = '491709999999';
const local = (...parts) => new Date(...parts).getTime();
// Monday, 23 November 2026, 14:00
const MONDAY = local(2026, 10, 23, 14, 0);

function withClock(start = MONDAY) {
  const clock = { now: start };
  const t = setup({}, { now: () => clock.now });
  return { ...t, clock };
}

// Parsing times
const cases = [
  ['mich morgen 9 an Arzt', 'Arzt', local(2026, 10, 24, 9, 0)],
  ['mich in 30 min an Wäsche', 'Wäsche', local(2026, 10, 23, 14, 30)],
  ['mich in einer halben Stunde an Pizza', 'Pizza', local(2026, 10, 23, 14, 30)],
  ['mich in 1,5 stunden an Ofen', 'Ofen', local(2026, 10, 23, 15, 30)],
  ['mich in 2 tagen um 8 an Paket', 'Paket', local(2026, 10, 25, 8, 0)],
  ['an den Müll morgen 7', 'den Müll', local(2026, 10, 24, 7, 0)],
  ['um 15 uhr ans Telefonat', 'Telefonat', local(2026, 10, 23, 15, 0)],
  ['um 13 Uhr Mittagessen', 'Mittagessen', local(2026, 10, 24, 13, 0)],
  ['mich heute abend an Wäsche', 'Wäsche', local(2026, 10, 23, 19, 0)],
  ['morgen früh joggen', 'joggen', local(2026, 10, 24, 8, 0)],
  ['mich am 24.12. an Geschenke', 'Geschenke', local(2026, 11, 24, 9, 0)],
  ['mich am 1.1.2027 um 0:30 an Neujahr', 'Neujahr', local(2027, 0, 1, 0, 30)],
  ['Zahnarzt am Freitag um 14:30', 'Zahnarzt', local(2026, 10, 27, 14, 30)],
  ['mich montag 9 an Bericht', 'Bericht', local(2026, 10, 30, 9, 0)],
  ['mich montag 15 an Bericht', 'Bericht', local(2026, 10, 23, 15, 0)],
  ['mich am 10.3. an Reifen', 'Reifen', local(2027, 2, 10, 9, 0)],
];
for (const [input, text, due] of cases) {
  test(`reminder time: "${input}"`, () => assert.deepEqual(parseReminder(input, MONDAY), { text, due }));
}

test('recurring reminder times', () => {
  assert.deepEqual(parseReminder('mich jeden Montag 8 an Müll', MONDAY), { text: 'Müll', rule: { day: 1, minute: 480 } });
  assert.deepEqual(parseReminder('montags an Biomüll', MONDAY), { text: 'Biomüll', rule: { day: 1, minute: 540 } });
  assert.deepEqual(parseReminder('täglich 21:30 Tabletten', MONDAY), { text: 'Tabletten', rule: { day: 7, minute: 1290 } });
  assert.deepEqual(parseReminder('mich jeden Tag an Wasser trinken', MONDAY), { text: 'Wasser trinken', rule: { day: 7, minute: 540 } });
  assert.deepEqual(parseReminder('werktags 6:30 Bus', MONDAY), { text: 'Bus', rule: { day: WORKDAYS, minute: 390 } });
  assert.deepEqual(parseReminder('monatlich am 1. an Miete', MONDAY), { text: 'Miete', rule: { monthDay: 1, minute: 540 } });
  assert.deepEqual(parseReminder('jeden 31. Rechnung', MONDAY), { text: 'Rechnung', rule: { monthDay: 31, minute: 540 } });
});

test('next times of rules', () => {
  // Saturday evening: the next workday is Monday.
  assert.equal(nextTime({ day: WORKDAYS, minute: 390 }, local(2026, 10, 28, 20, 0)), local(2026, 10, 30, 6, 30));
  // The 31st in a month with 30 days is its last day.
  assert.equal(nextTime({ monthDay: 31, minute: 540 }, MONDAY), local(2026, 10, 30, 9, 0));
  assert.equal(nextTime({ monthDay: 31, minute: 540 }, local(2026, 10, 30, 10, 0)), local(2026, 11, 31, 9, 0));
  assert.equal(nextTime({ monthDay: 31, minute: 540 }, local(2027, 0, 31, 10, 0)), local(2027, 1, 28, 9, 0));
  // Across the change to summer time
  assert.equal(nextTime({ day: 7, minute: 120 }, local(2027, 2, 27, 3, 0)), local(2027, 2, 28, 3, 0));
});

test('no reminder without a time or with a time in the past', () => {
  for (const input of ['Milch kaufen', 'mich 3 Brote kaufen', 'mich', 'mich am 30.2. an X', 'mich morgen 9']) {
    assert.equal(parseReminder(input, MONDAY), null, input);
  }
  assert.match(parseReminder('mich heute 10 an X', MONDAY).error, /vorbei/);
  assert.match(parseReminder('mich am 1.1.2020 an X', MONDAY).error, /vorbei/);
});

test('times are written the way people say them', () => {
  assert.equal(dueText(local(2026, 10, 23, 18, 5), MONDAY), 'heute um 18:05 Uhr');
  assert.equal(dueText(local(2026, 10, 24, 9, 0), MONDAY), 'morgen um 09:00 Uhr');
  assert.equal(dueText(local(2026, 10, 27, 9, 0), MONDAY), 'am Freitag, 27.11. um 09:00 Uhr');
  assert.equal(dueText(local(2026, 11, 24, 9, 0), MONDAY), 'am 24.12. um 09:00 Uhr');
  assert.equal(dueText(local(2027, 0, 2, 9, 0), MONDAY), 'am 02.01.2027 um 09:00 Uhr');
});

test('later', () => {
  assert.deepEqual(parseLater('', MONDAY), { due: MONDAY + 10 * 60_000 });
  assert.deepEqual(parseLater('30 min', MONDAY), { due: MONDAY + 30 * 60_000 });
  assert.deepEqual(parseLater('1h', MONDAY), { due: MONDAY + 60 * 60_000 });
  assert.deepEqual(parseLater('morgen 9', MONDAY), { due: local(2026, 10, 24, 9, 0) });
  assert.equal(parseLater('mehr dazu', MONDAY), null);
});

// Reminders
test('a reminder is confirmed, listed and sent on time, also in quiet hours', async () => {
  const { handle, db, clock, alerts } = withClock();
  await handle(U, 'ruhe 22-7');
  const reply = await handle(U, 'Erinnere mich morgen um 6 an den Flug');
  assert.match(reply, /morgen um 06:00 Uhr/);
  assert.match(reply, /\*den Flug\*/);
  assert.match(reply, /Ruhezeit/);
  assert.match(await handle(U, 'erinnerungen'), /1\.\* Di 24\.11\. 06:00 den Flug/);
  assert.match(await handle(OTHER, 'erinnerungen'), /Keine Erinnerungen/);

  clock.now = local(2026, 10, 24, 5, 59);
  queueReminders(db, clock.now);
  assert.equal(alerts().length, 0);
  clock.now = local(2026, 10, 24, 6, 0);
  queueReminders(db, clock.now);
  assert.match(alerts()[0], /Erinnerung:\* den Flug/);
  assert.equal(db.queued()[0].urgent, 1);
  assert.doesNotMatch(alerts()[0], /Fällig war/);
  assert.match(await handle(U, 'erinnerungen'), /Keine Erinnerungen/);
});

test('a reminder missed while the PC was off comes once, with a note', async () => {
  const { handle, db, clock, alerts } = withClock();
  await handle(U, 'erinnere mich täglich 8 an Tabletten');
  clock.now = local(2026, 10, 27, 10, 0);
  queueReminders(db, clock.now);
  queueReminders(db, clock.now);
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0], /Fällig war 24\.11\., 08:00 Uhr/);
  assert.match(alerts()[0], /Nächstes Mal morgen um 08:00 Uhr/);
  assert.equal(db.reminders(U)[0].due, local(2026, 10, 28, 8, 0));
});

test('später moves the last reminder, a recurring one keeps going', async () => {
  const { handle, db, clock } = withClock();
  assert.match(await handle(U, 'später'), /keine Erinnerung/);
  assert.equal(await handle(U, 'später', { quiet: true }), null);

  await handle(U, 'erinnere mich um 15 uhr an Anruf');
  await handle(U, 'erinnere mich täglich 15 an Gießen');
  clock.now = local(2026, 10, 23, 15, 0);
  queueReminders(db, clock.now);

  assert.match(await handle(U, 'später 30 min'), /heute um 15:30 Uhr noch einmal:\n\*Gießen\*/);
  assert.match(await handle(U, 'Später!'), /heute um 15:10 Uhr noch einmal:\n\*Anruf\*/);
  const texts = db.reminders(U).map((reminder) => `${reminder.text} ${new Date(reminder.due).getHours()}:${new Date(reminder.due).getMinutes()}`);
  assert.deepEqual(texts.sort(), ['Anruf 15:10', 'Gießen 15:0', 'Gießen 15:30'].sort());
  assert.equal(await handle(U, 'später mehr dazu', { quiet: true }), null);
});

test('deleting a reminder can be undone', async () => {
  const { handle, db } = withClock();
  await handle(U, 'erinnere mich morgen 9 an Arzt');
  await handle(U, 'erinnere mich jeden montag 8 an Müll');
  assert.match(await handle(U, 'erinnerung weg 1'), /gelöscht: \*Arzt\*/);
  assert.match(await handle(U, 'erinnerung weg 1'), /gibt es nicht/);
  assert.match(await handle(OTHER, 'erinnerung weg 2'), /gibt es nicht/);
  assert.match(await handle(U, 'rückgängig'), /wieder da: \*Arzt\*, morgen um 09:00/);
  assert.deepEqual(db.reminders(U).map((reminder) => reminder.text), ['Arzt', 'Müll']);
});

test('without a time the bot asks, and the next message can be the answer', async () => {
  const { handle, db, clock } = withClock();
  assert.match(await handle(U, 'erinnere mich an Milch'), /Wann soll ich dich an \*Milch\* erinnern\?/);
  assert.match(await handle(U, 'heute 9'), /schon vorbei\. Wann dann\?/);
  assert.match(await handle(U, 'Morgen halb 8!'), /morgen um 07:30 Uhr:\n\*Milch\*/);
  // Answered, so a later time is no longer taken as an answer.
  assert.notEqual(await handle(U, 'morgen 9'), null);
  assert.equal(db.reminders(U).length, 1);

  // Something else ends the question.
  await handle(U, 'erinnere mich an Pakete');
  assert.match(await handle(U, 'liste'), /beobachtest noch nichts/);
  assert.doesNotMatch(await handle(U, 'morgen 9'), /Pakete/);

  // And it expires.
  await handle(U, 'erinnere mich an Reifen');
  clock.now += 16 * 60_000;
  assert.doesNotMatch(await handle(U, 'morgen 9'), /Reifen/);
  assert.equal(db.reminders(U).length, 1);
  assert.equal(await handle(OTHER, 'morgen 9'), 'Das habe ich nicht verstanden.\n\n• `erinnere mich morgen 9 an …`\n• `einkauf Milch`, `todo …`, `notiz …`\n• Schick einen *Produktlink* zum Beobachten\n• `hilfe` zeigt alle Befehle');
});

test('unclear reminders get an example', async () => {
  const { handle } = withClock();
  assert.match(await handle(U, 'erinnere mich morgen 9'), /Woran soll ich dich erinnern/);
  assert.match(await handle(U, 'erinnere mich heute 9 an Milch'), /schon vorbei/);
  // In the self-chat only "erinnere mich …" is clearly meant for the bot.
  assert.equal(await handle(U, 'Erinnerung an Opa', { quiet: true }), null);
  assert.match(await handle(U, 'erinnere mich an Milch', { quiet: true }), /Wann soll ich/);
});

test('a reminder can be moved, a recurring one only once or for good', async () => {
  const { handle, db, clock, alerts } = withClock();
  await handle(U, 'erinnere mich morgen 9 an Arzt');
  await handle(U, 'erinnere mich jeden Montag 7 an Müll');
  assert.match(await handle(U, 'erinnerung 1 morgen 10'), /Erinnerung 1 verschoben: \*Arzt\*\nJetzt morgen um 10:00 Uhr/);
  assert.match(await handle(U, 'erinnerung verschieben 2 auf dienstag 7'), /Nächstes Mal morgen um 07:00 Uhr\.\n_Danach wieder jeden Montag um 07:00 Uhr\._/);
  assert.match(await handle(U, 'erinnerung 9 morgen 10'), /Erinnerung 9 gibt es nicht/);

  clock.now = local(2026, 10, 24, 7, 0);
  queueReminders(db, clock.now);
  assert.match(alerts()[0], /Müll[\s\S]*Nächstes Mal am Montag, 30\.11\. um 07:00 Uhr/);

  assert.match(await handle(U, 'erinnerung 2 alle 2 wochen am montag 6'), /alle 2 Wochen am Montag um 06:00 Uhr, nächstes Mal am Montag, 30\.11\. um 06:00 Uhr/);
});

test('every two weeks, also across the change to winter time', async () => {
  const { handle, db, clock, alerts } = withClock(local(2026, 9, 12, 12, 0));
  assert.match(await handle(U, 'erinnere mich alle 2 Wochen donnerstags 6:30 an Papiermüll'), /alle 2 Wochen am Donnerstag um 06:30 Uhr, nächstes Mal am Donnerstag, 15\.10\./);
  for (const day of [15, 29]) {
    clock.now = local(2026, 9, day, 6, 30);
    queueReminders(db, clock.now);
  }
  assert.equal(alerts().length, 2);
  assert.equal(db.reminders(U)[0].due, local(2026, 10, 12, 6, 30));
  assert.match(await handle(U, 'erinnerungen'), /Papiermüll 🔁 _alle 2 Wochen am Donnerstag_/);
});

test('spoken and short times', () => {
  const sunday = local(2026, 10, 22, 12, 0);
  assert.deepEqual(parseReminder('mich halb 8 an Kino', sunday), { text: 'Kino', due: local(2026, 10, 22, 19, 30) });
  assert.deepEqual(parseReminder('mich um 3 an Anruf', sunday), { text: 'Anruf', due: local(2026, 10, 22, 15, 0) });
  assert.deepEqual(parseReminder('mich um 10 an Anruf', sunday), { text: 'Anruf', due: local(2026, 10, 23, 10, 0) });
  assert.deepEqual(parseReminder('mich morgen viertel nach 9 an X', sunday), { text: 'X', due: local(2026, 10, 23, 9, 15) });
  assert.deepEqual(parseReminder('mich morgen dreiviertel acht an X', sunday), { text: 'X', due: local(2026, 10, 23, 7, 45) });
  assert.deepEqual(parseReminder('mich morgen 9h an X', sunday), { text: 'X', due: local(2026, 10, 23, 9, 0) });
  assert.deepEqual(parseReminder('mich am fr 14 an X', sunday), { text: 'X', due: local(2026, 10, 27, 14, 0) });
  assert.deepEqual(parseReminder('mich nächsten Sonntag an Oma', sunday), { text: 'Oma', due: local(2026, 10, 29, 9, 0) });
  assert.deepEqual(parseReminder('mich nächste Woche an Reifen', sunday), { text: 'Reifen', due: local(2026, 10, 23, 9, 0) });
  assert.deepEqual(parseReminder('mich am Wochenende an Rasen', sunday), { text: 'Rasen', due: local(2026, 10, 28, 9, 0) });
  assert.deepEqual(parseReminder('mich in 1 monat an Abo', local(2027, 0, 31, 12, 0)), { text: 'Abo', due: local(2027, 1, 28, 12, 0) });
  assert.deepEqual(parseReminder('mich jeden mo 7 an Müll', sunday), { text: 'Müll', rule: { day: 1, minute: 420 } });
  assert.deepEqual(parseReminder('mich alle 3 tage um 20 uhr an Pflanzen', sunday), { text: 'Pflanzen', rule: { every: 3, from: '2026-11-22', minute: 1200 } });
  // "so" and "do" are only days after "am" or "jeden".
  assert.equal(parseReminder('so ein Mist', sunday), null);
});

// Lists
test('shopping list: add, skip duplicates, tick off by number and name, undo', async () => {
  const { handle, db } = withClock();
  assert.match(await handle(U, 'einkauf'), /ist leer/);
  const added = await handle(U, 'Einkauf: Milch, Brot,  - Eier');
  assert.match(added, /➕ Milch, Brot, Eier/);
  assert.match(added, /1\. Milch\n2\. Brot\n3\. Eier/);
  assert.match(await handle(U, 'einkauf milch, Käse'), /➕ Käse\nSteht schon drauf: milch/);
  await handle(U, 'todo Steuer machen');

  assert.match(await handle(U, 'erledigt 2 4'), /Erledigt: Brot, Käse\nNoch 2 auf der Einkaufsliste/);
  // The numbers stay, so a second "erledigt" right after hits what was shown.
  assert.match(await handle(U, 'einkauf'), /1\. Milch\n3\. Eier/);
  assert.match(await handle(U, 'erledigt eier'), /Erledigt: Eier/);
  assert.match(await handle(U, 'rückgängig'), /Wieder da: Eier/);
  assert.match(await handle(U, 'erledigt 9'), /Nummer 9 gibt es nicht/);
  assert.match(await handle(U, 'erledigt Wurst'), /steht auf keiner Liste/);
  assert.match(await handle(U, 'einkauf weg 1'), /Erledigt: Milch/);

  assert.match(await handle(U, 'einkauf leeren'), /geleert \(1 Eintrag\)/);
  assert.match(await handle(U, 'todo'), /5\. Steuer machen/);
  assert.match(await handle(U, 'rückgängig'), /Eier/);
  assert.deepEqual(db.items(OTHER), []);
});

test('ticking off a list completely is celebrated, ambiguous names are asked', async () => {
  const { handle } = withClock();
  await handle(U, 'todo Oma anrufen\nOpa anrufen');
  assert.match(await handle(U, 'erledigt anrufen'), /Welches meinst du mit „anrufen“\?\n`erledigt 1` Oma anrufen\n`erledigt 2` Opa anrufen/);
  assert.match(await handle(U, 'erledigt 1, 2'), /To-do-Liste ist leer/);
});

test('several entries can be ticked off by name', async () => {
  const { handle, db } = withClock();
  await handle(U, 'einkauf Milch, Brot und Butter, Eier, Käse');
  assert.match(await handle(U, 'erledigt brot und butter'), /Erledigt: Brot und Butter\n/);
  assert.match(await handle(U, 'erledigt Milch, eier und käse'), /Erledigt: Milch, Eier, Käse\n🎉/);
  await handle(U, 'einkauf Milch, Brot');
  assert.match(await handle(U, 'erledigt Milch, Wurst'), /„Wurst“ steht auf keiner Liste/);
  assert.equal(db.items(U).length, 2);
});

// Notes
test('notes: save, list, read, search, delete and undo', async () => {
  const { handle } = withClock();
  assert.match(await handle(U, 'notiz WLAN Gäste: sonne123'), /Notiz 1 gespeichert.*\n.*`suche wlan`/);
  await handle(U, 'Merke: Reifen gewechselt bei 45.000 km\nWinterreifen im Keller');
  await handle(U, 'einkauf Reifenflickzeug');
  assert.match(await handle(U, 'notizen'), /\*2\.\* Reifen gewechselt bei 45\.000 km\n\*1\.\* WLAN/);
  assert.match(await handle(U, 'notiz 2'), /Winterreifen im Keller/);
  assert.match(await handle(U, 'notiz 7 Tage Urlaub'), /Notiz 3 gespeichert/);

  const found = await handle(U, 'suche reifen');
  assert.match(found, /Notiz 2\*[\s\S]*Winterreifen im Keller/);
  assert.match(found, /Reifenflickzeug _\(Einkaufsliste\)_/);
  assert.match(await handle(U, 'suche sonne123'), /Notiz 1/);
  assert.match(await handle(U, 'suche xyz'), /nichts gefunden/);
  assert.equal(await handle(U, 'Suche neue Wohnung', { quiet: true }), null);

  assert.match(await handle(U, 'notiz weg 1'), /gelöscht/);
  assert.match(await handle(U, 'suche wlan'), /nichts gefunden/);
  assert.match(await handle(U, 'rückgängig'), /Notiz 1 ist wieder da/);
  assert.match(await handle(OTHER, 'notiz 1'), /Notiz 1 gespeichert/);
});

test('a link in a note or list stays text and is not tracked', async () => {
  const { handle, db } = withClock();
  assert.match(await handle(U, 'notiz Rezept https://chefkoch.de/rezept/123'), /gespeichert/);
  assert.match(await handle(U, 'todo Anmelden auf https://amt.de/termin'), /Anmelden auf https:\/\/amt\.de\/termin/);
  assert.equal(db.products(U).length, 0);
});

test('the self-chat stays a notepad', async () => {
  const { handle, db } = withClock();
  for (const note of ['Milch kaufen', 'Später mehr', 'Erledigt ist erledigt', 'wetter war schön', 'Ort: Bahnhof Gleis 3 hinten links']) {
    assert.equal(await handle(U, note, { quiet: true }), null, note);
  }
  assert.equal(db.items(U).length, 0);
  // Nothing about the long note left the PC.
  assert.ok(!fakeWeather.places.some((place) => /Bahnhof|war schön/.test(place)));
});

// Weather and briefing
test('place and weather', async () => {
  const { handle, db } = withClock();
  assert.match(await handle(U, 'wetter'), /ort Wien/);
  assert.match(await handle(U, 'ort Atlantis'), /nicht gefunden/);
  const saved = await handle(U, 'ort wien');
  assert.match(saved, /Ort gespeichert: \*Wien, Österreich\*/);
  assert.match(saved, /−1 bis 7 °C, leichter Regen, Regen 70 %/);
  assert.match(await handle(U, 'wetter'), /Wien heute:\*[\s\S]*Schirm[\s\S]*Jetzt 4 °C, teils bewölkt[\s\S]*Morgen:\* −3 bis 4 °C, klar/);
  assert.match(await handle(U, 'wetter graz'), /Graz heute/);
  assert.equal(db.settings(U).place, 'Wien, Österreich');
  assert.match(await handle(U, 'ort aus'), /entfernt/);
  assert.equal(db.settings(U).lat, null);
});

test('the briefing collects the day', async () => {
  const { handle, db, clock } = withClock(local(2026, 10, 24, 7, 0));
  await handle(U, 'ort Wien');
  await handle(U, 'erinnere mich heute 18 an Sport');
  await handle(U, 'erinnere mich morgen 9 an Arzt');
  await handle(U, 'todo Steuer');
  await handle(U, 'einkauf Milch, Brot');
  const text = await handle(U, 'briefing');
  assert.match(text, /Guten Morgen!\* Dienstag, 24\. November/);
  assert.match(text, /Wien:\* −1 bis 7 °C/);
  assert.match(text, /Heute\*\n⏰ 18:00 Sport/);
  assert.doesNotMatch(text, /Arzt/);
  assert.match(text, /To-dos\* \(1\)\n1\. Steuer/);
  assert.match(text, /Einkauf:\* Milch, Brot/);
  assert.doesNotMatch(text, /Preise/);
  assert.doesNotMatch(text, /ort Wien/);

  // A product that got cheaper overnight
  clock.now = local(2026, 10, 23, 7, 0);
  await handle(U, 'https://shop.de/a');
  db.record(1, clock.now, 10000, 'EUR');
  db.update(1, { price: 8000 });
  db.record(1, local(2026, 10, 24, 3, 0), 8000, 'EUR');
  clock.now = local(2026, 10, 24, 7, 0);
  assert.match(await handle(U, 'briefing'), /Preise, letzte 24 Stunden\*\n📉 1\. .*100,00.€ → \*80,00.€\*/);
});

test('the briefing comes as scheduled, once, after quiet hours', async () => {
  const { handle, db, clock, alerts } = withClock(local(2026, 10, 23, 20, 0));
  await handle(U, 'ruhe 22-7');
  assert.match(await handle(U, 'briefing werktags 6:30'), /werktags um 06:30 Uhr[\s\S]*Ruhezeit[\s\S]*ort Wien/);
  const compose = (user, at) => handle.composeBriefing(user, at);

  clock.now = local(2026, 10, 24, 6, 30);
  await queueBriefings(db, compose, clock.now);
  assert.equal(alerts().length, 0);
  clock.now = local(2026, 10, 24, 7, 0);
  await queueBriefings(db, compose, clock.now);
  await queueBriefings(db, compose, clock.now);
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0], /Guten Morgen/);
  assert.equal(db.settings(U).briefing_next, local(2026, 10, 25, 6, 30));

  assert.match(await handle(U, 'briefing 7'), /täglich um 07:00 Uhr/);
  assert.match(await handle(U, 'briefing aus'), /aus/);
  assert.equal(db.settings(U).briefing_next, null);
  assert.match(await handle(U, 'briefing morgens'), /So geht es/);
});

test('the briefing still comes when the weather is down', async () => {
  const { handle, db } = withClock();
  await handle(U, 'ort Wien');
  const original = fakeWeather.forecast;
  fakeWeather.forecast = async () => createWeather({ fetch: async () => ({ ok: false }) }).forecast({ lat: 1, lon: 2 });
  try {
    assert.match(await handle(U, 'briefing'), /nicht abrufbar[\s\S]*Heute keine Erinnerungen/);
    assert.match(await handle(U, 'wetter'), /nicht abrufbar/);
  } finally {
    fakeWeather.forecast = original;
  }
  assert.ok(db.settings(U).lat);
});

test('Open-Meteo answers are read', async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(String(url));
    const body = String(url).includes('geocoding')
      ? { results: [{ name: 'Wien', country: 'Österreich', latitude: 48.2, longitude: 16.37 }] }
      : {
        current: { temperature_2m: 3.6, weather_code: 3 },
        daily: { weather_code: [95, 71], temperature_2m_min: [1.4, -0.6], temperature_2m_max: [8.5, 2], precipitation_probability_max: [20, 90] },
      };
    return { ok: true, json: async () => body };
  };
  const weather = createWeather({ fetch });
  const place = await weather.findPlace('Wien');
  assert.deepEqual(place, { place: 'Wien, Österreich', lat: 48.2, lon: 16.37 });
  const text = weatherText(place.place, await weather.forecast(place));
  assert.equal(text, '⛈️ *Wien heute:* 1 bis 9 °C, Gewitter, Regen 20 %\nJetzt 4 °C, bewölkt\n🌨️ *Morgen:* −1 bis 2 °C, leichter Schneefall, Regen 90 %');
  assert.match(urls[0], /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=Wien&/);
  assert.match(urls[1], /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=48\.2&longitude=16\.37&/);
});

test('reports can also come on workdays', () => {
  assert.deepEqual(parseReport('werktags 7'), { day: WORKDAYS, minute: 420 });
  // Friday evening: next is Monday.
  assert.equal(nextReport({ day: WORKDAYS, minute: 420 }, local(2026, 10, 27, 20, 0)), local(2026, 10, 30, 7, 0));
});

test('the welcome shows the everyday helper', async () => {
  const { handle } = withClock();
  assert.match(await handle(U, 'hallo'), /Alltagshelfer[\s\S]*erinnere mich/);
});
