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
// Only for amounts: "in anderthalb Stunden"
const FRACTIONS = { anderthalb: 1.5, eineinhalb: 1.5, zweieinhalb: 2.5, dreieinhalb: 3.5 };
const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const UNITS = {
  m: 'minute', min: 'minute', mins: 'minute', minute: 'minute', minuten: 'minute',
  h: 'hour', std: 'hour', stunde: 'hour', stunden: 'hour',
  tag: 'day', tage: 'day', tagen: 'day',
  woche: 'week', wochen: 'week',
  monat: 'month', monate: 'month', monaten: 'month',
};
// Only after "am", "jeden" or "nächsten": "so" and "do" are ordinary words too.
const SHORT_DAYS = { so: 0, mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6 };
// "heute abend", "morgen früh"
const DAY_PARTS = {
  früh: 8 * 60, frueh: 8 * 60, morgens: 8 * 60, vormittag: 10 * 60, vormittags: 10 * 60, mittag: 12 * 60, mittags: 12 * 60,
  nachmittag: 15 * 60, nachmittags: 15 * 60, abend: 19 * 60, abends: 19 * 60, nacht: 22 * 60, nachts: 22 * 60,
};
// Words between the time and the text: "morgen 9 an den Arzt", "daran, dass …"
const FILLER = /^(?:an|ans|daran|dran|dass|das|zu|:|-|–)$/i;
// Spoken requests: "erinnere mich bitte morgen", "erinner mich doch mal …"
const SOFTENER = /^(?:bitte|doch|mal|noch|einfach)$/i;
// Separable verbs in a "zu" clause: "anzurufen" → "anrufen"
const ZU_VERB = /^(ab|an|auf|aus|bei|ein|fest|her|hin|los|mit|nach|vor|weg|zurück|zusammen|um|rein|raus|rüber|runter|hoch|weiter|heim|durch|sauber|frei)zu(\p{L}{2,}en)$/iu;
const MODAL = /^(?:muss|musst|soll|sollte|will|möchte|wollte|darf|kann|werde)$/i;
const MAX_DAYS_AHEAD = 5 * 366;
// Nobody means "um 3" at night: before 8 a time without a day may be the afternoon.
const EARLY = 8 * 60;

const word = (token) => token?.toLowerCase().replace(/[,!?;:]+$/, '');
const bare = (token) => word(token)?.replace(/\.$/, '');
const weekday = (token) => DAYS.indexOf(bare(token));
const markedWeekday = (token) => (weekday(token) >= 0 ? weekday(token) : (SHORT_DAYS[bare(token)] ?? -1));
const isEvery = (token) => /^jede[nrs]?$/.test(bare(token) ?? '');
const isNext = (token) => /^(nächste[nr]?|naechste[nr]?|kommende[nr]?)$/.test(bare(token) ?? '');

function amountOf(token) {
  const text = word(token);
  if (!text) return null;
  if (NUMBERS[text]) return NUMBERS[text];
  if (FRACTIONS[text]) return FRACTIONS[text];
  if (/^\d{1,4}(?:[.,]\d)?$/.test(text)) return Number(text.replace(',', '.'));
  return null;
}

function hourOf(token) {
  const text = bare(token);
  if (/^\d{1,2}$/.test(text ?? '')) return Number(text);
  if (text === 'eins') return 1;
  return NUMBERS[text] ?? null;
}

/** "halb 8" is 7:30, "viertel nach 8" 8:15, "viertel vor 8" and "dreiviertel 8" 7:45. */
function readSpoken(tokens, i) {
  const first = bare(tokens[i]);
  let offset;
  let pos = i + 1;
  if (first === 'halb') offset = -30;
  else if (first === 'dreiviertel') offset = -15;
  else if (first === 'viertel' && ['nach', 'vor'].includes(bare(tokens[pos]))) {
    offset = bare(tokens[pos]) === 'nach' ? 15 : -15;
    pos++;
  } else return null;
  const hour = hourOf(tokens[pos]);
  if (hour == null || hour < 1 || hour > 24) return null;
  pos++;
  if (bare(tokens[pos]) === 'uhr') pos++;
  const minute = (hour * 60 + offset + DAY_MINUTES) % DAY_MINUTES;
  return { minute, end: pos, ambiguous: minute >= 60 && minute < EARLY };
}

