import assert from 'node:assert/strict';
import test from 'node:test';
import { UserError } from '../src/errors.js';
import { setup } from './helpers.js';

async function tracked(target = null, env) {
  const context = setup(env);
  const { id } = context.db.add('491701234567', 'https://shop.de/p', target);
  await context.read(id);
  return { ...context, id };
}

test('first reading is silent', async () => assert.equal((await tracked()).alerts().length, 0));

test('drop is reported once', async () => {
  const t = await tracked();
  await t.read(t.id, { cents: 9000 });
  await t.read(t.id);
  assert.equal(t.alerts().length, 1);
});

test('small drops add up', async () => {
  const t = await tracked();
  await t.read(t.id, { cents: 9950 });
  assert.equal(t.alerts().length, 0);
  await t.read(t.id, { cents: 9900 });
  assert.equal(t.alerts().length, 1);
});

test('target: silent above, once when reached, again after a rise', async () => {
  const t = await tracked(8000);
  await t.read(t.id, { cents: 9000 });
  assert.equal(t.alerts().length, 0);
  await t.read(t.id, { cents: 8000 });
  await t.read(t.id);
  assert.equal(t.alerts().length, 1);
  await t.read(t.id, { cents: 9500 });
  await t.read(t.id, { cents: 7900 });
  assert.equal(t.alerts().length, 2);
});

test('huge jump needs two readings', async () => {
  const t = await tracked();
  await t.read(t.id, { cents: 100 });
  assert.equal(t.db.product(t.id).price, 10000);
  assert.equal(t.alerts().length, 0);
  await t.read(t.id);
  assert.equal(t.db.product(t.id).price, 100);
  assert.equal(t.alerts().length, 1);
});

test('one-time glitch is discarded', async () => {
  const t = await tracked();
  await t.read(t.id, { cents: 100 });
  await t.read(t.id, { cents: 10000 });
  assert.equal(t.db.product(t.id).pending, null);
  assert.equal(t.alerts().length, 0);
});

test('sold out keeps the price, restock is reported', async () => {
  const t = await tracked();
  await t.read(t.id, { cents: null, available: false });
  assert.equal(t.db.product(t.id).price, 10000);
  await t.read(t.id, { cents: 10000, available: true });
  assert.match(t.alerts()[0], /Wieder verfügbar/);
});

test('currency change is not a price drop', async () => {
  const t = await tracked();
  await t.read(t.id, { cents: 8000, currency: 'USD' });
  assert.match(t.alerts()[0], /Währung/);
  assert.doesNotMatch(t.alerts()[0], /gesunken/);
});

test('increase only if enabled', async () => {
  for (const [value, count] of [['false', 0], ['true', 1]]) {
    const t = await tracked(null, { NOTIFY_INCREASE: value });
    await t.read(t.id, { cents: 12000 });
    assert.equal(t.alerts().length, count);
  }
});

test('repeated failures warn once', async () => {
  const t = await tracked();
  t.state.error = new UserError('weg');
  for (let i = 0; i < 8; i++) await t.read(t.id);
  assert.equal(t.alerts().length, 1);
});

test('target is reported when the first check failed', async () => {
  const t = setup();
  const { id } = t.db.add('491701234567', 'https://shop.de/p', 12000);
  t.state.error = new UserError('weg');
  await t.read(id);
  t.state.error = null;
  await t.read(id);
  assert.match(t.alerts()[0], /Zielpreis/);
});
