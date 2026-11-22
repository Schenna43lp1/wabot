import assert from 'node:assert/strict';
import test from 'node:test';
import { UserError } from '../src/errors.js';
import { cleanLink, parseTarget, suggest } from '../src/input.js';
import { setup } from './helpers.js';

const U = '491701234567';

async function withProducts(env) {
  const t = setup(env);
  for (const path of 'abc') await t.handle(U, `https://shop.de/${path}`);
  return t;
}

const targets = {
  '89,90': { cents: 8990 }, '89.90 €': { cents: 8990 }, '€ 20': { cents: 2000 }, '80,-': { cents: 8000 }, '80.': { cents: 8000 },
  'unter 80': { cents: 8000 }, 'auf 75 euro': { cents: 7500 }, '1.299': { cents: 129900 }, 'max. 50': { cents: 5000 },
  '10%': { percent: 10 }, '-10 %': { percent: 10 }, '−7,5%': { percent: 7.5 }, '15 prozent': { percent: 15 },
  '-5': null, '80-': null, 'in 2 wochen': null, '0%': null, '100%': null, '2 Stück': null, 'Modell 2026': null, '10% Rabatt': null, '': null,
};
for (const [input, expected] of Object.entries(targets)) {
  test(`target "${input}"`, () => assert.deepEqual(parseTarget(input), expected));
}

for (const command of ['löschen 3', 'Löschen 3.', 'lösche 3', 'löschen #3', 'löschen nr. 3', 'Löschen Nummer 3', '3 löschen', 'loeschen 3', 'entfernen 3!', 'löschen https://shop.de/c', 'lösche bitte https://shop.de/c']) {
  test(`deletes with "${command}"`, async () => {
    const { handle, db } = await withProducts();
    await handle(U, command);
    assert.equal(db.product(3), undefined);
    assert.equal(db.products(U).length, 2);
  });
}

for (const command of ['löschen https://shop.de/new', 'prüfen https://shop.de/new', 'ziel https://shop.de/new 50']) {
  test(`never adds with "${command}"`, async () => {
    const { handle, db } = await withProducts();
    assert.match(await handle(U, command), /beobachtest du nicht/);
    assert.equal(db.products(U).length, 3);
  });
}

// The self-chat is also a notepad.
const notes = [
  'Milch kaufen', '3', '42', '?', 'hallo', 'danke', 'lsite', 'liste für morgen', 'ziel erreicht', 'prüfen 3 Rechnungen',
  'löschen 2 alte Fotos', 'check mal die Reifen', 'info vom Arzt', '3 Äpfel', '2 zeige mir mal', 'start um 8', 'hilfe beim Umzug',
  'verlauf der Krankheit', '3 ziel erreicht', 'zeige 2 Bilder', 'entfernen von Flecken', '10.11. Zahnarzt', '3.5 km gelaufen',
];
for (const note of notes) {
  test(`self-chat ignores "${note}"`, async () => {
    const { handle, db } = await withProducts();
    assert.equal(await handle(U, note, { quiet: true }), null);
    assert.equal(db.products(U).length, 3);
  });
}

test('shared text starting with a command word still adds', async () => {
  const { handle, db } = await withProducts();
  assert.match(await handle(U, 'Check out this deal https://shop.de/deal'), /beobachtet/);
  assert.equal(db.products(U).length, 4);
});

test('undo restores number, target, selector and history', async () => {
  const t = await withProducts();
  await t.handle(U, 'selektor 2 .price');
  await t.handle(U, 'ziel 2 80');
  await t.read(2, { cents: 9000 });
  const before = { product: t.db.product(2), history: t.db.history(2, 10) };
  await t.handle(U, 'löschen 2');
  assert.match(await t.handle(U, 'rückgängig'), /Wieder da/);
  assert.deepEqual({ product: t.db.product(2), history: t.db.history(2, 10) }, before);
  assert.match(await t.handle(U, 'rückgängig'), /nichts wiederherzustellen/);
});

test('undo is private, and avoids duplicates', async () => {
  const t = await withProducts();
  await t.handle(U, 'löschen 2');
  assert.match(await t.handle('499999999999', 'rückgängig'), /nichts wiederherzustellen/);
  await t.handle(U, 'https://shop.de/b');
  assert.match(await t.handle(U, 'rückgängig'), /schon wieder/);
});

test('undo respects the limit', async () => {
  const t = setup({ MAX_PRODUCTS_PER_USER: '1' });
  await t.handle(U, 'https://shop.de/a');
  await t.handle(U, 'löschen 1');
  await t.handle(U, 'https://shop.de/b');
  assert.match(await t.handle(U, 'rückgängig'), /voll/);
});

