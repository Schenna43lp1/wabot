// Google and Outlook calendars through their secret iCal link: read only.
// "kalender https://…", "termine", "kalender erinnern 15"
import { UserError } from './errors.js';
import { occurrences, parseCalendar } from './ical.js';
import { capitalize, clockText, DAYS } from './schedule.js';
import { nextTime } from './when.js';

const CACHE_MS = 15 * 60_000;
const MAX_CALENDARS = 5;
const AGENDA_DAYS = 7;
const DAY_MS = 86_400_000;
const LINK = /(?:https?|webcals?):\/\/[^\s<>]+/i;
const ALONE = /^\s*(?:webcals?:\/\/\S+|https?:\/\/\S+\.ics(?:\?\S*)?|https?:\/\/calendar\.google\.com\/calendar\/ical\/\S+)\s*$/i;

/** A calendar link on its own, without "kalender" in front. */
export const isCalendarLink = (text) => ALONE.test(text);

/** "kalender https://…" or the link alone: a message that contains a secret link. */
export const connectsCalendar = (text) => ALONE.test(text) || /^\s*(?:kalender|calendar):?\s+(?:https?|webcals?):\/\//i.test(text);
const REMOVE = /^(weg|löschen|loeschen|entfernen|trennen)$/i;
const OFF = /^(aus|weg|kein|keine|stopp|stop)$/i;

const HOW_TO = `📅 *Kalender verbinden*
Schick mir den geheimen iCal-Link deines Kalenders:
\`kalender https://…\`

*Google:* calendar.google.com → ⚙️ Einstellungen → links deinen Kalender wählen → „Geheime Adresse im iCal-Format“ kopieren.
*Outlook:* outlook.com → ⚙️ Einstellungen → Kalender → Freigegebene Kalender → „Kalender veröffentlichen“ → Kalender und „Kann alle Details anzeigen“ wählen → Veröffentlichen → ICS-Link kopieren.

Ich kann deine Termine nur lesen, nicht ändern. Der Link bleibt auf dem PC.`;

const clock = (ms) => {
  const date = new Date(ms);
  return clockText(date.getHours() * 60 + date.getMinutes());
};
const startOfDay = (ms) => {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};
const addDays = (ms, days) => {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
};
/** "heute", "morgen", "übermorgen", "woche", "nächste woche", "wochenende" as days from today. */
export function agendaRange(text, at) {
  const word = text.trim().toLowerCase().replace(/[!?.]+$/, '').replace(/^(?:für |am |an |diese |dieses |die |das )/, '');
  const weekday = new Date(at).getDay();
  if (/^heute$/.test(word)) return { first: 0, days: 1, title: 'Heute' };
  if (/^morgen$/.test(word)) return { first: 1, days: 1, title: 'Morgen' };
  if (/^(?:übermorgen|uebermorgen)$/.test(word)) return { first: 2, days: 1, title: 'Übermorgen' };
  if (/^woche$/.test(word)) return { first: 0, days: AGENDA_DAYS, title: `Die nächsten ${AGENDA_DAYS} Tage` };
  if (/^(?:nächste|naechste|kommende) woche$/.test(word)) return { first: ((8 - weekday) % 7) || 7, days: 7, title: 'Nächste Woche' };
  if (/^wochenende$/.test(word)) {
    // On Sunday the weekend is today, from Monday on the coming one.
    if (weekday === 0) return { first: 0, days: 1, title: 'Wochenende' };
    return { first: 6 - weekday, days: 2, title: 'Wochenende' };
  }
  return null;
}

const short = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const clean = (text) => text.replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();

function defaultName(url) {
  const host = new URL(url.replace(/^webcals?:/i, 'https:')).hostname;
  if (/google/i.test(host)) return 'Google-Kalender';
  if (/outlook|office|live\.com|hotmail/i.test(host)) return 'Outlook-Kalender';
  return host.replace(/^www\./, '');
}

