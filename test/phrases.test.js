import assert from 'node:assert/strict';
import test from 'node:test';
import { fold, parseInput } from '../src/input.js';
import { rephrase } from '../src/phrases.js';
import { setup } from './helpers.js';

const SILENT = { silent: true };

// Sentence → the command it stands for.
const SENTENCES = [
  ['was muss ich einkaufen?', 'einkauf'],
  ['Was brauchen wir noch', 'einkauf'],
  ['was steht auf der Einkaufsliste', 'einkauf'],
  ['zeig mir die Einkaufsliste', 'einkauf'],
  ['meine Einkaufsliste bitte', 'einkauf'],
  ['Milch auf die Einkaufsliste', 'einkauf Milch'],
  ['füge Milch zur Einkaufsliste hinzu', 'einkauf Milch'],
  ['fuege Eier zur einkaufsliste hinzu', 'einkauf Eier'],
  ['setz Brot und Butter auf die Liste', 'einkauf Brot, Butter'],
  ['schreib Steuer und Versicherung auf die Todo-Liste', 'todo Steuer und Versicherung'],
  ['noch Käse auf den Einkaufszettel', 'einkauf Käse'],
  ['streiche Milch von der Einkaufsliste', 'erledigt Milch'],
  ['Milch von der Liste nehmen', 'erledigt Milch'],
  ['lösche die Einkaufsliste', 'einkauf leeren'],
  ['Milch erledigt', 'erledigt Milch'],
  ['Steuer ist erledigt ✅', 'erledigt Steuer'],
  ['hab Milch gekauft', 'erledigt Milch'],
  ['Brot gekauft', 'erledigt Brot'],
  ['hab 3 gekauft', 'gekauft 3'],
  ['das ist erledigt', null, SILENT],
  ['was muss ich heute noch erledigen', 'todo'],
  ['was ist noch offen', 'todo'],
  ['meine todos', 'todo'],
  ['welche Aufgaben habe ich', 'todo'],
  ['meine Listen', 'listen'],
  ['meine Erinnerungen', 'erinnerungen'],
  ['zeig mir bitte alle Erinnerungen', 'erinnerungen'],
  ['welche Erinnerungen habe ich?', 'erinnerungen'],
  ['kannst du mich morgen früh an den Müll erinnern?', 'erinnere mich morgen früh an den Müll'],
  ['bitte mich in 10 Minuten an den Herd erinnern', 'erinnere mich in 10 Minuten an den Herd'],
  ['könntest du mich morgen um 9 an Arzt erinnern', 'erinnere mich morgen um 9 an Arzt'],
  ['koenntest du mich naechste woche an Reifen erinnern', 'erinnere mich nächste woche an Reifen'],
  ['weck mich morgen um 7', 'erinnere mich morgen um 7 an Aufstehen ⏰'],
  ['neue Erinnerung morgen 9 Arzt', 'Erinnerung morgen 9 Arzt'],
  ['neue Notiz: Code 1234', 'Notiz: Code 1234'],
  ['merk dir: Parkplatz Ebene 3', 'notiz Parkplatz Ebene 3'],
  ['Merke dir Hotel Zimmer 214', 'notiz Hotel Zimmer 214'],
  ['schreib dir auf: Schuhgröße 43', 'notiz Schuhgröße 43'],
  ['meine Notizen', 'notizen'],
  ['such nach wlan', 'suche wlan'],
  ['was steht heute an?', 'briefing'],
  ['wie sieht mein Tag aus', 'briefing'],
  ['mein Tag', 'briefing'],
  ['was steht morgen an', 'termine morgen'],
  ['was habe ich übermorgen vor', 'termine übermorgen'],
  ['was hab ich diese Woche', 'termine diese Woche'],
  ['welche Termine habe ich morgen', 'termine morgen'],
  ['meine Termine', 'termine'],
  ['wie wird das Wetter?', 'wetter'],
  ['wie wird das wetter morgen in Graz', 'wetter morgen Graz'],
  ['wie wird das Wetter in Wien morgen?', 'wetter morgen Wien'],
  ['regnet es morgen', 'wetter morgen'],
  ['brauche ich einen Schirm', 'wetter'],
  ['wie kalt ist es draussen', 'wetter'],
  ['wann hat Anna Geburtstag?', 'geburtstag Anna'],
  ['Anna hat am 12.3. Geburtstag', 'geburtstag Anna 12.3.'],
  ['Tim hat Geburtstag am 3. Mai', 'geburtstag Tim 3. Mai'],
  ['meine Geburtstage', 'geburtstage'],
  ['wie viel habe ich diesen Monat ausgegeben', 'ausgaben diesen Monat'],
  ['wieviel hab ich für Essen ausgegeben', 'ausgaben Essen'],
  ['ich habe heute 20 Euro für Tanken ausgegeben', 'ausgabe 20 Euro Tanken'],
  ['12,50 für Pizza bezahlt', 'ausgabe 12,50 Pizza'],
  ['meine Ausgaben im Oktober', 'ausgaben im Oktober'],
  ['wie viel habe ich gespart', 'ersparnis'],
  ['was ist 12 mal 3', 'rechne 12 mal 3'],
  ['wie viel ist 100 geteilt durch 7?', 'rechne 100 geteilt durch 7'],
  ['was sind 50 Euro in Franken', '50 Euro in Franken'],
  ['wie viel sind 100 Dollar in Euro?', '100 Dollar in Euro'],
  ['12*3', 'rechne 12*3'],
  ['250 + 19%', 'rechne 250 + 19%'],
  ['3 x 4', 'rechne 3 x 4'],
  ['was beobachtest du', 'produkte'],
  ['meine Produkte', 'produkte'],
  ['was kannst du?', 'hilfe'],
  ['wie funktioniert das hier', 'hilfe'],
  ['mach das rückgängig', 'rückgängig'],
  ['Rückgängig machen!', 'rückgängig'],
  ['Guten Morgen!', 'hallo'],
  ['hallo Bot', 'hallo'],
  ['Vielen Dank!', 'danke'],
  ['danke dir 🙏', 'danke'],
  ['To Do', 'todo'],
  ['wird es morgen regnen?', 'wetter morgen'],
  ['wann ist der Geburtstag von Anna', 'geburtstag Anna'],
  ['Tschüss!', null, { answer: 'Bis bald! 👋' }],
  ['gute Nacht', null, { answer: 'Gute Nacht! 🌙' }],
  ['wie spät ist es?', null, { clock: true }],
  ['ok', null, SILENT],
  ['Alles klar!', null, SILENT],
  ['👍', null, SILENT],
  ['❤️🙏', null, SILENT],
  // Openers, as in voice messages
  ['Hallo, erinnere mich morgen an den Zahnarzt', 'erinnere mich morgen an den Zahnarzt'],
  ['Ähm, was muss ich einkaufen?', 'einkauf'],
  ['Okay, schreib Milch und Eier auf die Einkaufsliste', 'einkauf Milch, Eier'],
  ['Hey Bot, wie wird das Wetter?', 'wetter'],
  ['Hey, kannst du mich morgen um 8 an den Termin erinnern?', 'erinnere mich morgen um 8 an den Termin'],
  ['Ok, danke', 'danke'],
  ['kannst du mich morgen daran erinnern, die Wäsche aufzuhängen?', 'erinnere mich morgen daran, die Wäsche aufzuhängen'],
  ['Merk dir, dass der Schlüssel beim Nachbarn ist', 'notiz der Schlüssel beim Nachbarn ist'],
  ['Notiere, dass Tim 5 € bekommt', 'notiz Tim 5 € bekommt'],
  ['was habe ich morgen für Termine?', 'termine morgen'],
  ['habe ich am Wochenende was vor?', 'termine am Wochenende'],
  ['was habe ich heute für Termine', 'briefing'],
  ['was ist auf meiner Einkaufsliste?', 'einkauf'],
  ['was steht noch auf meiner To-do-Liste', 'todo'],
  ['was fehlt noch?', 'einkauf'],
];