/** "9", "9:30", "9.30", "9uhr", "9h", "halb 8", followed by an optional "uhr". */
function readClock(tokens, i, { needsMark }) {
  let at = i;
  const marked = bare(tokens[at]) === 'um';
  if (marked) at++;
  const spoken = readSpoken(tokens, at);
  if (spoken) return spoken;
  const raw = word(tokens[at]);
  if (!raw) return null;
  const withUhr = /\d(uhr|h)$/.test(raw);
  const minute = parseClock(raw.replace(/(uhr|h)$/, ''));
  if (minute == null) return null;
  at++;
  let hasUhr = withUhr;
  if (bare(tokens[at]) === 'uhr') {
    hasUhr = true;
    at++;
  }
  // "9 Uhr 30", as people say it
  let total = minute;
  const minutes = hasUhr && minute % 60 === 0 ? bare(tokens[at])?.match(/^\d{1,2}$/) : null;
  if (minutes && Number(minutes[0]) < 60) {
    total += Number(minutes[0]);
    at++;
  }
  // "3 Brote" is not a time. "um 3", "3 uhr" and "3:00" are.
  if (needsMark && !marked && !hasUhr && !/[:.]/.test(raw)) return null;
  // "um 3" in the afternoon means 15:00.
  return { minute: total, end: at, ambiguous: total >= 60 && total < EARLY };
}

/** "8" with "abends" is 20:00, with "morgens" 8:00, "11 nachts" is 23:00 and "2 nachts" 2:00. */
function inPart(minute, part) {
  if (minute >= 12 * 60) return minute;
  const later = minute + 12 * 60;
  if (part === DAY_PARTS.nacht) return minute >= 6 * 60 ? later : minute;
  if (part === DAY_PARTS.mittag) return minute < 3 * 60 ? later : minute;
  return part >= DAY_PARTS.nachmittag ? later : minute;
}

/** A clock time or "abends", or both: "abends um 8", "um 8 Uhr abends". */
function readTimeOfDay(tokens, i, options) {
  const part = DAY_PARTS[bare(tokens[i])];
  if (part != null) {
    const clock = readClock(tokens, i + 1, { needsMark: true });
    if (clock) return { minute: inPart(clock.minute, part), end: clock.end };
    return { minute: part, end: i + 1 };
  }
  const clock = readClock(tokens, i, options);
  const after = clock && DAY_PARTS[bare(tokens[clock.end])];
  if (after != null) return { minute: inPart(clock.minute, after), end: clock.end + 1 };
  return clock;
}

/** "dezember", "dez", "dez." */
function monthOf(token) {
  const text = bare(token)?.replace('maerz', 'märz');
  if (!text || text.length < 3) return -1;
  return MONTHS.findIndex((month) => month === text || (text.length <= 4 && month.startsWith(text)));
}

/** "24.12.", "24.12.2026", "am 24.12", "24. Dezember", "am 24 Dez 2027" */
function readDate(tokens, i, now) {
  let at = i;
  const marked = bare(tokens[at]) === 'am';
  if (marked) at++;
  let day;
  let month;
  let year;
  const match = word(tokens[at])?.match(marked ? /^(\d{1,2})\.(\d{1,2})\.?(\d{2}|\d{4})?$/ : /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$/);
  if (match) [, day, month, year] = match.map(Number);
  else {
    const named = word(tokens[at])?.match(marked ? /^(\d{1,2})\.?$/ : /^(\d{1,2})\.$/);
    const index = named ? monthOf(tokens[at + 1]) : -1;
    if (index < 0) return null;
    [day, month] = [Number(named[1]), index + 1];
    at++;
    const written = bare(tokens[at + 1])?.match(/^\d{4}$/);
    if (written) {
      year = Number(written[0]);
      at++;
    }
  }
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
  if (first === 'heute') return { date: offset(0), end: i + 1, today: true };
  if (first === 'morgen') return { date: offset(1), end: i + 1 };
  if (first === 'übermorgen' || first === 'uebermorgen') return { date: offset(2), end: i + 1 };

  const until = (day) => (day - today.getDay() + 7) % 7;
  // "nächsten Montag" is never today, "nächste Woche" is the coming Monday.
  if (isNext(tokens[i])) {
    if (bare(tokens[i + 1]) === 'woche') return { date: offset(until(1) || 7), end: i + 2 };
    const day = markedWeekday(tokens[i + 1]);
    return day >= 0 ? { date: offset(until(day) || 7), end: i + 2 } : null;
  }
  const marked = first === 'am';
  const at = marked ? i + 1 : i;
  if (bare(tokens[at]) === 'wochenende') return { date: offset(until(6)), end: at + 1, weekday: true };
  const day = marked ? markedWeekday(tokens[at]) : weekday(tokens[at]);
  if (day >= 0) {
    // The next one, today included: the time decides whether it has passed.
    return { date: offset(until(day)), end: at + 1, weekday: true };
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
    // "einer halben Stunde", "einer viertel Stunde", "einer Viertelstunde"
    const part = { halbe: 1 / 2, halben: 1 / 2, halber: 1 / 2, viertel: 1 / 4, dreiviertel: 3 / 4 }[bare(tokens[pos])];
    if (part) {
      amount *= part;
      pos++;
    }
    const quarters = bare(tokens[pos])?.match(/^(drei)?viertelstunden?$/);
    if (quarters) {
      amount *= quarters[1] ? 45 : 15;
      unit = 'minute';
    } else unit = UNITS[bare(tokens[pos])];
    if (!unit) return null;
    pos++;
  }
  if (!(amount > 0)) return null;

  if (unit === 'minute' || unit === 'hour') {
    return { due: now + Math.round(amount * (unit === 'hour' ? 60 : 1)) * MINUTE, end: pos };
  }
  if (!Number.isInteger(amount)) return null;
  const today = new Date(now);
  const date = unit === 'month'
    ? addMonths(today, amount)
    : new Date(today.getFullYear(), today.getMonth(), today.getDate() + amount * (unit === 'week' ? 7 : 1));
  const time = readTimeOfDay(tokens, pos, { needsMark: false });
  const minute = time?.minute ?? today.getHours() * 60 + today.getMinutes();
  return { due: at(date, minute), end: time?.end ?? pos };
}