test('failing selector changes nothing', async () => {
  const t = await withProducts();
  await t.read(1, { cents: 9000 });
  const before = { product: t.db.product(1), history: t.db.history(1, 10) };
  t.state.error = new UserError('Der CSS-Selektor ist ungültig.');
  assert.match(await t.handle(U, 'selektor 1 [[['), /nichts geändert/);
  assert.deepEqual({ product: t.db.product(1), history: t.db.history(1, 10) }, before);
});

test('several links, each with its own target', async () => {
  const { handle, db } = setup();
  await handle(U, 'https://shop.de/a 50\nhttps://shop.de/b -20%');
  assert.deepEqual(db.products(U).map((p) => p.target), [5000, 8000]);
});

test('one bad link does not stop the others', async () => {
  const { handle, db } = setup();
  assert.match(await handle(U, 'http://127.0.0.1/x https://shop.de/b'), /gesperrt/);
  assert.equal(db.products(U).length, 1);
});

test('more than five links are announced', async () => {
  const { handle, db } = setup();
  const reply = await handle(U, [...'abcdefg'].map((p) => `https://shop.de/${p}`).join(' '));
  assert.equal(db.products(U).length, 5);
  assert.match(reply, /übrigen 2/);
});

test('an unclear target is announced', async () => {
  const { handle } = setup();
  assert.match(await handle(U, 'https://shop.de/a 80-'), /nicht als Zielpreis/);
});

for (const [kind, saved, text] of [['gone', 0, /Nicht gespeichert/], ['invalid', 0, /Nicht gespeichert/], ['blocked', 1, /geizhals/], ['temporary', 1, /vorübergehend/], ['no_price', 1, /einzelnen Produkts/]]) {
  test(`adding fails: ${kind}`, async () => {
    const { handle, db, state } = setup();
    state.error = new UserError('Fehler', kind);
    assert.match(await handle(U, 'https://shop.de/a'), text);
    assert.equal(db.products(U).length, saved);
  });
}

test('percent without a price is explained', async () => {
  const { handle, state, db } = setup();
  state.error = new UserError('Fehler', 'temporary');
  assert.match(await handle(U, 'https://shop.de/a -10%'), /erst, wenn ein Preis da ist/);
  assert.equal(db.product(1).target, null);
});

test('temporary errors retry soon', async () => {
  const { handle, state, db } = setup();
  state.error = new UserError('Fehler', 'temporary');
  await handle(U, 'https://shop.de/a');
  assert.ok(db.product(1).next_check_at - Date.now() <= 10 * 60_000);
});

test('list shows change and distance, but no links', async () => {
  const t = await withProducts();
  await t.handle(U, 'ziel 1 80');
  await t.read(1, { cents: 9000 });
  const list = await t.handle(U, 'liste');
  assert.match(list, /↓ 10 %/);
  assert.match(list, /noch 10,00/);
  assert.doesNotMatch(list, /https:/);
});

test('target alert says what to do', async () => {
  const t = await withProducts();
  await t.handle(U, 'ziel 1 95');
  await t.read(1, { cents: 9000 });
  assert.match(t.alerts()[0], /Tiefster Preis/);
  assert.match(t.alerts()[0], /löschen 1/);
});

test('typos are suggested, never executed', async () => {
  const { handle, db } = await withProducts();
  assert.match(await handle(U, 'löshcen 3'), /Meintest du `löschen 3`/);
  assert.equal(db.products(U).length, 3);
  assert.equal(suggest('lsite'), 'liste');
  assert.equal(suggest('wetter'), null);
});

test('links lose surrounding punctuation only', () => {
  assert.equal(cleanLink('https://x.de/w).'), 'https://x.de/w');
  assert.equal(cleanLink('https://x.de/Lampe_(rot)'), 'https://x.de/Lampe_(rot)');
});

test('polite commands work', async () => {
  const { handle, db } = await withProducts();
  assert.match(await handle(U, 'hilfe bitte'), /Hilfe/);
  assert.match(await handle(U, 'liste bitte!'), /3 Produkte/);
  await handle(U, 'bitte löschen 3');
  assert.equal(db.product(3), undefined);
});

test('a name points to the number but deletes nothing', async () => {
  const { handle, db } = await withProducts();
  db.update(2, { title: 'BILLY Bücherregal' });
  assert.match(await handle(U, 'löschen billy'), /`löschen 2`/);
  assert.equal(db.products(U).length, 3);
  assert.equal(await handle(U, 'löschen billy', { quiet: true }), null);
});

test('products without a price have a readable name', () => {
  const { db } = setup();
  assert.equal(db.add(U, 'https://www.ikea.com/de/p/billy-regal-00263850/').title, 'billy regal (ikea.com)');
});
