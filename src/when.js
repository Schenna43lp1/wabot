// Times people write in reminders: "morgen 9", "in 30 min", "jeden Montag 8".
// Always in the local time of the PC.
import { capitalize, clockText, DAILY, DAYS, nextReport, parseClock, reportText, WORKDAYS } from './schedule.js';

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;
const DEFAULT_MINUTE = 9 * 60;
const NUMBERS = {
  ein: 1, eine: 1, einer: 1, einem: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6,
  sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12, zwanzig: 20, dreißig: 30, dreissig: 30,
};
const UNITS = {
  m: 'minute', min: 'minute', mins: 'minute', minute: 'minute', minuten: 'minute',
  h: 'hour', std: 'hour', stunde: 'hour', stunden: 'hour',
  tag: 'day', tage: 'day', tagen: 'day',
  woche: 'week', wochen: 'week',
};
// "heute abend", "morgen früh"
const DAY_PARTS = {
  früh: 8 * 60, frueh: 8 * 60, morgens: 8 * 60, vormittag: 10 * 60, vormittags: 10 * 60, mittag: 12 * 60, mittags: 12 * 60,
  nachmittag: 15 * 60, nachmittags: 15 * 60, abend: 19 * 60, abends: 19 * 60, nacht: 22 * 60, nachts: 22 * 60,
};
// Words between the time and the text: "morgen 9 an den Arzt"
const FILLER = /^(?:an|ans|daran|dass|das|zu|:|-|–)$/i;
const MAX_DAYS_AHEAD = 5 * 366;

const word = (token) => token?.toLowerCase().replace(/[,!?;:]+$/, '');
const bare = (token) => word(token)?.replace(/\.$/, '');
const weekday = (token) => DAYS.indexOf(bare(token));

function amountOf(token) {
  const text = word(token);
  if (!text) return null;
  if (NUMBERS[text]) return NUMBERS[text];
  if (/^\d{1,4}(?:[.,]\d)?$/.test(text)) return Number(text.replace(',', '.'));
  return null;
}

/** "9", "9:30", "9.30", "9uhr", followed by an optional "uhr". */
function readClock(tokens, i, { needsMark }) {
  let at = i;
  const marked = bare(tokens[at]) === 'um';
  if (marked) at++;
  const raw = word(tokens[at]);
  if (!raw) return null;
  const withUhr = raw.endsWith('uhr');
  const minute = parseClock(raw.replace(/uhr$/, ''));
  if (minute == null) return null;
  at++;
  let hasUhr = withUhr;
  if (bare(tokens[at]) === 'uhr') {
    hasUhr = true;
    at++;
  }
  // "3 Brote" is not a time. "um 3", "3 uhr" and "3:00" are.
  if (needsMark && !marked && !hasUhr && !/[:.]/.test(raw)) return null;
  return { minute, end: at };
}

/** A clock time or "abends". */
function readTimeOfDay(tokens, i, options) {
  const part = DAY_PARTS[bare(tokens[i])];
  if (part != null) return { minute: part, end: i + 1 };
  return readClock(tokens, i, options);
}

/** "24.12.", "24.12.2026", "am 24.12" */
function readDate(tokens, i, now) {
  let at = i;
  const marked = bare(tokens[at]) === 'am';
  if (marked) at++;
  const match = word(tokens[at])?.match(marked ? /^(\d{1,2})\.(\d{1,2})\.?(\d{2}|\d{4})?$/ : /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$/);
  if (!match) return null;
  const [, day, month, year] = match.map(Number);
  const today = new Date(now);
  let fullYear = year ? (year < 100 ? 2000 + year : year) : today.getFullYear();
  const date = () => new Date(fullYear, month - 1, day);
  if (date().getMonth() !== month - 1 || date().getDate() !== day) return null;
  if (!year && date() < new Date(today.getFullYear(), today.getMonth(), today.getDate())) fullYear++;
  return { date: date(), end: at + 1, explicit: true };
}

/** "heute", "morgen", "übermorgen", "(am) montag", a date. */
function readDay(tokens, i, now) {
  const today = new Date(now);
  const offset = (days) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const first = bare(tokens[i]);
  if (first === 'heute') return { date: offset(0), end: i + 1, explicit: true };
  if (first === 'morgen') return { date: offset(1), end: i + 1, explicit: true };
  if (first === 'übermorgen' || first === 'uebermorgen') return { date: offset(2), end: i + 1, explicit: true };

  const at = first === 'am' ? i + 1 : i;
  const day = weekday(tokens[at]);
  if (day >= 0) {
    // The next one, today included: the time decides whether it has passed.
    return { date: offset((day - today.getDay() + 7) % 7), end: at + 1, weekday: true };
  }
  return readDate(tokens, i, now);
}

