// Set before the first Date: times are local.
process.env.TZ = 'Europe/Berlin';

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBirthday, queueBirthdays } from '../src/birthdays.js';
import { calculate, formatNumber, tipText } from '../src/calc.js';
import { parseExpense, parsePeriod } from '../src/expenses.js';
import { createRates } from '../src/rates.js';
import { parseConversion } from '../src/tools.js';
import { fakeRates, setup } from './helpers.js';

const U = '491701234567';
const OTHER = '491709999999';
const local = (...parts) => new Date(...parts).getTime();
// Monday, 23 November 2026, 14:00
const MONDAY = local(2026, 10, 23, 14, 0);

function withClock(start = MONDAY) {
  const clock = { now: start };
  const t = setup({}, { now: () => clock.now });
  return { ...t, clock };
}

// Calculator
const sums = {
  '12,5*3+7': '44,5', '250 + 19%': '297,5', '250 - 20%': '200', '19% von 250': '47,5', '2^10': '1.024', '(1+2)*3': '9',
  '1.250 + 1': '1.251', '1.250,50 * 2': '2.501', '12.5*2': '25', 'wurzel 2': '1,4142135624', '2x3': '6', '-3+5': '2',
  '7:2': '3,5', '1/3': '0,3333333333', '0,1+0,2': '0,3', '100 € * 3': '300', '2 × 3 ÷ 4': '1,5', '-2^2': '4',
};
for (const [input, result] of Object.entries(sums)) {
  test(`calculates ${input}`, () => assert.equal(formatNumber(calculate(input).value), result));
}

test('calculator errors and non-calculations', () => {
  assert.match(calculate('10/0').error, /null/);
  assert.match(calculate('(2+3').error, /Klammer/);
  assert.match(calculate('wurzel -4').error, /negativ/);
  for (const input of ['abc', '3.5 km', 'Milch', '', 'x'.repeat(300)]) assert.equal(calculate(input), null, input);
  // Never evaluates code
  assert.equal(calculate('process.exit(1)'), null);
  assert.equal(calculate('1+constructor'), null);
});

test('tips round up like people do', () => {
  assert.equal(tipText('47,80'), [
    '💶 *Trinkgeld für 47,80 €*',
    '5 %: 2,39 € → *50,19 €*, aufgerundet 51,00 €',
    '10 %: 4,78 € → *52,58 €*, aufgerundet 53,00 €',
    '15 %: 7,17 € → *54,97 €*, aufgerundet 55,00 €',
  ].join('\n'));
  assert.match(tipText('12 € 10%'), /10 %: 1,20 € → \*13,20 €\*, aufgerundet 13,50 €/);
  assert.equal(tipText('viel'), null);
});

test('calculator commands', async () => {
  const { handle } = withClock();
  assert.equal(await handle(U, 'rechne 12,5*3+7'), '🧮 12,5*3+7 = *44,5*');
  assert.equal(await handle(U, '= 19% von 250'), '🧮 19% von 250 = *47,5*');
  assert.match(await handle(U, 'rechne 1/0'), /Durch null/);
  assert.match(await handle(U, 'rechne'), /So geht es/);
  assert.equal(await handle(U, 'rechne mal nach', { quiet: true }), null);
  assert.match(await handle(U, 'trinkgeld 47,80'), /aufgerundet 53,00 €/);
});

// Currencies
test('conversions are recognized only with known currencies', () => {
  assert.deepEqual(parseConversion('100 usd in eur'), { amount: 100, from: 'USD', to: 'EUR' });
  assert.deepEqual(parseConversion('$100 in €'), { amount: 100, from: 'USD', to: 'EUR' });
  assert.deepEqual(parseConversion('100 Dollar nach Euro'), { amount: 100, from: 'USD', to: 'EUR' });
  assert.deepEqual(parseConversion('1.500 czk'), { amount: 1500, from: 'CZK', to: null });
  for (const text of ['100 km in m', '3 Äpfel', 'in 30 min', '5 Kinder in Wien']) assert.equal(parseConversion(text), null, text);
});