/** "31. Januar + 1 Monat" is the last day of February, not 3 March. */
function addMonths(date, months) {
  const last = new Date(date.getFullYear(), date.getMonth() + months + 1, 0).getDate();
  return new Date(date.getFullYear(), date.getMonth() + months, Math.min(date.getDate(), last));
}

const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function fromKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** "alle 2 wochen am montag 7", "alle 3 tage", "alle 14 tage" */
function readInterval(tokens, i, now) {
  if (bare(tokens[i]) !== 'alle') return null;
  const amount = amountOf(tokens[i + 1]);
  const unit = UNITS[bare(tokens[i + 2])];
  if (!Number.isInteger(amount) || amount < 1 || amount > 52 || (unit !== 'day' && unit !== 'week')) return null;
  let pos = i + 3;
  const today = new Date(now);
  let start = today;
  const marked = bare(tokens[pos]) === 'am';
  if (marked) pos++;
  let day = markedWeekday(tokens[pos]);
  if (day < 0 && bare(tokens[pos])?.endsWith('s')) day = DAYS.indexOf(bare(tokens[pos]).slice(0, -1));
  if (day >= 0) {
    start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((day - today.getDay() + 7) % 7));
    pos++;
  } else if (marked) return null;
  const time = readTimeOfDay(tokens, pos, { needsMark: false });
  const rule = { every: amount * (unit === 'week' ? 7 : 1), from: dateKey(start), minute: time?.minute ?? DEFAULT_MINUTE };
  return { rule, end: time?.end ?? pos };
}

/** "täglich 8", "werktags", "jeden montag um 7", "montags", "monatlich am 1." */
function readRule(tokens, i, now) {
  const interval = readInterval(tokens, i, now);
  if (interval) return interval;
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
  } else if (isEvery(tokens[pos]) && markedWeekday(tokens[pos + 1]) >= 0) {
    rule = { day: markedWeekday(tokens[pos + 1]) };
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
    // "heute halb 8" at noon means the evening.
    if (day.today && time?.ambiguous && due <= now) due = at(day.date, time.minute + 12 * 60);
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
  if (due <= now && time.ambiguous && at(today, time.minute + 12 * 60) > now) due = at(today, time.minute + 12 * 60);
  if (due <= now) due = at(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1), time.minute);
  return { due, end: time.end };
}

/**
 * The reminder without the words around it. A clause, as in "daran, die Wäsche aufzuhängen"
 * or "morgen, dass ich Anna anrufen muss", becomes "die Wäsche aufhängen" and "Anna anrufen".
 */