const at = (date, minute) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minute / 60), minute % 60).getTime();

/** "in 30 min", "in einer halben stunde", "in 3 tagen um 9" */
function readRelative(tokens, i, now) {
  if (bare(tokens[i]) !== 'in') return null;
  let pos = i + 1;
  let amount;
  let unit;
  const compact = word(tokens[pos])?.match(/^(\d{1,4}(?:[.,]\d)?)(m|min|h|std)$/);
  if (compact) {
    amount = Number(compact[1].replace(',', '.'));
    unit = UNITS[compact[2]];
    pos++;
  } else {
    amount = amountOf(tokens[pos]);
    if (amount == null) return null;
    pos++;
    if (/^halbe[nr]?$/.test(bare(tokens[pos]) ?? '')) {
      amount /= 2;
      pos++;
    }
    unit = UNITS[bare(tokens[pos])];
    if (!unit) return null;
    pos++;
  }
  if (!(amount > 0)) return null;

  if (unit === 'minute' || unit === 'hour') {
    return { due: now + Math.round(amount * (unit === 'hour' ? 60 : 1)) * MINUTE, end: pos };
  }
  if (!Number.isInteger(amount)) return null;
  const today = new Date(now);
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + amount * (unit === 'week' ? 7 : 1));
  const time = readTimeOfDay(tokens, pos, { needsMark: false });
  const minute = time?.minute ?? today.getHours() * 60 + today.getMinutes();
  return { due: at(date, minute), end: time?.end ?? pos };
}

/** "täglich 8", "werktags", "jeden montag um 7", "montags", "monatlich am 1." */
function readRule(tokens, i, now) {
  let pos = i;
  let rule;
  const first = bare(tokens[pos]);
  const second = bare(tokens[pos + 1]);
  if (first === 'täglich' || first === 'taeglich') {
    rule = { day: DAILY };
    pos++;
  } else if (first === 'werktags' || first === 'wochentags') {
    rule = { day: WORKDAYS };
    pos++;
  } else if (first === 'wöchentlich' || first === 'woechentlich') {
    rule = { day: new Date(now).getDay() };
    pos++;
  } else if (/^jede[nr]?$/.test(first ?? '') && second === 'tag') {
    rule = { day: DAILY };
    pos += 2;
  } else if (/^jede[nr]?$/.test(first ?? '') && weekday(tokens[pos + 1]) >= 0) {
    rule = { day: weekday(tokens[pos + 1]) };
    pos += 2;
  } else if (first?.endsWith('s') && DAYS.includes(first.slice(0, -1))) {
    rule = { day: DAYS.indexOf(first.slice(0, -1)) };
    pos++;
  } else if (first === 'monatlich' || (/^jede[nr]?$/.test(first ?? '') && second === 'monat')) {
    pos += first === 'monatlich' ? 1 : 2;
    if (bare(tokens[pos]) === 'am') pos++;
    const day = word(tokens[pos])?.match(/^(\d{1,2})\.$/);
    rule = { monthDay: day ? Number(day[1]) : new Date(now).getDate() };
    if (day) pos++;
  } else if (/^jede[nr]?$/.test(first ?? '') && /^\d{1,2}\.$/.test(word(tokens[pos + 1]) ?? '')) {
    // "jeden 1." of the month
    rule = { monthDay: Number(word(tokens[pos + 1]).slice(0, -1)) };
    pos += 2;
  } else {
    return null;
  }
  if (rule.monthDay != null && (rule.monthDay < 1 || rule.monthDay > 31)) return null;
  const time = readTimeOfDay(tokens, pos, { needsMark: false });
  rule.minute = time?.minute ?? DEFAULT_MINUTE;
  return { rule, end: time?.end ?? pos };
}

/** Reads one time expression from tokens[i]. Returns { due | rule, end } or { error, end }. */
function readWhen(tokens, i, now) {
  const rule = readRule(tokens, i, now);
  if (rule) return rule;
  const relative = readRelative(tokens, i, now);
  if (relative) return relative;

  const day = readDay(tokens, i, now);
  if (day) {
    const time = readTimeOfDay(tokens, day.end, { needsMark: false });
    let due = at(day.date, time?.minute ?? DEFAULT_MINUTE);
    const end = time?.end ?? day.end;
    // "montag 8" on a Monday at 9 means next week.
    if (due <= now && day.weekday) due = at(new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate() + 7), time?.minute ?? DEFAULT_MINUTE);
    if (due <= now) return { error: 'Dieser Zeitpunkt ist schon vorbei.', end };
    return { due, end };
  }

  // "um 15 uhr", "abends", optionally followed by a day: "um 9 morgen"
  const time = readTimeOfDay(tokens, i, { needsMark: true });
  if (!time) return null;
  const after = readDay(tokens, time.end, now);
  if (after) {
    const due = at(after.date, time.minute);
    if (due <= now) return { error: 'Dieser Zeitpunkt ist schon vorbei.', end: after.end };
    return { due, end: after.end };
  }
  const today = new Date(now);
  let due = at(today, time.minute);
  if (due <= now) due = at(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1), time.minute);
  return { due, end: time.end };
}

