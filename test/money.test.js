import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePrice, structuredCents } from '../src/money.js';

const cases = {
  '19,99 €': 1999, '€19.99': 1999, '1.299,99 €': 129999, '1,299.99 USD': 129999,
  "CHF 1'299.-": 129900, '19,- €': 1900, '1 299,00 €': 129900, '1 299,00 €': 129900,
  '1.299 €': 129900, '99': 9900, '99,9': 9990, '1299,99 €': 129999, '12.345.678 €': 1234567800,
  'ab 49,95 EUR inkl. MwSt.': 4995, '19,99 €19,99 €': 1999, '€ 5': 500, '249,00€': 24900,
};
for (const [text, cents] of Object.entries(cases)) {
  test(`reads "${text}"`, () => assert.equal(parsePrice(text)?.cents, cents));
}

for (const text of ['', 'gratis', '0 €', '99 € 79 €', '2 oder 3']) {
  test(`does not guess "${text}"`, () => assert.equal(parsePrice(text), null));
}

test('structured prices', () => {
  assert.equal(structuredCents('19.99'), 1999);
  assert.equal(structuredCents('129.000'), 12900);
  assert.equal(structuredCents('19,99'), 1999);
  assert.equal(structuredCents(19.99), 1999);
  assert.equal(structuredCents('1.299'), null);
});
