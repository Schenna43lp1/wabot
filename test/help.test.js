import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../src/config.js';
import { helpText } from '../src/help.js';
import { splitText } from '../src/whatsapp.js';
import { setup } from './helpers.js';

const USER = '491701234567';
const help = (env = {}) => helpText(readConfig(env));
const examples = [...help().matchAll(/`([^`]+)`/g)].map((match) => match[1]);

for (const example of examples) {
  test(`help example works: ${example}`, async () => {
    const { handle } = setup();
    for (const path of ['a', 'b', 'c', 'd']) await handle(USER, `https://shop.de/${path}`);
    await handle(USER, 'löschen 4');
    // quiet: an unknown command gives null instead of falling back to the help text.
    const reply = await handle(USER, example.replace('Link', 'https://shop.de/new'), { quiet: true });
    assert.ok(reply);
    assert.doesNotMatch(reply.text ?? reply, /gibt es nicht|So geht es|nichts wiederherzustellen|⚠️/);
  });
}

test('help follows the settings', () => {
  assert.match(help(), /alle 3 Stunden/);
  assert.match(help(), /ab 1 % Senkung/);
  assert.doesNotMatch(help(), /Preis steigt/);

  assert.match(help({ CHECK_INTERVAL_MINUTES: '60' }), /jede Stunde/);
  assert.match(help({ CHECK_INTERVAL_MINUTES: '90' }), /alle 90 Minuten/);
  assert.match(help({ MIN_DROP_PERCENT: '2,5' }), /ab 2,5 % Senkung/);
  assert.match(help({ MIN_DROP_PERCENT: '0' }), /bei jeder Senkung/);
  assert.match(help({ NOTIFY_INCREASE: 'true' }), /Preis steigt/);
});

test('help fits into one message', () => assert.equal(splitText(help({ NOTIFY_INCREASE: 'true' })).length, 1));

test('help shows it, unknown input points to it', async () => {
  const { handle } = setup();
  assert.equal(await handle(USER, 'hilfe'), help());
  assert.match(await handle(USER, 'was geht'), /`hilfe`/);
});