/** One line of an event on one day. */
function eventLine(event, dayStart, dayEnd) {
  if (event.line) return event.line;
  const where = event.location ? ` _(${short(clean(event.location.split('\n')[0]), 40)})_` : '';
  const title = clean(event.title);
  if (event.allDay || (event.start <= dayStart && event.end >= dayEnd)) return `🗓️ ${title}${where}`;
  const begins = event.start >= dayStart;
  const ends = event.end < dayEnd;
  let time = `bis ${clock(event.end)}`;
  if (begins) time = ends && event.end > event.start ? `${clock(event.start)}–${clock(event.end)}` : clock(event.start);
  return `${time} ${title}${where}`;
}

export function createCalendar({ db, fetchCalendar, birthdays, now = Date.now }) {
  const cache = new Map(); // url → { at, calendar }

  async function load(row, { fresh = false } = {}) {
    const cached = cache.get(row.url);
    if (cached && !fresh && now() - cached.at < CACHE_MS) return cached.calendar;
    try {
      const calendar = parseCalendar(await fetchCalendar(row.url));
      if (!calendar) throw new UserError('Unter diesem Link liegt kein Kalender. Kopiere die Adresse im iCal-Format (endet meist auf .ics).', 'invalid');
      cache.set(row.url, { at: now(), calendar });
      if (row.error) db.calendarError(row.id, null);
      return calendar;
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      if (row.id && row.error !== error.message) db.calendarError(row.id, error.message);
      // An older copy is better than nothing.
      if (cached && !fresh) return cached.calendar;
      throw error;
    }
  }

  /** Events of all the user's calendars that overlap [from, to). */
  async function events(user, from, to) {
    const found = [];
    const failed = [];
    for (const row of db.calendars(user)) {
      try {
        for (const event of occurrences(await load(row), from, to)) found.push({ ...event, calendar: row.name });
      } catch (error) {
        if (!(error instanceof UserError)) throw error;
        failed.push(row.name);
      }
    }
    return { events: found, failed };
  }

  /** Birthdays as all-day events. */
  function birthdayEvents(user, from, to) {
    return (birthdays?.between(user, startOfDay(from), to) ?? []).map(({ start, name, age }) => ({
      start, end: addDays(start, 1), allDay: true, line: `🎂 ${name}${age != null ? ` (${age})` : ''}`,
    }));
  }

  /** Reminders in [from, to), recurring ones with every time. */
  function reminders(user, from, to) {
    const found = [];
    for (const reminder of db.reminders(user)) {
      const rule = reminder.repeat ? JSON.parse(reminder.repeat) : null;
      for (let due = reminder.due, n = 0; due < to && n < 50; n++) {
        if (due >= from) found.push({ start: due, text: reminder.text });
        if (!rule) break;
        due = nextTime(rule, due);
      }
    }
    return found;
  }

  /** Lines for one day: all-day events, then everything by time. */
  function dayLines(dayStart, dayEnd, calendarEvents, dueReminders) {
    const items = [
      ...calendarEvents.filter((event) => event.start < dayEnd && (event.end > dayStart || (event.end === event.start && event.start >= dayStart)))
        .map((event) => ({ allDay: event.allDay || (event.start <= dayStart && event.end >= dayEnd), at: Math.max(event.start, dayStart), line: eventLine(event, dayStart, dayEnd) })),
      ...dueReminders.filter((reminder) => reminder.start >= dayStart && reminder.start < dayEnd)
        .map((reminder) => ({ allDay: false, at: reminder.start, line: `⏰ ${clock(reminder.start)} ${reminder.text}` })),
    ];
    return items.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.at - b.at).map((item) => item.line);
  }

  /** For the briefing: today from now on, with calendar events and reminders. */
  async function today(user, at) {
    const dayStart = startOfDay(at);
    const dayEnd = addDays(at, 1);
    const { events: found, failed } = await events(user, dayStart, dayEnd);
    // Events that are over are no news in the evening.
    const current = [...birthdayEvents(user, dayStart, dayEnd), ...found.filter((event) => event.allDay || event.end > at || event.start >= at)];
    return { lines: dayLines(dayStart, dayEnd, current, reminders(user, at, dayEnd)), failed, connected: db.calendars(user).length > 0 };
  }

  /** The next days, or only the days in range: { first, days, title } from agendaRange. */
  async function agenda(user, range = null) {
    const at = now();
    const first = range?.first ?? 0;
    const days = range?.days ?? AGENDA_DAYS;
    const calendars = db.calendars(user);
    const from = first ? addDays(at, first) : at;
    const end = addDays(at, first + days);
    const { events: fromCalendars, failed } = await events(user, from, end);
    const found = [...birthdayEvents(user, from, end), ...fromCalendars];
    const due = reminders(user, from, end);
    if (!calendars.length && !due.length && !found.length) {
      return range ? `📅 ${range.title}: keine Erinnerungen und Geburtstage.\n\n_Mit Kalender stehen hier auch deine Termine: \`kalender\`_` : HOW_TO;
    }

    // One day needs no heading above its own heading.
    const single = days === 1;
    const sections = single ? [] : [`📅 *${range?.title ?? `Die nächsten ${AGENDA_DAYS} Tage`}*`];
    for (let day = first; day < first + days; day++) {
      const dayStart = addDays(at, day);
      const dayEnd = addDays(at, day + 1);
      const lines = dayLines(dayStart, dayEnd, found, due);
      if (!lines.length) continue;
      const date = new Date(dayStart);
      const name = `${capitalize(DAYS[date.getDay()]).slice(0, 2)} ${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`;
      let title = name;
      if (day === 0) title = `Heute, ${name}`;
      if (day === 1) title = `Morgen, ${name}`;
      sections.push(`${single ? '📅 ' : ''}*${title}*\n${lines.join('\n')}`);
    }
    if (single && !sections.length) sections.push(`📅 *${range.title}*\nKeine Termine und Erinnerungen.`);
    else if (!single && sections.length === 1) sections.push('Keine Termine und Erinnerungen.');
    if (failed.length) sections.push(`⚠️ Nicht erreichbar: ${failed.join(', ')}`);
    sections.push(calendars.length
      ? `_Kalender: ${calendars.map((row) => `${row.nr}. ${row.name}`).join(', ')}_`
      : '_Kalender verbinden: `kalender` und dein iCal-Link_');
    return sections.join('\n\n');
  }

  async function connect(user, value) {
    const link = value.match(LINK)[0].replace(/[.,;)]+$/, '');
    const label = clean(value.replace(link, '')).slice(0, 40);
    const url = link.replace(/^webcals?:\/\//i, 'https://');
    if (db.calendarByUrl(user, url)) return 'Diesen Kalender hast du schon verbunden. Termine: `termine`';
    if (db.calendars(user).length >= MAX_CALENDARS) return `Du hast schon ${MAX_CALENDARS} Kalender verbunden. Trennen mit \`kalender weg\` und der Nummer.`;

    const calendar = await load({ url }, { fresh: true });
    const name = label || clean(calendar.name ?? '').slice(0, 40) || defaultName(url);
    const row = db.addCalendar(user, url, name);
    const at = now();
    const upcoming = occurrences(calendar, at, addDays(at, AGENDA_DAYS));
    const lines = [`✅ Kalender verbunden: *${row.name}*`, `${upcoming.length} ${upcoming.length === 1 ? 'Termin' : 'Termine'} in den nächsten ${AGENDA_DAYS} Tagen.`];
    const todayLines = dayLines(at, addDays(at, 1), upcoming, []);
    if (todayLines.length) lines.push('', '*Heute*', ...todayLines);
    lines.push(
      '',
      'Alle Termine: `termine`. Sie kommen auch ins `briefing`.',
      'Vor jedem Termin Bescheid geben: `kalender erinnern 15`',
      '',
      '🔒 Der Link ist geheim: Wer ihn hat, sieht deine Termine. Im Chat mit dir selbst lösche ich deine Nachricht mit dem Link, sonst lösch sie bitte selbst.',
    );
    return lines.join('\n');
  }

  function remove(user, value, quiet) {
    const nr = Number(value.match(/^#?(\d{1,3})[.!]?$/)?.[1]);
    const row = db.calendars(user).find((calendar) => calendar.nr === nr);
    if (!row) {
      if (quiet) return null;
      const list = db.calendars(user).map((calendar) => `\`kalender weg ${calendar.nr}\` ${calendar.name}`).join('\n');
      return list ? `Welchen Kalender?\n${list}` : 'Du hast keinen Kalender verbunden.';
    }
    db.removeCalendar(row.id);
    cache.delete(row.url);
    return `🗑️ Kalender getrennt: *${row.name}*\nDer Link funktioniert weiter. Willst du ihn ungültig machen, setze ihn in Google oder Outlook zurück.`;
  }

  function setAlert(user, value, quiet) {
    if (OFF.test(value)) {
      db.saveSettings(user, { calendar_alert: null });
      return '📅 Ich gebe vor Terminen nicht mehr Bescheid.';
    }
    const match = value.match(/^(\d{1,4})\s*(?:min(?:uten?)?\.?|m)?(?:\s+vorher)?$/i);
    const minutes = Number(match?.[1]);
    if (!match || minutes < 1 || minutes > 1440) {
      return quiet ? null : 'So geht es: `kalender erinnern 15` (Minuten vorher), ausschalten: `kalender erinnern aus`';
    }
    db.saveSettings(user, { calendar_alert: minutes });
    const lines = [`📅 Ich gebe ${minutes} Minuten vor jedem Termin Bescheid, ganztägige ausgenommen.`];
    if (!db.calendars(user).length) lines.push('Dafür brauche ich noch deinen Kalender: `kalender`');
    lines.push('_Das kommt auch in der Ruhezeit._');
    return lines.join('\n');
  }

  async function command(user, value, quiet) {
    const text = value.trim();
    if (!text) return agenda(user);
    if (LINK.test(text)) return connect(user, text);
    const [first, ...rest] = text.split(/\s+/);
    if (REMOVE.test(first)) return remove(user, rest.join(' '), quiet);
    if (/^(erinnern|erinnerung|vorher|warnen)$/i.test(first)) return setAlert(user, rest.join(' '), quiet);
    if (/^(hilfe|verbinden|einrichten)$/i.test(first)) return HOW_TO;
    // "termine morgen", "kalender nächste woche"
    const range = agendaRange(text, now());
    if (range) return agenda(user, range);
    return quiet ? null : `${HOW_TO}\n\nTrennen: \`kalender weg 1\` · vorher Bescheid: \`kalender erinnern 15\``;
  }

  /** Announces events shortly before they start, once each. */
  async function queueAlerts(at = now()) {
    for (const user of db.calendarUsers()) {
      const minutes = db.settings(user)?.calendar_alert;
      if (!minutes) continue;
      const { events: found } = await events(user, at, at + (minutes + 1) * 60_000);
      for (const event of found) {
        if (event.allDay || event.start < at || event.start - minutes * 60_000 > at) continue;
        if (!db.claimAlert(user, `${event.uid}|${event.start}`, at)) continue;
        const left = Math.max(1, Math.round((event.start - at) / 60_000));
        const until = event.end > event.start ? `–${clock(event.end)}` : '';
        const where = event.location ? `\n📍 ${short(clean(event.location), 80)}` : '';
        db.queue(user, `📅 *In ${left} Min.:* ${clean(event.title)}\n${clock(event.start)}${until} Uhr${where}`, { at, urgent: true });
      }
    }
    db.pruneAlerts(at - 2 * DAY_MS);
  }

  return { command, agenda, today, queueAlerts };
}