// Only in chats with the bot: in the self-chat these could be diary entries.
const CHAT_ONLY = [
  ['ich brauche noch Milch und Brot', 'einkauf Milch, Brot'],
  ['wir brauchen Klopapier', 'einkauf Klopapier'],
  ['die Milch ist alle', 'einkauf Milch'],
  ['ich muss noch die Steuererklärung machen', 'todo die Steuererklärung machen'],
];
for (const [sentence, command] of CHAT_ONLY) {
  test(`rephrase "${sentence}" only in chats`, () => assert.deepEqual(rephrase(sentence), { text: command, sure: false, chatOnly: true }));
}
for (const text of ['ich brauche Urlaub', 'ich brauche hilfe', 'ich muss los', 'mein Akku ist leer']) {
  test(`rephrase is no list entry: "${text}"`, () => assert.equal(rephrase(text)?.chatOnly, undefined));
}

for (const [sentence, command, special] of SENTENCES) {
  test(`rephrase "${sentence}"`, () => {
    const result = rephrase(sentence);
    if (special) assert.deepEqual(result, special);
    else assert.equal(result?.text, command);
  });
}

// Already commands, or notes: left as they are.
const UNCHANGED = [
  'einkauf Milch', 'todo Steuer erledigt', 'erledigt 3', 'erinnere mich morgen 9 an Arzt', 'notiz Rezept', 'wetter Wien', 'termine morgen',
  'liste', 'zeige 3', 'löschen 2', '3 ziel 80', 'Milch kaufen', 'liste für morgen', 'Tomaten kaufen', 'finde ich gut',
  'Termin beim Arzt morgen 10', 'meine Termine sind voll', 'meine Gedanken zum Urlaub', '2026-11-24', '+49 170 1234567',
  '0170 1234567', '3/4 Liter Milch', '24.12. Weihnachten', '10:30 Zahnarzt', '3 Äpfel 2 Birnen', '12,50 essen',
];
for (const text of UNCHANGED) {
  test(`rephrase leaves "${text}"`, () => assert.equal(rephrase(text), null));
}

