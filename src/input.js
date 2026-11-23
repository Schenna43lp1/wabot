// Turns what people really type into commands. Never guesses at amounts.
import { parsePrice } from './money.js';

const WORDS = {
  help: ['hilfe', 'help', '/help', 'befehle', 'menü', '?'],
  hello: ['hallo', 'hi', 'hey', 'moin', 'servus', 'start', '/start'],
  thanks: ['danke', 'thx', 'thanks'],
  list: ['liste', 'list', '/list', 'produkte'],
  undo: ['rückgängig', 'rueckgängig', 'rueckgaengig', 'undo'],
  show: ['zeige', 'zeig', 'info'],
  check: ['prüfen', 'prüfe', 'prüf', 'pruefen', 'pruefe', 'check'],
  target: ['ziel', 'zielpreis'],
  history: ['verlauf'],
  remove: ['löschen', 'lösche', 'lösch', 'loeschen', 'loesche', 'delete', 'entfernen', 'entferne'],
  selector: ['selektor', 'selector'],
  pause: ['pause', 'pausiere', 'pausieren'],
  resume: ['weiter', 'fortsetzen'],
  rename: ['name', 'umbenennen'],
  threshold: ['schwelle'],
  quietHours: ['ruhe', 'ruhezeit'],
  report: ['übersicht', 'uebersicht', 'zusammenfassung'],
  export: ['export', 'exportieren', 'csv'],
  purchase: ['gekauft', 'bestellt'],
  savings: ['ersparnis', 'gespart', 'bilanz'],
  chart: ['diagramm', 'grafik', 'chart'],
  // Everyday helper
  remind: ['erinnere', 'erinner', 'erinnern', 'erinnerung', 'remind'],
  reminders: ['erinnerungen'],
  calendar: ['kalender', 'calendar', 'termine', 'agenda'],
  birthday: ['geburtstag', 'geburtstage', 'gebtag'],
  calc: ['rechne', 'berechne', 'rechner', 'calc'],
  tip: ['trinkgeld'],
  convert: ['umrechnen', 'umrechnung', 'wechselkurs'],
  rate: ['kurs'],
  expense: ['ausgabe', 'ausgegeben'],
  expenses: ['ausgaben'],
  budget: ['budget'],
  snooze: ['später', 'spaeter', 'snooze'],
  shopping: ['einkauf', 'einkaufen', 'einkaufsliste'],
  todo: ['todo', 'todos', 'to-do', 'to-dos', 'aufgabe', 'aufgaben'],
  done: ['erledigt', 'done', 'abhaken', 'abgehakt'],
  note: ['notiz', 'notiere', 'notieren', 'merke', 'merk'],
  notes: ['notizen'],
  search: ['suche', 'such', 'suchen'],
  weather: ['wetter'],
  place: ['ort', 'wohnort', 'standort'],
  briefing: ['briefing', 'tagesbriefing', 'morgenbriefing', 'tagesplan'],
};
const ACTIONS = new Map(Object.entries(WORDS).flatMap(([action, words]) => words.map((word) => [word, action])));
const NEEDS_PRODUCT = new Set(['show', 'check', 'target', 'history', 'remove', 'selector', 'pause', 'resume', 'rename', 'threshold', 'purchase', 'chart']);
const TAKES_ALL = new Set(['pause', 'resume']);
const TAKES_SETTING = new Set(['quietHours', 'report']);
const NEEDS_VALUE = new Set(['selector', 'rename', 'threshold']);
// These take free text, links included: "notiz Rezept https://…" is a note, not a product.
export const FREE_TEXT = new Set(['remind', 'reminders', 'snooze', 'shopping', 'todo', 'done', 'note', 'notes', 'search', 'weather', 'place', 'briefing', 'calendar', 'birthday', 'calc', 'tip', 'convert', 'rate', 'expense', 'expenses', 'budget', 'help']);

// Only these are suggested for typos.
const SUGGESTED = ['hilfe', 'liste', 'rückgängig', 'zeige', 'prüfen', 'ziel', 'verlauf', 'löschen', 'selektor', 'pause', 'schwelle', 'übersicht', 'export', 'gekauft', 'ersparnis', 'diagramm',
  'erinnerungen', 'einkauf', 'erledigt', 'notiz', 'notizen', 'wetter', 'briefing', 'kalender', 'termine', 'geburtstage', 'rechne', 'trinkgeld', 'ausgabe', 'ausgaben', 'budget'];

