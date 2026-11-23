// Set before the first Date: times are local.
process.env.TZ = 'Europe/Berlin';

import assert from 'node:assert/strict';
import test from 'node:test';
import { UserError } from '../src/errors.js';
import { connectsCalendar } from '../src/calendar.js';
import { fetchCalendar } from '../src/fetch-page.js';
import { occurrences, parseCalendar } from '../src/ical.js';
import { setup } from './helpers.js';

const U = '491701234567';
const OTHER = '491709999999';
const GOOGLE = 'https://calendar.google.com/calendar/ical/secret/basic.ics';
const OUTLOOK = 'https://outlook.office365.com/owa/calendar/abc/def/calendar.ics';
const local = (...parts) => new Date(...parts).getTime();
const DAY = 86_400_000;
// Monday, 23 November 2026
const MONDAY = local(2026, 10, 23);

const ics = (...events) => ['BEGIN:VCALENDAR', 'X-WR-CALNAME:Privat', ...events.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const list = (text, from = MONDAY, days = 7) => occurrences(parseCalendar(text), from, from + days * DAY)
  .map((event) => `${new Date(event.start).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} ${event.title}${event.allDay ? ' (ganztägig)' : ''}`);

// Reading .ics
test('time zones: IANA, Windows names from Outlook, UTC and floating times', () => {
  const text = ics(
    ['UID:a', 'DTSTART;TZID=Europe/Berlin:20261123T100000', 'SUMMARY:Berlin'],
    ['UID:b', 'DTSTART;TZID=W. Europe Standard Time:20261123T110000', 'SUMMARY:Outlook'],
    ['UID:c', 'DTSTART;TZID="(UTC+01:00) Amsterdam, Berlin, Bern, Rom, Stockholm, Wien":20261123T120000', 'SUMMARY:Outlook lang'],
    ['UID:d', 'DTSTART:20261123T120000Z', 'SUMMARY:UTC'],
    ['UID:e', 'DTSTART;TZID=America/New_York:20261123T080000', 'SUMMARY:New York'],
    ['UID:f', 'DTSTART:20261123T150000', 'SUMMARY:Floating'],
  );
  assert.deepEqual(list(text, MONDAY, 1), [
    'Mo., 23.11., 10:00 Berlin', 'Mo., 23.11., 11:00 Outlook', 'Mo., 23.11., 12:00 Outlook lang',
    'Mo., 23.11., 13:00 UTC', 'Mo., 23.11., 14:00 New York', 'Mo., 23.11., 15:00 Floating',
  ]);
});

test('text is unescaped, folded lines are joined, alarms are ignored', () => {
  const calendar = parseCalendar(ics([
    'UID:a', 'DTSTART:20261123T100000Z', 'SUMMARY:Team\\, Daily\\; mit Kaffee', 'LOCATION:Raum 3\\nHaus B',
    'DESCRIPTION:lang', ' er Text', 'BEGIN:VALARM', 'SUMMARY:Alarm', 'END:VALARM',
  ]));
  assert.equal(calendar.name, 'Privat');
  assert.equal(calendar.events[0].title, 'Team, Daily; mit Kaffee');
  assert.equal(calendar.events[0].location, 'Raum 3\nHaus B');
  assert.equal(parseCalendar('<html>Login</html>'), null);
});

test('all-day events span their days, the end is exclusive', () => {
  const text = ics(['UID:a', 'DTSTART;VALUE=DATE:20261127', 'DTEND;VALUE=DATE:20261130', 'SUMMARY:Urlaub']);
  const [event] = occurrences(parseCalendar(text), MONDAY, MONDAY + 7 * DAY);
  assert.equal(event.start, local(2026, 10, 27));
  assert.equal(event.end, local(2026, 10, 30));
  assert.equal(occurrences(parseCalendar(text), local(2026, 10, 30), local(2026, 11, 1)).length, 0);
});

test('weekly series with exceptions: skipped, moved and cancelled dates', () => {
  const text = ics(
    ['UID:w', 'DTSTART;TZID=Europe/Berlin:20260105T100000', 'DTEND;TZID=Europe/Berlin:20260105T110000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', 'EXDATE;TZID=Europe/Berlin:20261125T100000', 'SUMMARY:Team'],
    ['UID:w', 'RECURRENCE-ID;TZID=Europe/Berlin:20261123T100000', 'DTSTART;TZID=Europe/Berlin:20261123T150000', 'SUMMARY:Team (verschoben)'],
    ['UID:w', 'RECURRENCE-ID;TZID=Europe/Berlin:20261127T100000', 'DTSTART;TZID=Europe/Berlin:20261127T100000', 'STATUS:CANCELLED', 'SUMMARY:Team'],
  );
  assert.deepEqual(list(text), ['Mo., 23.11., 15:00 Team (verschoben)']);
  assert.deepEqual(list(text, local(2026, 10, 30), 3), ['Mo., 30.11., 10:00 Team', 'Mi., 02.12., 10:00 Team']);
});

test('series keep their local time across daylight saving', () => {
  const text = ics(['UID:a', 'DTSTART;TZID=Europe/Berlin:20260901T090000', 'RRULE:FREQ=WEEKLY;INTERVAL=2', 'SUMMARY:Alle 2 Wochen']);
  assert.deepEqual(list(text, local(2026, 9, 20), 22), ['Di., 27.10., 09:00 Alle 2 Wochen', 'Di., 10.11., 09:00 Alle 2 Wochen']);
});

test('series end by count or until, also with UNTIL in UTC', () => {
  const text = ics(
    ['UID:a', 'DTSTART;TZID=Europe/Berlin:20261120T070000', 'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:Fünfmal'],
    ['UID:b', 'DTSTART;TZID=Europe/Berlin:20260101T090000', 'RRULE:FREQ=DAILY;UNTIL=20261124T080000Z', 'SUMMARY:Bis Dienstag'],
    ['UID:c', 'DTSTART;VALUE=DATE:20261101', 'RRULE:FREQ=DAILY;UNTIL=20261123', 'SUMMARY:Ganztägig bis Montag'],
  );
  assert.deepEqual(list(text), [
    'Mo., 23.11., 00:00 Ganztägig bis Montag (ganztägig)',
    'Mo., 23.11., 07:00 Fünfmal', 'Mo., 23.11., 09:00 Bis Dienstag', 'Di., 24.11., 07:00 Fünfmal', 'Di., 24.11., 09:00 Bis Dienstag',
  ]);
});

test('monthly and yearly series', () => {
  const text = ics(
    ['UID:a', 'DTSTART;TZID=Europe/Berlin:20260130T180000', 'DURATION:PT2H', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR', 'SUMMARY:Stammtisch'],
    ['UID:b', 'DTSTART;TZID=Europe/Berlin:20260131T090000', 'RRULE:FREQ=MONTHLY', 'SUMMARY:Am 31.'],
    ['UID:c', 'DTSTART;TZID=Europe/Berlin:20260115T090000', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1', 'SUMMARY:Monatsende'],
    ['UID:d', 'DTSTART;VALUE=DATE:19900228', 'RRULE:FREQ=YEARLY', 'SUMMARY:Geburtstag'],
    ['UID:e', 'DTSTART;TZID=Europe/Berlin:20260105T100000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'SUMMARY:Zweiter Dienstag'],
  );
  assert.deepEqual(list(text, local(2027, 1, 1), 28), [
    'So., 28.02., 00:00 Geburtstag (ganztägig)',
    'Di., 09.02., 10:00 Zweiter Dienstag', 'Fr., 26.02., 18:00 Stammtisch', 'So., 28.02., 09:00 Monatsende',
  ]);
  // A month with a 31st
  assert.ok(list(text, local(2027, 2, 31), 1).includes('Mi., 31.03., 09:00 Am 31.'));
});

test('an old daily series is fast to read', () => {
  const text = ics(['UID:a', 'DTSTART;TZID=Europe/Berlin:20000101T080000', 'RRULE:FREQ=DAILY', 'SUMMARY:Täglich']);
  const started = performance.now();
  assert.equal(list(text).length, 7);
  assert.ok(performance.now() - started < 200);
});

// Commands
function withClock(start = local(2026, 10, 23, 8, 0)) {
  const clock = { now: start };
  const t = setup({}, { now: () => clock.now });
  return { ...t, clock };
}

test('without a calendar "kalender" explains how to connect it', async () => {
  const { handle } = withClock();
  for (const text of ['kalender', 'termine']) assert.match(await handle(U, text), /Google:\*[\s\S]*Geheime Adresse im iCal-Format[\s\S]*Outlook:\*/);
});

test('connect, show, warn about the secret link, and disconnect', async () => {
  const { handle, db, state } = withClock();
  const reply = await handle(U, `Kalender ${GOOGLE}`);
  assert.match(reply, /Kalender verbunden: \*Privat\*\n7 Termine in den nächsten 7 Tagen/);
  assert.match(reply, /\*Heute\*\n10:00–10:30 Standup _\(Büro\)_/);
  assert.match(reply, /lösche ich deine Nachricht mit dem Link, sonst lösch sie bitte selbst/);
  assert.equal(db.products(U).length, 0);
  assert.match(await handle(U, `kalender ${GOOGLE}`), /schon verbunden/);

  await handle(U, 'erinnere mich morgen 18 an Sport');
  const agenda = await handle(U, 'termine');
  assert.match(agenda, /\*Heute, Mo 23\.11\.\*\n10:00–10:30 Standup/);
  assert.match(agenda, /\*Morgen, Di 24\.11\.\*\n10:00–10:30 Standup _\(Büro\)_\n⏰ 18:00 Sport/);
  assert.match(agenda, /_Kalender: 1\. Privat_/);
  assert.match(await handle(OTHER, 'termine'), /Kalender verbinden/);

  // Cached for 15 minutes
  const fetches = state.calendarFetches.length;
  await handle(U, 'termine');
  assert.equal(state.calendarFetches.length, fetches);

  assert.match(await handle(U, 'kalender weg 2'), /Welchen Kalender\?\n`kalender weg 1` Privat/);
  assert.match(await handle(U, 'kalender weg 1'), /getrennt: \*Privat\*/);
  assert.equal(db.calendars(U).length, 0);
});

test('a name, webcal links and Outlook', async () => {
  const { handle, db, state } = withClock();
  state.calendars[OUTLOOK] = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
  assert.match(await handle(U, `kalender ${OUTLOOK.replace('https', 'webcal')} Arbeit`), /verbunden: \*Arbeit\*\n0 Termine/);
  assert.equal(db.calendars(U)[0].url, OUTLOOK);
  delete state.calendars[GOOGLE];
  state.calendars[GOOGLE] = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
  assert.match(await handle(U, `kalender ${GOOGLE}`), /verbunden: \*Google-Kalender\*/);
});

test('a calendar link alone connects the calendar instead of watching a price', async () => {
  const { handle, db } = withClock();
  assert.match(await handle(U, GOOGLE), /Kalender verbunden/);
  assert.match(await handle(U, 'webcal://example.com/weg.ics'), /HTTP 404/);
  assert.equal(db.products(U).length, 0);
  // A shop link still is a product.
  assert.match(await handle(U, 'https://shop.de/kalender-2027'), /beobachtet/);
});

test('wrong links are not saved', async () => {
  const { handle, db, state } = withClock();
  state.calendars['https://calendar.google.com/calendar/u/0/r'] = '<html>Google Kalender</html>';
  assert.match(await handle(U, 'kalender https://calendar.google.com/calendar/u/0/r'), /kein Kalender/);
  assert.match(await handle(U, 'kalender https://example.com/weg.ics'), /HTTP 404/);
  assert.equal(db.calendars(U).length, 0);
});

test('a calendar that fails later keeps the last copy, then says so', async () => {
  const { handle, db, state, clock } = withClock();
  await handle(U, `kalender ${GOOGLE}`);
  state.calendars[GOOGLE] = new UserError('Der Kalender ist gerade nicht erreichbar (HTTP 503).', 'temporary');
  clock.now += 20 * 60_000;
  assert.match(await handle(U, 'termine'), /Standup/);
  assert.match(db.calendars(U)[0].error, /503/);

  // After a restart there is no copy.
  const restarted = withClock();
  restarted.db.addCalendar(U, GOOGLE, 'Privat');
  restarted.state.calendars[GOOGLE] = new UserError('Der Kalender antwortet gerade nicht.', 'temporary');
  assert.match(await restarted.handle(U, 'termine'), /Nicht erreichbar: Privat/);
});

test('the briefing lists today, without what is already over', async () => {
  const { handle, clock } = withClock(local(2026, 10, 24, 7, 0));
  await handle(U, `kalender ${GOOGLE}`);
  await handle(U, 'erinnere mich heute 18 an Sport');
  assert.match(await handle(U, 'briefing'), /📅 \*Heute\*\n10:00–10:30 Standup _\(Büro\)_\n⏰ 18:00 Sport/);
  clock.now = local(2026, 10, 24, 12, 0);
  const noon = await handle(U, 'briefing');
  assert.match(noon, /📅 \*Heute\*\n⏰ 18:00 Sport/);
  assert.doesNotMatch(noon, /Standup/);
  clock.now = local(2026, 10, 24, 19, 0);
  assert.match(await handle(U, 'briefing'), /Heute keine Termine und Erinnerungen/);
});

test('alerts before events come once, not for all-day events', async () => {
  const { handle, db, clock, state, alerts } = withClock(local(2026, 10, 23, 9, 0));
  state.calendars[GOOGLE] = ics(
    ['UID:a', 'DTSTART;TZID=Europe/Berlin:20261123T100000', 'DTEND;TZID=Europe/Berlin:20261123T110000', 'SUMMARY:Arzt', 'LOCATION:Praxis Dr. Müller'],
    ['UID:b', 'DTSTART;VALUE=DATE:20261123', 'SUMMARY:Feiertag'],
  );
  await handle(U, `kalender ${GOOGLE}`);
  assert.match(await handle(U, 'kalender erinnern 15'), /15 Minuten vor jedem Termin/);
  assert.match(await handle(U, 'kalender erinnern bald'), /So geht es/);

  const run = handle.queueCalendarAlerts;
  clock.now = local(2026, 10, 23, 9, 44);
  await run(clock.now);
  assert.equal(alerts().length, 0);
  clock.now = local(2026, 10, 23, 9, 45);
  await run(clock.now);
  await run(clock.now + 60_000);
  assert.deepEqual(alerts(), ['📅 *In 15 Min.:* Arzt\n10:00–11:00 Uhr\n📍 Praxis Dr. Müller']);
  assert.equal(db.queued()[0].urgent, 1);

  // Not after it started.
  clock.now = local(2026, 10, 23, 10, 5);
  await run(clock.now);
  assert.equal(alerts().length, 1);
  assert.match(await handle(U, 'kalender erinnern aus'), /nicht mehr/);
});

test('in the self-chat only clear calendar commands answer', async () => {
  const { handle } = withClock();
  assert.equal(await handle(U, 'Kalender aufräumen', { quiet: true }), null);
  assert.equal(await handle(U, 'kalender weg', { quiet: true }), null);
});

test('calendar links into the home network are refused', async () => {
  await assert.rejects(fetchCalendar('https://192.168.1.10/kalender.ics'), /lokalen Netzwerk/);
  await assert.rejects(fetchCalendar('webcal://127.0.0.1/kalender.ics'), /lokalen Netzwerk/);
  await assert.rejects(fetchCalendar('file:///C:/kalender.ics'), /http/);
});

test('calendar links must be encrypted', async () => {
  await assert.rejects(fetchCalendar('http://calendar.example.com/secret.ics'), /https:\/\/[\s\S]*unverschlüsselt/);
  assert.ok(connectsCalendar('kalender https://calendar.google.com/calendar/ical/x/basic.ics'));
  assert.ok(connectsCalendar('Kalender: webcal://example.com/x.ics Arbeit'));
  assert.ok(connectsCalendar('https://outlook.office365.com/owa/calendar/a/b/calendar.ics'));
  assert.ok(!connectsCalendar('notiz https://example.com/x.ics'));
  assert.ok(!connectsCalendar('kalender weg 1'));
});