test('command words without umlauts or with capitals', () => {
  assert.equal(fold('Rückgängig'), fold('rueckgaengig'));
  for (const [text, action] of [
    ['rueckgaengig', 'undo'], ['ruckgangig', 'undo'], ['LÖSCHEN 3', 'remove'], ['loesche 3', 'remove'], ['spaeter', 'snooze'],
    ['Uebersicht', 'report'], ['pruefen 2', 'check'], ['Einkaeufe', 'shopping'], ['Einkaufszettel', 'shopping'], ['tagesuebersicht', 'briefing'],
    ['Hallöchen', 'hello'], ['Dankeschön', 'thanks'], ['Memo Code 1234', 'note'], ['Tasks', 'todo'], ['hak 3 ab', 'done'],
    ['Haushaltsbuch', 'expenses'], ['erinere mich morgen an Arzt', 'remind'], ['erinnr mich', 'remind'], ['notizn', 'notes'], ['Vorhersage', 'weather'], ['Taschenrechner 2+2', 'calc'], ['Preise', 'list'],
  ]) {
    assert.equal(parseInput(text)?.action, action, text);
  }
});

test('self-chat: sentences meant for the bot answer, notes stay silent', async () => {
  const { handle } = setup({}, { now: () => new Date('2026-11-24T15:00:00').getTime() });
  const U = '491701234567';
  await handle(U, 'einkauf Milch, Brot');
  await handle(U, 'notiz WLAN Gäste: sonne123');

  assert.match(await handle(U, 'was muss ich einkaufen?', { quiet: true }), /Milch/);
  assert.match(await handle(U, '12*3', { quiet: true }), /36/);
  assert.match(await handle(U, 'Milch auf die Einkaufsliste', { quiet: true }), /Steht schon drauf: Milch/);
  for (const note of ['Hab heute 20 Euro für Pizza ausgegeben', 'Rechnung 120 bezahlt', 'Notizen zum Meeting: Budget 300', 'Ort: Café Central um 8',
    'ok', 'ja', '👍', 'das ist erledigt', 'wo ist mein Schlüssel', 'Projekt fertig', 'Lisa hat am Samstag Geburtstag']) {
    assert.equal(await handle(U, note, { quiet: true }), null, note);
  }
  assert.equal(await handle(U, 'ausgaben', { quiet: true }).then((reply) => /Noch nichts eingetragen/.test(reply)), true, 'no expense from a diary entry');
});