test('converting and rates', async () => {
  const { handle } = withClock();
  assert.match(await handle(U, '100 usd in eur'), /^💱 100,00.\$ = \*90,91.€\*\n_Kurs der EZB vom 20\.11\.2026: 1 EUR = 1,1 USD_$/);
  assert.match(await handle(U, 'umrechnen 100 €'), /100,00.€ = \*110,00.\$\*\n100,00.€ = \*95,00.CHF\*\n100,00.€ = \*85,00.£\*/);
  assert.match(await handle(U, 'umrechnen 50 chf in usd'), /50,00.CHF = \*57,89.\$\*/);
  assert.match(await handle(U, 'kurs chf'), /1 EUR = \*0,95 CHF\*\n1 CHF = \*1,0526 EUR\*/);
  assert.match(await handle(U, 'umrechnen 100 xyz'), /kenne ich nicht/);
  // A shop link with "in" is still a product.
  assert.match(await handle(U, 'https://shop.de/a'), /beobachtet/);
});

test('notes in the self-chat do not download rates', async () => {
  const { handle } = withClock();
  const before = fakeRates.loads;
  for (const note of ['5 Kinder in Wien', '3 Äpfel', 'kurs', 'Kurs Yoga morgen']) assert.equal(await handle(U, note, { quiet: true }), null, note);
  assert.equal(fakeRates.loads, before);
});

test('ECB rates are read and kept for hours, also when the ECB is down', async () => {
  let clock = 0;
  let calls = 0;
  let down = false;
  const xml = `<gesmes:Envelope><Cube><Cube time='2026-11-20'>
    ${['USD', 'JPY', 'BGN', 'CZK', 'DKK', 'GBP', 'HUF', 'PLN', 'RON', 'SEK', 'CHF'].map((code, i) => `<Cube currency='${code}' rate='${1 + i / 10}'/>`).join('\n')}
    </Cube></Cube></gesmes:Envelope>`;
  const rates = createRates({
    now: () => clock,
    fetch: async () => {
      calls++;
      if (down) throw new Error('offline');
      return { ok: true, text: async () => xml };
    },
  });
  const first = await rates.load();
  assert.equal(first.rates.get('USD'), 1);
  assert.equal(first.rates.get('CHF'), 2);
  assert.equal(first.date, '2026-11-20');
  await rates.load();
  assert.equal(calls, 1);
  clock += 7 * 3_600_000;
  down = true;
  assert.equal((await rates.load()).rates.get('CHF'), 2);
  assert.equal(calls, 2);
  await assert.rejects(createRates({ fetch: async () => { throw new Error('offline'); } }).load(), /nicht abrufbar/);
});

// Expenses
test('expenses are read in many ways', () => {
  assert.deepEqual(parseExpense('12,50 essen Pizza mit Tom', 'EUR'), { cents: 1250, currency: 'EUR', category: 'essen', note: 'Pizza mit Tom' });
  assert.deepEqual(parseExpense('Essen 12,50', 'EUR'), { cents: 1250, currency: 'EUR', category: 'essen', note: '' });
  assert.deepEqual(parseExpense('12,50€ tanken', 'EUR'), { cents: 1250, currency: 'EUR', category: 'tanken', note: '' });
  assert.deepEqual(parseExpense('€ 8 kaffee', 'EUR'), { cents: 800, currency: 'EUR', category: 'kaffee', note: '' });
  assert.deepEqual(parseExpense('20 chf bahn', 'EUR'), { cents: 2000, currency: 'CHF', category: 'bahn', note: '' });
  assert.deepEqual(parseExpense('1.299,- technik Laptop', 'EUR'), { cents: 129900, currency: 'EUR', category: 'technik', note: 'Laptop' });
  assert.deepEqual(parseExpense('5', 'EUR'), { cents: 500, currency: 'EUR', category: 'sonstiges', note: '' });
  assert.equal(parseExpense('essen', 'EUR'), null);
});

