import assert from 'node:assert/strict';
import test from 'node:test';
import { EXIT } from '../src/exit-codes.js';
import { RELINK_WINDOW_MS, supervise } from '../src/supervise.js';

function harness(codes, { checkData = () => {}, relink = () => {} } = {}) {
  const calls = { runs: 0, relinks: 0, logs: [], ended: null };
  let clock = 0;
  const steps = [...codes];
  const options = {
    run: async () => {
      calls.runs++;
      const next = steps.shift();
      if (typeof next === 'object' && next) {
        clock += next.after;
        return next.code;
      }
      return next;
    },
    relink: () => {
      calls.relinks++;
      relink();
    },
    checkData,
    log: (text) => calls.logs.push(text),
    idle: async () => { calls.ended = 'idle'; },
    exit: async (code) => { calls.ended = `exit ${code}`; },
    sleep: async () => {},
    now: () => clock,
  };
  return { calls, done: supervise(options) };
}

test('supervise: stop, crash and fatal error', async () => {
  let run = harness([null]);
  await run.done;
  assert.equal(run.calls.ended, `exit ${EXIT.stopped}`, 'docker stop');

  run = harness([1]);
  await run.done;
  assert.equal(run.calls.ended, 'exit 1', 'crash goes to Docker');

  run = harness([EXIT.fatal]);
  await run.done;
  assert.equal(run.calls.ended, 'idle', 'no restart loop');
  assert.match(run.calls.logs.at(-1), /docker compose up -d/);
});

test('supervise: logout shows a new QR code once, a second one waits', async () => {
  let run = harness([EXIT.loggedOut, null]);
  await run.done;
  assert.equal(run.calls.relinks, 1);
  assert.equal(run.calls.runs, 2);
  assert.equal(run.calls.ended, `exit ${EXIT.stopped}`);

  run = harness([EXIT.loggedOut, { code: EXIT.loggedOut, after: 60_000 }]);
  await run.done;
  assert.equal(run.calls.relinks, 1, 'no endless auth-alt folders');
  assert.equal(run.calls.ended, 'idle');
  assert.match(run.calls.logs.at(-1), /gesperrt/);

  run = harness([EXIT.loggedOut, { code: EXIT.loggedOut, after: RELINK_WINDOW_MS + 1 }, null]);
  await run.done;
  assert.equal(run.calls.relinks, 2, 'much later it is a new logout');
});

test('supervise: unwritable data and failed relink wait with a message', async () => {
  let run = harness([1], { checkData: () => { throw new Error('Der Ordner data ist nicht beschreibbar.'); } });
  await run.done;
  assert.equal(run.calls.runs, 0);
  assert.equal(run.calls.ended, 'idle');
  assert.match(run.calls.logs[0], /nicht beschreibbar/);

  run = harness([EXIT.loggedOut], { relink: () => { throw new Error('Der Bot läuft noch in einem anderen Fenster.'); } });
  await run.done;
  assert.equal(run.calls.ended, 'idle');
  assert.match(run.calls.logs.at(-1), /anderen Fenster/);
});
