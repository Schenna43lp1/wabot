import { createCommands } from '../src/commands.js';
import { readConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createTracker } from '../src/tracker.js';

export function setup(env = {}) {
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
    handle: createCommands({ db, tracker, config }),
    alerts: () => db.queued().map((row) => row.text),
    async read(id, changes) {
      Object.assign(state.page, changes);
      return tracker.check(id);
    },
  };
}