test('periods', () => {
  assert.equal(parsePeriod('', MONDAY).title, 'November 2026');
  assert.equal(parsePeriod('letzter Monat', MONDAY).title, 'Oktober 2026');
  assert.equal(parsePeriod('okt', MONDAY).title, 'Oktober 2026');
  assert.equal(parsePeriod('dezember', MONDAY).title, 'Dezember 2025');
  assert.equal(parsePeriod('märz 2025', MONDAY).title, 'März 2025');
  assert.equal(parsePeriod('2025', MONDAY).title, 'Jahr 2025');
  assert.equal(parsePeriod('essen', MONDAY), null);
});

test('household book: add, overview by category, delete and undo', async () => {
  const { handle, db, clock } = withClock();
  const added = await handle(U, 'ausgabe 12,50 essen Pizza mit Tom');
  assert.match(added, /💸 \*12,50.€\* 🍽️ Essen – Pizza mit Tom\nDiesen Monat: 12,50.€, davon Essen 12,50.€/);
  await handle(U, 'Ausgabe 50 tanken');
  await handle(U, 'ausgabe 7,50 essen');
  await handle(U, 'ausgabe 20 chf bahn');
  clock.now = local(2026, 9, 15, 12, 0);
  await handle(U, 'ausgabe 100 miete');
  clock.now = MONDAY;

  const month = await handle(U, 'ausgaben');
  assert.match(month, /Ausgaben November 2026\*\n\nGesamt: \*70,00.€\*\n⛽ Tanken 50,00.€ \(71 %\)\n🍽️ Essen 20,00.€ \(29 %\)/);
  assert.match(month, /Gesamt: \*20,00.CHF\*\n🚆 Bahn 20,00.CHF/);
  assert.match(month, /\*4\.\* 23\.11\. 20,00.CHF Bahn/);
  assert.match(await handle(U, 'ausgaben oktober'), /Gesamt: \*100,00.€\*\n🏠 Miete/);
  assert.match(await handle(U, 'ausgaben essen'), /Essen\*\n\nGesamt: \*20,00.€\*[\s\S]*\*3\.\*[\s\S]*\*1\.\*/);
  assert.match(await handle(U, 'ausgaben quatsch'), /So geht es/);
  assert.match(await handle(OTHER, 'ausgaben'), /Noch nichts eingetragen/);

  assert.match(await handle(U, 'ausgabe weg 2'), /gelöscht: 50,00.€ Tanken/);
  assert.equal(db.expenseTotal(U, 0, Infinity, 'EUR'), 12000);
  assert.match(await handle(U, 'rückgängig'), /Wieder da: 50,00.€ Tanken \(Nr\. 2\)/);
  assert.match(await handle(U, 'ausgabe weg 99'), /So geht es/);
  assert.match(await handle(U, 'ausgabe essen'), /So geht es/);
});

test('budgets warn at 80 % and when exceeded', async () => {
  const { handle } = withClock();
  assert.match(await handle(U, 'budget'), /Noch kein Budget/);
  assert.match(await handle(U, 'budget 100'), /Monatsbudget: \*100,00.€\*/);
  assert.match(await handle(U, 'budget essen 50 €'), /Budget für Essen: \*50,00.€\*/);
  assert.doesNotMatch(await handle(U, 'ausgabe 30 essen'), /⚠️|🚨/);
  assert.match(await handle(U, 'ausgabe 12 essen'), /⚠️ Budget Essen zu 84 % verbraucht, noch 8,00.€/);
  const over = await handle(U, 'ausgabe 60 freizeit');
  assert.match(over, /🚨 Monatsbudget überschritten: 102,00.€ von 100,00.€/);
  assert.doesNotMatch(over, /Essen/);
  assert.match(await handle(U, 'ausgaben'), /Gesamt: \*102,00.€\* von 100,00.€ \(102 %\) 🚨[\s\S]*Essen 42,00.€ \/ 50,00.€/);
  assert.match(await handle(U, 'budget'), /Gesamt: 102,00.€ von 100,00.€ \(102 %\)\n🍽️ Essen: 42,00.€ von 50,00.€ \(84 %\)/);
  assert.match(await handle(U, 'budget essen aus'), /Budget für Essen entfernt/);
  assert.match(await handle(U, 'budget aus'), /Monatsbudget entfernt/);
  assert.equal(await handle(U, 'Budget für Urlaub planen', { quiet: true }), null);
});

