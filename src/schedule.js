// Quiet hours and report times, always in the local time of the PC.
export const DAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
const DAY_MINUTES = 24 * 60;
export const DAILY = 7;
export const WORKDAYS = 8;
const DEFAULT_TIME = 8 * 60;

export function parseClock(input) {
  const match = input.trim().match(/^(\d{1,2})(?:[:.](\d\d))?(?:\s*uhr)?$/i);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes)) return null;
  return (hours % 24) * 60 + minutes;
}

export function clockText(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "22-7", "von 22:30 bis 7 Uhr" */
export function parseQuiet(input) {
  const parts = input.trim().replace(/^von\s+/i, '').replace(/[!]+$/, '').split(/\s*(?:[-–—]|\sbis\s)\s*/i);
  if (parts.length !== 2) return null;
  const [from, to] = parts.map(parseClock);
  return from == null || to == null || from === to ? null : { from, to };
}

export function isQuiet(settings, at) {
  const from = settings?.quiet_from;
  const to = settings?.quiet_to;
  if (from == null || to == null) return false;
  const date = new Date(at);
  const minute = date.getHours() * 60 + date.getMinutes();
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** "täglich 8", "werktags 7", "sonntag 18:30", "wöchentlich" (Monday) */
export function parseReport(input) {
  const [word, ...rest] = input.trim().toLowerCase().split(/\s+/);
  let day;
  if (word === 'täglich' || word === 'taeglich') day = DAILY;
  else if (word === 'werktags' || word === 'wochentags') day = WORKDAYS;
  else if (word === 'wöchentlich' || word === 'woechentlich') day = 1;
  else {
    day = DAYS.findIndex((name) => word === name || word === `${name}s`);
    if (day < 0) return null;
  }
  const time = rest.join(' ').replace(/^um\s+/, '');
  const minute = time ? parseClock(time) : DEFAULT_TIME;
  return minute == null ? null : { day, minute };
}

export function reportText({ day, minute }) {
  let when = `jeden ${capitalize(DAYS[day] ?? '')}`;
  if (day === DAILY) when = 'täglich';
  if (day === WORKDAYS) when = 'werktags';
  return `${when} um ${clockText(minute)} Uhr`;
}

/** The first matching time after `after`. Built from date parts, so it survives daylight saving. */
export function nextReport({ day, minute }, after) {
  const start = new Date(after);
  for (let offset = 0; offset <= 8; offset++) {
    const time = minute % DAY_MINUTES;
    const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, Math.floor(time / 60), time % 60);
    const weekday = next.getDay();
    const matches = day === DAILY || (day === WORKDAYS ? weekday >= 1 && weekday <= 5 : weekday === day);
    if (next.getTime() > after && matches) return next.getTime();
  }
  throw new Error(`No report time for day ${day}`);
}

export const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);