const LINK = /https?:\/\/[^\s<>]+/gi;
// "3", "#3", "3.", "3:", "nr. 3", "nummer 3"
const PRODUCT_NUMBER = /^(?:(?:nr\.?|nummer)\s*|#)?(\d{1,9})(?:[.:)!?](?=\s|$)|(?=\s|$))\s*/i;

export const actionOf = (word) => ACTIONS.get(word.toLowerCase());

/** Removes punctuation that belongs to the sentence, not to the link. */
export function cleanLink(raw) {
  let link = raw;
  for (;;) {
    const last = link.at(-1);
    const unopened =
      (last === ')' && link.split('(').length < link.split(')').length) ||
      (last === ']' && link.split('[').length < link.split(']').length);
    if (!unopened && !'.,;:!?"\''.includes(last)) return link;
    link = link.slice(0, -1);
  }
}

/** All links, each with the text that follows it up to the next link. */
export function findLinks(text) {
  const found = [...text.matchAll(LINK)];
  return found.map((match, i) => {
    const link = cleanLink(match[0]);
    const after = text.slice(match.index + match[0].length, found[i + 1]?.index);
    return { link, after: after.trim() };
  });
}

/**
 * Returns one of
 *   { action, ref?, value }  a command; ref is { id }, { link } or { all: true }
 *   { action: 'add', links } links to track
 *   null                     anything else
 */
export function parseInput(input) {
  let text = input.trim();
  // "liste bitte", "bitte löschen 3"
  const polite = text.replace(/^bitte\s+|\s+bitte[.!]*$/gi, '');
  if (actionOf(polite.split(/\s+/)[0])) text = polite;
  if (text === '?') return { action: 'help' };

  const first = text.split(/\s+/)[0];
  const action = actionOf(first.replace(/[!?.,:]+$/, ''));
  const rest = text.slice(first.length).trim();

  if (FREE_TEXT.has(action)) return { action, value: rest.replace(/^[:\-–]\s*/, '') };

  if (action && TAKES_ALL.has(action) && /^alle[s]?[.!]?$/i.test(rest)) {
    return { action, ref: { all: true }, value: '' };
  }
  // With a link it is a shared product, e.g. "Übersicht https://..."
  if (action && TAKES_SETTING.has(action) && !findLinks(rest).length) {
    return { action, value: rest.replace(/[!?.]+$/, '') };
  }
  if (action && NEEDS_PRODUCT.has(action)) {
    const number = rest.match(PRODUCT_NUMBER);
    if (number) {
      const value = rest.slice(number[0].length).trim();
      return { action, ref: { id: Number(number[1]) }, value };
    }

    const links = findLinks(rest);
    // Deleting may mention the link anywhere. The others need it up front,
    // because shared texts like "Check out this deal https://..." mean "add".
    if (links.length && (action === 'remove' || /^https?:\/\//i.test(rest))) {
      return { action, ref: { link: links[0].link }, value: links[0].after };
    }
    if (!rest) return { action, value: '' };
  } else if (action && !rest.replace(/[!?.]+/g, '')) {
    return { action };
  }

  const links = findLinks(text);
  if (links.length) return { action: 'add', links };

  // "3 löschen", "3 ziel 80"
  const reversed = text.match(/^(?:nr\.?\s*|#)?(\d{1,9})\s+(\S+)\s*(.*)$/i);
  if (reversed) {
    const [, id, word, value] = reversed;
    const verb = actionOf(word);
    if (verb === 'target' ? parseTarget(value) : NEEDS_PRODUCT.has(verb) && !NEEDS_VALUE.has(verb) && !value) {
      return { action: verb, ref: { id: Number(id) }, value };
    }
  }

  const bare = text.match(/^(?:nr\.?\s*|#)?(\d{1,9})$/i);
  return bare ? { action: 'number', ref: { id: Number(bare[1]) } } : null;
}

/** "89,90", "unter 80 €" or "-10%". Anything with other words in it is null. */
export function parseTarget(input) {
  const text = input.trim()
    .replace(/^ziel(?:preis)?:?\s*/i, '')
    .replace(/^(?:auf|unter|bis|max\.?|maximal|höchstens|<=?)\s*/i, '')
    .replace(/[!?]+$/, '')
    .replace(/(\d)\.$/, '$1');

  const percent = text.match(/^[-−–]?\s*(\d{1,2}(?:[.,]\d)?)\s*(?:%|prozent)$/i);
  if (percent) {
    const value = Number(percent[1].replace(',', '.'));
    return value > 0 ? { percent: value } : null;
  }

  if (!/^(?:€|eur\s|chf\s|\$|£)?\s*\d[\d.,'’ ]*[-–—]?\s*(?:€|eur|euro|chf|usd|\$|£)?$/i.test(text)) return null;
  // "80-" is a typo, "80,-" is a price.
  if (/\d\s*[-–—]/.test(text)) return null;
  const cents = parsePrice(text)?.cents;
  return cents ? { cents } : null;
}

export function suggest(input) {
  const [word, ...rest] = input.trim().toLowerCase().split(/\s+/);
  if (word.length < 4 || actionOf(word) || rest.join(' ').length > 30) return null;
  let best = null;
  let bestDistance = word.length < 7 ? 2 : 3;
  for (const command of SUGGESTED) {
    const d = distance(word, command);
    if (d < bestDistance) [best, bestDistance] = [command, d];
  }
  if (!best) return null;
  const suggestion = [best, ...rest].join(' ');
  return parseInput(suggestion) ? suggestion : null;
}

/** Edit distance, counting two swapped letters as one mistake. */
function distance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      let best = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, rows[i - 2][j - 2] + 1);
      rows[i][j] = best;
    }
  }
  return rows[a.length][b.length];
}
