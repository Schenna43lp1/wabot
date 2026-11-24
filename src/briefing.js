// "briefing täglich 7": every morning weather, appointments, reminders, to-dos and prices in one message.
import { UserError } from './errors.js';
import { priceChanges } from './report.js';
import { capitalize, clockText, DAILY, DAYS, isQuiet, nextReport, parseClock, parseReport, reportText } from './schedule.js';
import { todayText, weatherText } from './weather.js';

const OFF = /^(aus|weg|kein|keine|stopp|stop)$/i;
const SHOWN = 5;

export function createBriefing({ db, weather, calendar, birthdays, lists, now = Date.now }) {
  async function weatherLine(settings) {
    if (settings?.lat == null) return null;
    try {
      return todayText(settings.place, await weather.forecast(settings));
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      return `🌡️ ${error.message}`;
    }
  }

  /** The briefing itself. */
  async function compose(user, at) {
    const settings = db.settings(user);
    const date = new Date(at);
    const hour = date.getHours();
    let greeting = 'Guten Abend';
    if (hour < 11) greeting = 'Guten Morgen';
    else if (hour < 18) greeting = 'Hallo';
    const day = `${capitalize(DAYS[date.getDay()])}, ${date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}`;
    const sections = [`☀️ *${greeting}!* ${day}`];

    const forecast = await weatherLine(settings);
    if (forecast) sections.push(forecast);

    const today = await calendar.today(user, at);
    const nothing = today.connected ? 'Heute keine Termine und Erinnerungen.' : 'Heute keine Erinnerungen.';
    const agenda = [today.lines.length ? `📅 *Heute*\n${today.lines.join('\n')}` : `📅 ${nothing}`];
    if (today.failed.length) agenda.push(`⚠️ Kalender nicht erreichbar: ${today.failed.join(', ')}`);
    sections.push(agenda.join('\n'));

    // Today's birthdays are in the list above, the coming week's need a reminder now.
    const tomorrow = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const soon = birthdays.between(user, tomorrow, tomorrow + 7 * 86_400_000).map(({ start, name, age }) => {
      const when = new Date(start);
      return `${capitalize(DAYS[when.getDay()]).slice(0, 2)} ${when.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}: ${name}${age != null ? ` (${age})` : ''}`;
    });
    if (soon.length) sections.push(`🎁 *Bald Geburtstag*\n${soon.join('\n')}`);

    const todos = lists.items(user, 'todo');
    if (todos.length) {
      const lines = todos.slice(0, SHOWN).map((item) => `${item.nr}. ${item.text}`);
      if (todos.length > SHOWN) lines.push(`… und ${todos.length - SHOWN} weitere: \`todo\``);
      sections.push(`✅ *To-dos* (${todos.length})\n${lines.join('\n')}`);
    }
    const shopping = lists.items(user, 'shopping');
    if (shopping.length) {
      const names = shopping.slice(0, SHOWN).map((item) => item.text).join(', ');
      sections.push(`🛒 *Einkauf:* ${names}${shopping.length > SHOWN ? ` und ${shopping.length - SHOWN} mehr` : ''}`);
    }

    const { groups } = priceChanges(db, user, at, 1);
    const prices = [
      ...groups.reached.map((line) => `🎯 ${line}`),
      ...groups.cheaper.map((line) => `📉 ${line}`),
    ];
    if (prices.length) sections.push(`💶 *Preise, letzte 24 Stunden*\n${prices.join('\n')}`);

    if (settings?.lat == null) sections.push('_Mit Wetter: `ort` und deine Stadt, z. B. `ort Wien`_');
    return sections.join('\n\n');
  }

  async function briefing(user, value, quiet) {
    if (!value) return compose(user, now());
    if (OFF.test(value)) {
      db.saveSettings(user, { briefing_day: null, briefing_minute: null, briefing_next: null });
      return '☀️ Das tägliche Briefing ist aus.';
    }
    // "briefing 7" means every day at 7.
    const clock = parseClock(value.replace(/^um\s+/i, ''));
    const when = clock != null ? { day: DAILY, minute: clock } : parseReport(value);
    if (!when) {
      if (quiet) return null;
      return 'So geht es:\n`briefing 7` jeden Tag um 7\n`briefing werktags 6:30`\n`briefing aus`\n`briefing` jetzt sofort';
    }
    const next = nextReport(when, now());
    db.saveSettings(user, { briefing_day: when.day, briefing_minute: when.minute, briefing_next: next });

    const settings = db.settings(user);
    const lines = [`☀️ Das Briefing kommt ${reportText(when)}: Wetter, Termine, Erinnerungen, To-dos, Einkauf und Preise.`];
    if (isQuiet(settings, next)) lines.push(`Das liegt in deiner Ruhezeit, es kommt daher um ${clockText(settings.quiet_to)} Uhr.`);
    if (settings.lat == null) lines.push('Für das Wetter schick mir deinen Ort, z. B. `ort Wien`.');
    lines.push('Vorschau: `briefing`');
    return lines.join('\n');
  }

  async function lookUp(name, quiet) {
    // In the self-chat "Ort: Bahnhof 3. Gleis" is a note, and it must not leave the PC.
    if (quiet && name.split(/\s+/).length > 3) return null;
    if (name.length > 60 || /https?:\/\//i.test(name)) return null;
    return weather.findPlace(name);
  }

  async function place(user, value, quiet) {
    const settings = db.settings(user);
    if (!value) {
      if (settings?.lat == null) return quiet ? null : '📍 Noch kein Ort gespeichert. So geht es: `ort Wien`';
      return `📍 Dein Ort: *${settings.place}*\nÄndern: \`ort Graz\`, entfernen: \`ort aus\``;
    }
    if (OFF.test(value)) {
      db.saveSettings(user, { place: null, lat: null, lon: null });
      return '📍 Ort entfernt. Das Briefing kommt ohne Wetter.';
    }
    // "Ort: Café Central um 8" in the self-chat is a note and must not go to Open-Meteo.
    if (quiet && (/\d/.test(value) || value.trim().split(/\s+/).length > 3)) return null;
    const found = await lookUp(value, quiet);
    if (!found) return quiet ? null : `„${value.slice(0, 40)}“ habe ich nicht gefunden. Versuch es mit dem Namen der Stadt, z. B. \`ort München\`.`;
    db.saveSettings(user, { place: found.place, lat: found.lat, lon: found.lon });
    let current = '';
    try {
      current = `\n\n${weatherText(found.place, await weather.forecast(found))}`;
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
    }
    return `📍 Ort gespeichert: *${found.place}*\nDas Wetter kommt jetzt ins Briefing, oder jederzeit mit \`wetter\`.${current}`;
  }

  async function weatherNow(user, value, quiet) {
    let where = db.settings(user);
    const tomorrowFirst = /(?<!\p{L})morgen(?!\p{L})/iu.test(value);
    // "wetter morgen", "wetter in Graz": the forecast always covers today and tomorrow.
    value = value.trim().replace(/[!?.]+$/, '')
      .replace(/(?:^|\s+)(?:heute|morgen|jetzt|gerade|aktuell|am wochenende)(?=\s|$)/gi, '')
      .replace(/^(?:in|für|fuer)\s+/i, '').trim();
    if (value) {
      // "Wetter war schön" in the self-chat is a note and must not leave the PC.
      if (quiet) return null;
      where = await lookUp(value, quiet);
      if (!where) return quiet ? null : `„${value.slice(0, 40)}“ habe ich nicht gefunden.`;
    } else if (where?.lat == null) {
      return quiet ? null : 'Für welchen Ort? Speichere ihn einmal mit `ort Wien`, dann reicht `wetter`.\nOder einmalig: `wetter Graz`';
    }
    return weatherText(where.place, await weather.forecast(where), { tomorrowFirst });
  }

  return { compose, briefing, place, weather: weatherNow };
}

let running = false;

/** Like the price report: a briefing missed while the PC was off comes once. */
export async function queueBriefings(db, compose, now = Date.now()) {
  if (running) return;
  running = true;
  try {
    for (const settings of db.dueBriefings(now)) {
      if (isQuiet(settings, now)) continue;
      const { user, briefing_day: day, briefing_minute: minute } = settings;
      const text = await compose(user, now);
      db.transaction(() => {
        db.queue(user, text, { at: now });
        db.saveSettings(user, { briefing_next: nextReport({ day, minute }, now) });
      });
    }
  } finally {
    running = false;
  }
}
