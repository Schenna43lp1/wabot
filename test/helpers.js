import { createCommands } from '../src/commands.js';
import { readConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
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

export function setup(env = {}, { now } = {}) {
  const db = openDatabase(':memory:');
  const config = readConfig(env);
  const page = { title: 'Testprodukt', cents: 10000, currency: 'EUR', available: true, from: false };
  const state = { page, error: null };
  const tracker = createTracker({
    db,
    config,
    getProduct: async () => {
      if (state.error) throw state.error;
      return { ...state.page };
    },
  });
  return {
    db, config, state, tracker,
    handle: createCommands({ db, tracker, config, weather: fakeWeather, ...(now && { now }) }),
    alerts: () => db.queued().map((row) => row.text),
    async read(id, changes) {
      Object.assign(state.page, changes);
      return tracker.check(id);
    },
  };
}