test('expenses export as a table Excel opens, without formulas', async () => {
  const { handle } = withClock();
  await handle(U, 'ausgabe 12,50 essen =HYPERLINK("x")');
  const reply = await handle(U, 'ausgaben export');
  assert.equal(reply.file.name, 'ausgaben.csv');
  const csv = reply.file.data.toString('utf8');
  assert.match(csv, /^﻿"Nr\.";"Datum";"Betrag"/);
  assert.match(csv, /1;23\.11\.2026;12,50;"EUR";"Essen";"'=HYPERLINK\(""x""\)"/);
});

test('last month comes on the 1st, once', async () => {
  const { handle, db, clock, alerts } = withClock();
  await handle(U, 'ausgabe 40 essen');
  const run = handle.queueMonthlyExpenses;
  clock.now = local(2026, 11, 1, 8, 59);
  run(clock.now);
  assert.equal(alerts().length, 0);
  clock.now = local(2026, 11, 1, 9, 0);
  run(clock.now);
  run(clock.now + 3_600_000);
  run(local(2026, 11, 2, 10, 0));
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0], /Dein Monat: Ausgaben November 2026\*\n\nGesamt: \*40,00.€\*/);
  // Nobody else gets one.
  assert.deepEqual(db.queued().map((row) => row.user), [U]);
});

// Birthdays
test('birthdays are read in many ways', () => {
  assert.deepEqual(parseBirthday('Anna 12.3.1990', MONDAY), { name: 'Anna', day: 12, month: 3, year: 1990 });
  assert.deepEqual(parseBirthday('12.03. Anna Müller', MONDAY), { name: 'Anna Müller', day: 12, month: 3, year: null });
  assert.deepEqual(parseBirthday('Opa am 3. Oktober 1940', MONDAY), { name: 'Opa', day: 3, month: 10, year: 1940 });
  assert.deepEqual(parseBirthday('Max 29.2.2000', MONDAY), { name: 'Max', day: 29, month: 2, year: 2000 });
  assert.deepEqual(parseBirthday('Tim 1.5.95', MONDAY), { name: 'Tim', day: 1, month: 5, year: 1995 });
  assert.deepEqual(parseBirthday('Lea 1.5.15', MONDAY), { name: 'Lea', day: 1, month: 5, year: 2015 });
  assert.match(parseBirthday('Max 29.2.2001', MONDAY).error, /gibt es nicht/);
  assert.match(parseBirthday('Baby 1.1.2030', MONDAY).error, /Geburtsjahr/);
  assert.equal(parseBirthday('Anna', MONDAY), null);
  assert.equal(parseBirthday('12.3.', MONDAY), null);
});