function cleanText(tokens, { clause = false } = {}) {
  const words = [...tokens];
  const filler = (token) => FILLER.test(token.replace(/,$/, ''));
  if (/^(?:daran|dran|dass),?$/i.test(words[0] ?? '')) clause = true;
  while (words.length && filler(words[0])) words.shift();
  while (words.length && filler(words.at(-1))) words.pop();
  if (clause && words.length > 1) {
    if (/^(?:ich|wir)$/i.test(words[0])) {
      words.shift();
      if (words.length > 1 && MODAL.test(words.at(-1))) words.pop();
    }
    const verb = words.at(-1).match(ZU_VERB);
    if (verb) words[words.length - 1] = verb[1] + verb[2];
    else if (words.length > 2 && /^zu$/i.test(words.at(-2)) && /\p{L}{2,}en$/u.test(words.at(-1))) words.splice(-2, 1);
  }
  // "an die Tabletten?" as Whisper sometimes writes it
  return words.join(' ').replace(/^[,:\s–-]+|[,:\s–-]+$|[?!.]+$/g, '').trim();
}

/** "mich bitte morgen …" → "morgen …". "mich daran, morgen …" makes the rest a clause. */
function requestTokens(input) {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (/^(mich|uns),?$/i.test(tokens[0] ?? '')) tokens.shift();
  while (tokens.length > 1 && SOFTENER.test(tokens[0].replace(/,$/, ''))) tokens.shift();
  let clause = false;
  if (tokens.length > 2 && /^(?:daran|dran),$/i.test(tokens[0])) {
    tokens.shift();
    clause = true;
  }
  return { tokens, clause };
}

/**
 * "morgen 9 an Arzt", "Arzt morgen 9", "jeden Montag 8 Müll".
 * Returns { text, due } or { text, rule } or { error } or null when no time was found.
 */
export function parseReminder(input, now) {
  const { tokens, clause } = requestTokens(input);
  if (!tokens.length) return null;

  let found = readWhen(tokens, 0, now);
  let text;
  if (found && found.end < tokens.length) {
    text = cleanText(tokens.slice(found.end), { clause: clause || tokens[found.end - 1].endsWith(',') });
  } else {
    found = null;
    // The time at the end: "an den Arzt morgen 9". The longest ending that is a time wins.
    for (let i = 1; i < tokens.length && !found; i++) {
      const tail = readWhen(tokens, i, now);
      if (tail && tail.end === tokens.length) {
        found = tail;
        text = cleanText(tokens.slice(0, i), { clause });
      }
    }
  }
  if (!found) return null;
  if (found.error) return { error: found.error };
  if (!text) return null;
  if (found.due && found.due - now > MAX_DAYS_AHEAD * DAY_MINUTES * MINUTE) return { error: 'So weit im Voraus merke ich mir nichts.' };
  return found.rule ? { text, rule: found.rule } : { text, due: found.due };
}

/** A message that is only a time: "morgen 9", "jeden Montag 7". Returns { due }, { rule }, { error } or null. */
export function parseWhen(input, now) {
  const tokens = input.trim().replace(/!+$/, '').split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const found = readWhen(tokens, 0, now);
  if (!found || found.end !== tokens.length) return null;
  if (found.error) return { error: found.error };
  return found.rule ? { rule: found.rule } : { due: found.due };
}

/** "30 min", "1h", "morgen 9", "" (10 minutes). For "später". */
export function parseLater(input, now) {
  const text = input.trim();
  if (!text) return { due: now + 10 * MINUTE };
  const relative = /^\d/.test(text) || /^(eine?[nr]?|halbe)\b/i.test(text);
  const found = parseWhen(relative ? `in ${text}` : text, now);
  return found?.rule ? null : found;
}

/** The text of "erinnere mich an den Arzt" without the filler words. */
export function reminderText(input) {
  const { tokens, clause } = requestTokens(input);
  return cleanText(tokens, { clause });
}

/** The first time of the rule after `after`. */
export function nextTime(rule, after) {
  if (rule.every) {
    const start = fromKey(rule.from);
    const days = Math.round((startOfDay(new Date(after)) - start.getTime()) / 86_400_000);
    for (let k = Math.max(0, Math.floor(days / rule.every)); ; k++) {
      const next = at(new Date(start.getFullYear(), start.getMonth(), start.getDate() + k * rule.every), rule.minute);
      if (next > after) return next;
    }
  }
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
  if (rule.every) {
    const clock = `um ${clockText(rule.minute)} Uhr`;
    if (rule.every % 7) return `alle ${rule.every} Tage ${clock}`;
    const weeks = rule.every / 7;
    const day = capitalize(DAYS[fromKey(rule.from).getDay()]);
    return `${weeks === 1 ? 'jede Woche' : `alle ${weeks} Wochen`} am ${day} ${clock}`;
  }
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