test('chat: "ja" accepts a suggestion, unknown questions find notes', async () => {
  const { handle } = setup({}, { now: () => new Date('2026-11-24T15:00:00').getTime() });
  const U = '491701234567';
  await handle(U, 'notiz WLAN Gäste: sonne123');
  assert.match(await handle(U, 'notizne'), /Meintest du `notizen`\? Dann schick `ja`/);
  assert.match(await handle(U, 'ja'), /WLAN Gäste/);
  assert.equal(await handle(U, 'ja'), null, 'only once');
  assert.match(await handle(U, 'wo ist mein wlan passwort?'), /Meinst du das\?[\s\S]*Notiz 1:\* WLAN Gäste/);
  assert.match(await handle(U, 'Hab heute 20 Euro für Pizza ausgegeben'), /20,00.€.*Pizza/);
  assert.equal(await handle(U, 'ok'), null);
  assert.equal(await handle(U, 'gute Nacht'), 'Gute Nacht! 🌙');
  assert.equal(await handle(U, 'gute Nacht', { quiet: true }), null, 'a diary line in the self-chat');
  assert.equal(await handle(U, 'wie spät ist es?'), '🕐 15:00 Uhr, Dienstag, 24. November 2026');
});

test('greeting: the long welcome once, then short', async () => {
  const { handle } = setup({}, { now: () => new Date('2026-11-24T08:00:00').getTime() });
  const U = '491701234567';
  assert.match(await handle(U, 'hallo'), /ich bin dein Alltagshelfer/);
  assert.equal(await handle(U, 'Guten Morgen!'), 'Guten Morgen! 👋\nDein Tag: `briefing` · alle Befehle: `hilfe`');
});

test('agenda for one day, weather with a day, list falls back to shopping', async () => {
  const { handle } = setup({}, { now: () => new Date('2026-11-24T15:00:00').getTime() });
  const U = '491701234567';
  await handle(U, 'erinnere mich morgen 9 an Arzt');
  assert.equal(await handle(U, 'was steht morgen an?'), '📅 *Morgen, Mi 25.11.*\n⏰ 09:00 Arzt\n\n_Kalender verbinden: `kalender` und dein iCal-Link_');
  assert.match(await handle(U, 'termine übermorgen'), /Übermorgen: keine Erinnerungen/);
  assert.match(await handle(U, 'wie wird das wetter morgen in wien'), /^\S+ \*Wien morgen:\*[\s\S]*Wien heute/);
  assert.match(await handle(U, 'wetter wien'), /^\S+ \*Wien heute[\s\S]*Morgen:/);
  assert.match(await handle(U, 'wetter morgen'), /Für welchen Ort/);
  assert.match(await handle(U, 'liste'), /Du beobachtest noch nichts/);
  await handle(U, 'einkauf Milch, Eier und Butter');
  assert.match(await handle(U, 'liste'), /Einkaufsliste\* \(3\)[\s\S]*Butter[\s\S]*Produktlink/);
  assert.match(await handle(U, 'meine produkte'), /Du beobachtest noch nichts/);
  assert.match(await handle(U, 'rechne 2 hoch 10'), /= \*1\.024\*/);
  assert.match(await handle(U, 'was ist 19 prozent von 250'), /= \*47,5\*/);
});
