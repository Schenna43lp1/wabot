// Reads iCalendar (.ics) files as Google Calendar and Outlook publish them.
// Covers what these two produce: time zones (also Windows names), all-day events,
// recurring events (RRULE, EXDATE, moved or cancelled single dates).

const DAY_MS = 86_400_000;
const MAX_STEPS = 50_000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Outlook writes Windows names.
const WINDOWS_ZONES = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Helsinki',
  'GTB Standard Time': 'Europe/Athens',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Russian Standard Time': 'Europe/Moscow',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
};

/** "(UTC+01:00) Amsterdam, Berlin, Bern, Rom, Stockholm, Wien" and friends. */
function zoneOf(tzid) {
  if (!tzid) return null;
  const name = tzid.replace(/^"|"$/g, '').replace(/^\/[^/]+\//, '');
  if (WINDOWS_ZONES[name]) return WINDOWS_ZONES[name];
  if (/berlin|wien|vienna|amsterdam|stockholm|rom\b|rome/i.test(name)) return 'Europe/Berlin';
  if (/zürich|zurich|bern\b/i.test(name)) return 'Europe/Zurich';
  if (/brüssel|brussels|paris|madrid|kopenhagen|copenhagen/i.test(name)) return 'Europe/Paris';
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return name;
  } catch {
    return null; // unknown: the PC's time zone
  }
}

const formatters = new Map();
function offsetAt(ms, zone) {
  if (zone === 'UTC') return 0;
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }));
  }
  const parts = Object.fromEntries(formatters.get(zone).formatToParts(ms).map((part) => [part.type, Number(part.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(ms / 1000) * 1000;
}

/** A wall time is ms in a calendar without daylight saving (Date.UTC). This turns it into a real time. */
function toTime(wall, zone) {
  if (zone === undefined || zone === null) {
    const d = new Date(wall);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
  }
  const first = wall - offsetAt(wall, zone);
  const second = wall - offsetAt(first, zone);
  return second;
}

function unescape(text) {
  return text.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
}

/** "NAME;A=1;B="x:y":value" → { name, params, value } */
function parseLine(line) {
  let quoted = false;
  let split = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) {
      split = i;
      break;
    }
  }
  if (split < 0) return null;
  const [name, ...rawParams] = line.slice(0, split).split(';');
  const params = {};
  for (const param of rawParams) {
    const eq = param.indexOf('=');
    if (eq > 0) params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(split + 1) };
}

/** Returns { wall, zone, allDay } where zone is 'UTC', an IANA name or null (local). */
function parseDate(value, params) {
  const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, utc] = match;
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0));
  if (h === undefined || params.VALUE === 'DATE') return { wall, zone: null, allDay: true };
  return { wall, zone: utc ? 'UTC' : zoneOf(params.TZID), allDay: false };
}

function parseDuration(value) {
  const match = value.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return null;
  const [, sign, w, d, h, m, s] = match;
  const ms = ((Number(w ?? 0) * 7 + Number(d ?? 0)) * 24 * 3600 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

function parseRule(value) {
  const rule = Object.fromEntries(value.split(';').map((part) => part.split('=')).filter((pair) => pair.length === 2).map(([k, v]) => [k.toUpperCase(), v]));
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.FREQ)) return null;
  const until = rule.UNTIL ? parseDate(rule.UNTIL, {}) : null;
  return {
    freq: rule.FREQ,
    interval: Math.max(1, Number(rule.INTERVAL) || 1),
    count: rule.COUNT ? Number(rule.COUNT) : null,
    until,
    byDay: rule.BYDAY ? rule.BYDAY.split(',').map((day) => {
      const m = day.match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/);
      return m ? { nth: m[1] ? Number(m[1]) : 0, day: WEEKDAYS.indexOf(m[2]) } : null;
    }).filter(Boolean) : null,
    byMonthDay: rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null,
    byMonth: rule.BYMONTH ? rule.BYMONTH.split(',').map(Number) : null,
  };
}

