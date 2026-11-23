import { createCommands } from '../src/commands.js';
import { readConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { UserError } from '../src/errors.js';
import { createTracker } from '../src/tracker.js';

export const fakeWeather = {
  places: [],
  async findPlace(name) {
    this.places.push(name);
    return /^(wien|graz)$/i.test(name) ? { place: `${name[0].toUpperCase()}${name.slice(1).toLowerCase()}, Österreich`, lat: 48.2, lon: 16.37 } : null;
  },
  async forecast() {
    return {
      now: { temperature: 4.4, code: 2 },
      today: { code: 61, min: -1.2, max: 6.6, rain: 70 },
      tomorrow: { code: 0, min: -3, max: 4, rain: 0 },
    };
  },
};

// A weekly event every day of the week at 10, so every test day has one.
export const SAMPLE_CALENDAR = [
  'BEGIN:VCALENDAR',
  'X-WR-CALNAME:Privat',
  'BEGIN:VEVENT',
  'UID:daily-standup',
  'DTSTART;TZID=Europe/Berlin:20260105T100000',
  'DTEND;TZID=Europe/Berlin:20260105T103000',
  'RRULE:FREQ=DAILY',
  'SUMMARY:Standup',
  'LOCATION:Büro',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

// Rounded ECB rates: 1 EUR = 1.10 USD, 0.95 CHF, 0.85 GBP, 25 CZK
export const fakeRates = {
  loads: 0,
  async load() {
    this.loads++;
    return { date: '2026-11-20', rates: new Map([['EUR', 1], ['USD', 1.1], ['CHF', 0.95], ['GBP', 0.85], ['CZK', 25], ['JPY', 160], ['PLN', 4.3], ['HUF', 400], ['SEK', 11.5], ['NOK', 11.8], ['DKK', 7.46], ['TRY', 38]]) };
  },
};

export function setup(env = {}, { now } = {}) {
  const db = openDatabase(':memory:');
  const config = readConfig(env);
  const page = { title: 'Testprodukt', cents: 10000, currency: 'EUR', available: true, from: false };
  // url → .ics text, or an Error to throw
  const calendars = { 'https://calendar.google.com/calendar/ical/secret/basic.ics': SAMPLE_CALENDAR };
  const state = { page, error: null, calendars, calendarFetches: [] };
  const tracker = createTracker({
    db,
    config,
    getProduct: async () => {
      if (state.error) throw state.error;
      return { ...state.page };
    },
  });
  const calendarFetch = async (url) => {
    state.calendarFetches.push(url);
    const found = calendars[url];
    if (found instanceof Error) throw found;
    if (found == null) throw new UserError('Den Kalender gibt es unter diesem Link nicht (mehr) (HTTP 404).', 'gone');
    return found;
  };
  return {
    db, config, state, tracker,
    handle: createCommands({ db, tracker, config, weather: fakeWeather, calendarFetch, rates: fakeRates, ...(now && { now }) }),
    alerts: () => db.queued().map((row) => row.text),
    async read(id, changes) {
      Object.assign(state.page, changes);
      return tracker.check(id);
    },
  };
}