test('birthdays: save, change, list by next date, delete and undo', async () => {
  const { handle, db } = withClock();
  assert.match(await handle(U, 'geburtstage'), /Noch keine Geburtstage/);
  assert.match(await handle(U, 'geburtstag Anna 12.3.1990'), /Gespeichert: \*Anna\*, 12\.03\.1990\nNächster Geburtstag am Fr 12\.03\., in 109 Tagen \(wird 37\)/);
  assert.match(await handle(U, 'geburtstag Max 25.11.'), /am Mi 25\.11\., in 2 Tagen\./);
  assert.match(await handle(U, 'Geburtstag Oma 23.11.1950'), /heute! 🎉 \(wird 76\)/);
  assert.match(await handle(U, 'geburtstag anna 13.3.1990'), /Geändert: \*Anna\*, 13\.03\.1990/);
  assert.equal(db.birthdays(U).length, 3);

  assert.equal(await handle(U, 'geburtstage'), [
    '🎂 *Geburtstage* (3)',
    '*3.* Oma – Mo 23.11., 🎉 heute, wird 76',
    '*2.* Max – Mi 25.11., in 2 Tagen',
    '*1.* Anna – Sa 13.03., in 110 Tagen, wird 37',
    '',
    '_Löschen:_ `geburtstag weg 3`',
  ].join('\n'));
  assert.match(await handle(U, 'geburtstag weg 2'), /gelöscht: \*Max\*/);
  assert.match(await handle(U, 'rückgängig'), /wieder da: \*Max\*/);
  assert.equal(await handle(U, 'geburtstag Anna'), '🎂 *Anna*: 13.03., nächstes Mal am Sa 13.03., in 110 Tagen (wird 37)');
  assert.match(await handle(U, 'wann hat anna geburtstag?'), /\*Anna\*: 13\.03\./);
  assert.match(await handle(U, 'geburtstag Zoe'), /Von \*Zoe\* kenne ich keinen Geburtstag/);
  assert.match(await handle(U, 'geburtstag 12345'), /So geht es/);
  assert.equal(await handle(U, 'Geburtstag von Tim planen', { quiet: true }), null);
});

test('29 February is celebrated on the 28th in other years', async () => {
  const { handle } = withClock(local(2027, 1, 20, 12, 0));
  assert.match(await handle(U, 'geburtstag Max 29.2.2000'), /am So 28\.02\., in 8 Tagen \(wird 27\)/);
});

test('birthday messages come at 9 on the day and 3 days before, once each', async () => {
  const { handle, db, alerts } = withClock(local(2026, 10, 20, 12, 0));
  await handle(U, 'geburtstag Anna 26.11.1990');
  await handle(U, 'geburtstag Max 23.11.');
  queueBirthdays(db, local(2026, 10, 23, 8, 59));
  assert.equal(alerts().length, 0);
  queueBirthdays(db, local(2026, 10, 23, 9, 0));
  queueBirthdays(db, local(2026, 10, 23, 18, 0));
  assert.deepEqual(alerts(), [
    '🎁 In 3 Tagen, am Do 26.11., hat *Anna* Geburtstag (wird 36). Schon ein Geschenk?',
    '🎂 Heute hat *Max* Geburtstag!',
  ]);
  queueBirthdays(db, local(2026, 10, 26, 9, 30));
  assert.equal(alerts()[2], '🎂 Heute hat *Anna* Geburtstag! (wird heute 36)');
  assert.equal(alerts().length, 3);
});

test('birthdays appear in the agenda and the briefing', async () => {
  const { handle } = withClock(local(2026, 10, 23, 7, 0));
  await handle(U, 'geburtstag Oma 23.11.1950');
  await handle(U, 'geburtstag Max 26.11.');
  await handle(U, 'geburtstag Anna 12.3.1990');
  const agenda = await handle(U, 'termine');
  assert.match(agenda, /\*Heute, Mo 23\.11\.\*\n🎂 Oma \(76\)/);
  assert.match(agenda, /\*Do 26\.11\.\*\n🎂 Max/);
  assert.doesNotMatch(agenda, /Anna/);
  const briefing = await handle(U, 'briefing');
  assert.match(briefing, /📅 \*Heute\*\n🎂 Oma \(76\)/);
  assert.match(briefing, /🎁 \*Bald Geburtstag\*\nDo 26\.11\.: Max/);
  assert.doesNotMatch(briefing, /Anna/);
});