export function parseCalendar(text) {
  if (!/BEGIN:VCALENDAR/i.test(text)) return null;
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const calendar = { name: null, events: [] };
  let event = null;
  let depth = 0; // VALARM and friends inside an event
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'X-WR-CALNAME' && !event) calendar.name = unescape(prop.value);
    if (prop.name === 'BEGIN') {
      if (prop.value.toUpperCase() === 'VEVENT' && !event) event = { exdates: new Set() };
      else if (event) depth++;
      continue;
    }
    if (prop.name === 'END') {
      if (event && depth) depth--;
      else if (event && prop.value.toUpperCase() === 'VEVENT') {
        if (event.start) calendar.events.push(event);
        event = null;
      }
      continue;
    }
    if (!event || depth) continue;
    switch (prop.name) {
      case 'UID': event.uid = prop.value; break;
      case 'SUMMARY': event.title = unescape(prop.value); break;
      case 'LOCATION': event.location = unescape(prop.value); break;
      case 'STATUS': event.cancelled = /CANCELLED/i.test(prop.value); break;
      case 'DTSTART': event.start = parseDate(prop.value, prop.params); break;
      case 'DTEND': event.end = parseDate(prop.value, prop.params); break;
      case 'DURATION': event.duration = parseDuration(prop.value); break;
      case 'RRULE': event.rule = parseRule(prop.value); break;
      case 'RECURRENCE-ID': event.recurrenceId = parseDate(prop.value, prop.params); break;
      case 'EXDATE':
        for (const value of prop.value.split(',')) {
          const date = parseDate(value, prop.params);
          if (date) event.exdates.add(toTime(date.wall, date.allDay ? null : date.zone ?? event.start?.zone));
        }
        break;
    }
  }
  return calendar;
}

const wallDate = (wall) => new Date(wall);
const dayStart = (wall) => wall - (((wall % DAY_MS) + DAY_MS) % DAY_MS);
const timeOfDay = (wall) => wall - dayStart(wall);
const makeWall = (y, m, d) => Date.UTC(y, m, d);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** The n-th (or -n-th from the end) weekday of a month, or null. */
function nthWeekday(y, m, day, nth) {
  const last = daysInMonth(y, m);
  if (nth > 0) {
    const first = (day - new Date(Date.UTC(y, m, 1)).getUTCDay() + 7) % 7 + 1;
    const date = first + (nth - 1) * 7;
    return date <= last ? date : null;
  }
  const lastDay = new Date(Date.UTC(y, m, last)).getUTCDay();
  const date = last - ((lastDay - day + 7) % 7) + (nth + 1) * 7;
  return date >= 1 ? date : null;
}

/** Days (as wall day starts) of one month for MONTHLY and YEARLY rules. */
function monthDays(y, m, rule, startDay) {
  const last = daysInMonth(y, m);
  let days = [];
  if (rule.byMonthDay) {
    days = rule.byMonthDay.map((d) => (d < 0 ? last + d + 1 : d)).filter((d) => d >= 1 && d <= last);
  } else if (rule.byDay) {
    for (const { nth, day } of rule.byDay) {
      if (nth) {
        const date = nthWeekday(y, m, day, nth);
        if (date) days.push(date);
      } else {
        for (let d = 1; d <= last; d++) if (new Date(Date.UTC(y, m, d)).getUTCDay() === day) days.push(d);
      }
    }
  } else if (startDay <= last) {
    days = [startDay];
  }
  return [...new Set(days)].sort((a, b) => a - b).map((d) => makeWall(y, m, d));
}

