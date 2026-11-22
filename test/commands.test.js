import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers.js';

const USER = '491701234567';

test('complete workflow', async () => {
  const { handle, db } = setup();
  assert.match(await handle(USER, 'https://shop.de/p?utm_source=x&variant=2 89,90 €'), /beobachtet/);
  assert.equal(db.product(1).url, 'https://shop.de/p?variant=2');
  assert.equal(db.product(1).target, 8990);
  assert.match(await handle(USER, 'Liste'), /Testprodukt/);
  assert.match(await handle(USER, 'ziel 1 75'), /75,00/);
  assert.match(await handle(USER, 'prüfen 1'), /100,00/);
  assert.match(await handle(USER, 'verlauf 1'), /Tief/);
  assert.match(await handle(USER, 'selektor 1 .price'), /100,00/);
  assert.equal(db.product(1).selector, '.price');
  await handle(USER, 'ziel 1 aus');
  assert.equal(db.product(1).target, null);
  assert.match(await handle(USER, 'löschen 1'), /Gelöscht/);
  assert.match(await handle(USER, 'liste'), /noch nichts/);
});

const suffixes = [[' 99', 9900], [' ziel 99,50', 9950], [' € 20', 2000], [' 1.299', 129900], [' Modell 2026', null], ['', null]];
for (const [suffix, target] of suffixes) {
  test(`link followed by "${suffix}"`, async () => {
    const { handle, db } = setup();
    await handle(USER, `https://shop.de/p${suffix}`);
    assert.equal(db.product(1).target, target);
  });
}

test('users cannot touch each other', async () => {
  const { handle, db } = setup();
  await handle(USER, 'https://shop.de/p');
  for (const command of ['löschen 1', 'ziel 1 5', 'verlauf 1', 'prüfen 1', 'selektor 1 .x']) {
    assert.match(await handle('499999999999', command), /gibt es nicht/);
  }
  assert.ok(db.product(1));
});

test('self-chat stays quiet for notes', async () => {
  const { handle } = setup();
  for (const note of ['Milch kaufen', 'liste für morgen', 'ziel erreicht']) {
    assert.equal(await handle(USER, note, { quiet: true }), null);
  }
});

test('duplicates and limit', async () => {
  const { handle, db } = setup({ MAX_PRODUCTS_PER_USER: '1' });
  await handle(USER, 'https://shop.de/p');
  assert.match(await handle(USER, 'https://shop.de/p'), /schon/);
  assert.match(await handle(USER, 'https://shop.de/q'), /Limit/);
  assert.equal(db.products(USER).length, 1);
});