function cleanText(tokens) {
  const words = [...tokens];
  while (words.length && FILLER.test(words[0])) words.shift();
  while (words.length && FILLER.test(words.at(-1))) words.pop();
  return words.join(' ').replace(/^[,:\s–-]+|[,:\s–-]+$/g, '').trim();
}

/**
 * "morgen 9 an Arzt", "Arzt morgen 9", "jeden Montag 8 Müll".
 * Returns { text, due } or { text, rule } or { error } or null when no time was found.
 */
export function parseReminder(input, now) {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (/^(mich|uns)$/i.test(tokens[0] ?? '')) tokens.shift();
  if (!tokens.length) return null;

  let found = readWhen(tokens, 0, now);
  let text;
  if (found && found.end < tokens.length) {
    text = cleanText(tokens.slice(found.end));
  } else {
    found = null;
    // The time at the end: "an den Arzt morgen 9". The longest ending that is a time wins.
    for (let i = 1; i < tokens.length && !found; i++) {
      const tail = readWhen(tokens, i, now);
      if (tail && tail.end === tokens.length) {
        found = tail;
        text = cleanText(tokens.slice(0, i));
      }
    }
  }
  if (!found) return null;
  if (found.error) return { error: found.error };
  if (!text) return null;
  if (found.due && found.due - now > MAX_DAYS_AHEAD * DAY_MINUTES * MINUTE) return { error: 'So weit im Voraus merke ich mir nichts.' };
  return found.rule ? { text, rule: found.rule } : { text, due: found.due };
}

/** "30 min", "morgen 9", "" (10 minutes). For "später". */
export function parseLater(input, now) {
  const text = input.trim();
  if (!text) return { due: now + 10 * MINUTE };
  const tokens = (/^\d/.test(text) || /^(eine?[nr]?|halbe)\b/i.test(text) ? `in ${text}` : text).split(/\s+/);
  const found = readWhen(tokens, 0, now);
  if (!found || found.end !== tokens.length || found.rule) return null;
  return found.error ? { error: found.error } : { due: found.due };
}

/** The first time of the rule after `after`. */
export function nextTime(rule, after) {
  if (rule.monthDay == null) return nextReport(rule, after);
  const start = new Date(after);
  for (let offset = 0; offset <= 12; offset++) {
    const last = new Date(start.getFullYear(), start.getMonth() + offset + 1, 0).getDate();
    const day = Math.min(rule.monthDay, last);
    const time = rule.minute % DAY_MINUTES;
    const next = new Date(start.getFullYear(), start.getMonth() + offset, day, Math.floor(time / 60), time % 60).getTime();
    if (next > after) return next;
  }
  throw new Error(`No time for rule ${JSON.stringify(rule)}`);
}

export function ruleText(rule) {
  if (rule.monthDay == null) return reportText(rule);
  return `monatlich am ${rule.monthDay}. um ${clockText(rule.minute)} Uhr`;
}

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "heute um 09:00 Uhr", "morgen um …", "am Mittwoch, 25.11. um …", "am 24.12.2027 um …" */
export function dueText(due, now) {
  const date = new Date(due);
  const days = Math.round((startOfDay(date) - startOfDay(new Date(now))) / 86_400_000);
  const clock = `um ${clockText(date.getHours() * 60 + date.getMinutes())} Uhr`;
  if (days === 0) return `heute ${clock}`;
  if (days === 1) return `morgen ${clock}`;
  if (days === 2) return `übermorgen ${clock}`;
  const short = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  if (days < 7) return `am ${capitalize(DAYS[date.getDay()])}, ${short} ${clock}`;
  if (date.getFullYear() === new Date(now).getFullYear()) return `am ${short} ${clock}`;
  return `am ${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${clock}`;
}

/** "09:00" today, otherwise "Mi 25.11. 09:00" */
export function shortTime(due, now) {
  const date = new Date(due);
  const clock = clockText(date.getHours() * 60 + date.getMinutes());
  if (startOfDay(date) === startOfDay(new Date(now))) return clock;
  const day = capitalize(DAYS[date.getDay()]).slice(0, 2);
  return `${day} ${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${clock}`;
}