/** Start walls of a recurring event in order, until `untilWall` (inclusive) or the rule ends. */
function* expand(start, rule, untilWall) {
  const first = wallDate(start);
  const time = timeOfDay(start);
  const startDay = dayStart(start);
  let emitted = 0;
  const done = (wall) => (rule.count != null && emitted >= rule.count) || wall > untilWall || rule.ended(wall);

  // Without COUNT the periods before the window can be skipped.
  const periodDays = rule.freq === 'DAILY' ? rule.interval : rule.freq === 'WEEKLY' ? 7 * rule.interval : 0;
  let period = 0;
  if (periodDays && rule.count == null && rule.windowStart > start) {
    period = Math.max(0, Math.floor((rule.windowStart - start) / DAY_MS / periodDays) - 1);
  }

  for (let steps = 0; steps < MAX_STEPS; steps++, period++) {
    let anchor;
    let candidates;
    if (rule.freq === 'DAILY') {
      anchor = startDay + period * rule.interval * DAY_MS;
      candidates = [anchor];
      if (rule.byDay && !rule.byDay.some((by) => by.day === wallDate(anchor).getUTCDay())) candidates = [];
      if (rule.byMonth && !rule.byMonth.includes(wallDate(anchor).getUTCMonth() + 1)) candidates = [];
    } else if (rule.freq === 'WEEKLY') {
      anchor = startDay - ((wallDate(startDay).getUTCDay() + 6) % 7) * DAY_MS + period * rule.interval * 7 * DAY_MS;
      const days = rule.byDay?.length ? rule.byDay.map((by) => by.day) : [first.getUTCDay()];
      candidates = [...new Set(days)].map((day) => anchor + ((day + 6) % 7) * DAY_MS).sort((a, b) => a - b);
    } else if (rule.freq === 'MONTHLY') {
      const month = first.getUTCMonth() + period * rule.interval;
      const y = first.getUTCFullYear() + Math.floor(month / 12);
      const m = ((month % 12) + 12) % 12;
      anchor = makeWall(y, m, 1);
      candidates = monthDays(y, m, rule, first.getUTCDate());
    } else {
      const y = first.getUTCFullYear() + period * rule.interval;
      anchor = makeWall(y, 0, 1);
      const months = rule.byMonth ? rule.byMonth.map((m) => m - 1) : [first.getUTCMonth()];
      candidates = months.flatMap((m) => monthDays(y, m, rule, first.getUTCDate()));
    }
    // Nothing more can come once a period starts after the end.
    if (anchor > untilWall) return;
    for (const day of candidates) {
      const wall = day + time;
      if (wall < start) continue;
      if (done(wall)) return;
      emitted++;
      yield wall;
    }
  }
}

/** All events that overlap [from, to), as { start, end, allDay, title, location, uid }, sorted. */
export function occurrences(calendar, from, to) {
  const found = [];
  const overrides = new Map(); // uid → Set of original start times that were moved or cancelled
  for (const event of calendar.events) {
    if (!event.recurrenceId || !event.uid) continue;
    const { wall, zone, allDay } = event.recurrenceId;
    if (!overrides.has(event.uid)) overrides.set(event.uid, new Set());
    overrides.get(event.uid).add(toTime(wall, allDay ? null : zone));
  }

  for (const event of calendar.events) {
    const { start } = event;
    const zone = start.allDay ? null : start.zone;
    let length;
    if (event.end) length = event.end.wall - start.wall;
    else if (event.duration != null) length = event.duration;
    else length = start.allDay ? DAY_MS : 0;
    length = Math.max(0, length);

    const push = (wall) => {
      const begin = toTime(wall, zone);
      const end = toTime(wall + length, zone);
      if (event.cancelled || event.exdates.has(begin)) return;
      const overlaps = begin < to && (end > from || (end === begin && begin >= from));
      if (!overlaps) return;
      found.push({ start: begin, end, allDay: start.allDay, title: event.title || '(ohne Titel)', location: event.location || null, uid: event.uid });
    };

    if (!event.rule || event.recurrenceId) {
      push(start.wall);
      continue;
    }
    const moved = overrides.get(event.uid);
    // Wall bounds with a day of margin for time zones and long events.
    const untilWall = to + 2 * DAY_MS + 14 * 3_600_000;
    // UNTIL is inclusive. A date alone means the whole day.
    const { until } = event.rule;
    let endsAt = null;
    if (until) endsAt = until.allDay ? toTime(until.wall + DAY_MS - 1, zone) : toTime(until.wall, until.zone ?? zone);
    const rule = {
      ...event.rule,
      windowStart: from - length - 2 * DAY_MS,
      ended: (wall) => endsAt != null && toTime(wall, zone) > endsAt,
    };
    for (const wall of expand(start.wall, rule, untilWall)) {
      if (moved?.has(toTime(wall, zone))) continue;
      push(wall);
    }
  }
  return found.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start || a.title.localeCompare(b.title));
}
