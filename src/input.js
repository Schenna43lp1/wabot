// Turns what people really type into commands. Never guesses at amounts.
import { parsePrice } from './money.js';

// Every spelling is folded first (see fold), so "loeschen", "LÖSCHEN" and "löschen" are one word.
const WORDS = {
  help: ['hilfe', 'hilf', 'help', '/help', 'befehle', 'befehl', 'kommandos', 'commands', 'anleitung', 'menü', '?'],
  hello: ['hallo', 'hallöchen', 'hallihallo', 'hello', 'hi', 'hey', 'hej', 'huhu', 'moin', 'moinsen', 'servus', 'tach', 'grüezi', 'yo', 'start', '/start'],
  thanks: ['danke', 'dankeschön', 'danki', 'dankee', 'merci', 'thx', 'thanks', 'thank', 'ty'],
  list: ['liste', 'list', '/list', 'produkte', 'preise', 'preisliste', 'watchlist'],
  undo: ['rückgängig', 'undo', 'wiederherstellen'],
  show: ['zeige', 'zeig', 'info', 'details'],
  check: ['prüfen', 'prüfe', 'prüf', 'check'],
  target: ['ziel', 'zielpreis'],
  history: ['verlauf'],
  remove: ['löschen', 'lösche', 'lösch', 'delete', 'entfernen', 'entferne'],
  selector: ['selektor', 'selector'],
  pause: ['pause', 'pausiere', 'pausieren'],
  resume: ['weiter', 'fortsetzen'],
  rename: ['name', 'umbenennen'],
  threshold: ['schwelle'],
  quietHours: ['ruhe', 'ruhezeit'],
  report: ['übersicht', 'zusammenfassung'],
  export: ['export', 'exportieren', 'csv'],
  purchase: ['gekauft', 'bestellt'],
  savings: ['ersparnis', 'gespart', 'erspartes', 'bilanz'],
  chart: ['diagramm', 'grafik', 'chart'],
  // Everyday helper
  remind: ['erinnere', 'erinner', 'erinnern', 'erinnerung', 'remind', 'reminder', 'erinere', 'erinre', 'erinnr', 'erinnre', 'erinnerr'],
  reminders: ['erinnerungen', 'reminders', 'erinnerungsliste'],
  calendar: ['kalender', 'calendar', 'termine', 'terminkalender', 'agenda'],
  birthday: ['geburtstag', 'geburtstage', 'gebtag', 'bday', 'birthday'],
  calc: ['rechne', 'rechnen', 'berechne', 'berechnen', 'ausrechnen', 'rechner', 'taschenrechner', 'calc'],
  tip: ['trinkgeld'],
  convert: ['umrechnen', 'umrechnung', 'wechselkurs', 'wechselkurse', 'konvertiere'],
  rate: ['kurs'],
  expense: ['ausgabe', 'ausgegeben'],
  expenses: ['ausgaben', 'haushaltsbuch'],
  budget: ['budget'],
  snooze: ['später', 'snooze'],
  shopping: ['einkauf', 'einkaufen', 'einkaufsliste', 'einkaufszettel', 'einkäufe', 'shopping', 'shoppingliste'],
  todo: ['todo', 'todos', 'to-do', 'to-dos', 'todoliste', 'to-do-liste', 'aufgabe', 'aufgaben', 'aufgabenliste', 'task', 'tasks'],
  done: ['erledigt', 'done', 'abhaken', 'abgehakt', 'hak', 'hake', 'streiche', 'streichen', 'geschafft', 'fertig'],
  note: ['notiz', 'notiere', 'notier', 'notieren', 'merke', 'merk', 'merken', 'note', 'memo'],
  notes: ['notizen', 'notizn', 'notes', 'memos'],
  lists: ['listen'],
  search: ['suche', 'such', 'suchen', 'search'],
  weather: ['wetter', 'weather', 'wetterbericht', 'wettervorhersage', 'vorhersage'],
  place: ['ort', 'wohnort', 'standort'],
  briefing: ['briefing', 'tagesbriefing', 'morgenbriefing', 'tagesplan', 'tagesübersicht'],
};

/** Lower case without umlauts: "Rückgängig", "rueckgaengig" and "ruckgangig" are the same. */
export function fold(word) {
  return word.toLowerCase().replace(/ä|ae/g, 'a').replace(/ö|oe/g, 'o').replace(/ü|ue/g, 'u').replace(/ß/g, 'ss');
}

const ACTIONS = new Map(Object.entries(WORDS).flatMap(([action, list]) => list.map((word) => [fold(word), action])));
const NEEDS_PRODUCT = new Set(['show', 'check', 'target', 'history', 'remove', 'selector', 'pause', 'resume', 'rename', 'threshold', 'purchase', 'chart']);
const TAKES_ALL = new Set(['pause', 'resume']);
const TAKES_SETTING = new Set(['quietHours', 'report']);
const NEEDS_VALUE = new Set(['selector', 'rename', 'threshold']);
// These take free text, links included: "notiz Rezept https://…" is a note, not a product.
export const FREE_TEXT = new Set(['remind', 'reminders', 'snooze', 'shopping', 'todo', 'done', 'note', 'notes', 'search', 'weather', 'place', 'briefing', 'calendar', 'birthday', 'calc', 'tip', 'convert', 'rate', 'expense', 'expenses', 'budget', 'help']);

// Only these are suggested for typos.
const SUGGESTED = ['hilfe', 'liste', 'rückgängig', 'zeige', 'prüfen', 'ziel', 'verlauf', 'löschen', 'selektor', 'pause', 'schwelle', 'übersicht', 'export', 'gekauft', 'ersparnis', 'diagramm',
  'erinnerungen', 'erinnere', 'einkauf', 'einkaufsliste', 'erledigt', 'notiz', 'notizen', 'suche', 'wetter', 'briefing', 'kalender', 'termine', 'geburtstag', 'geburtstage',
  'rechne', 'trinkgeld', 'umrechnen', 'ausgabe', 'ausgaben', 'budget', 'aufgaben', 'listen', 'später'];

const LINK = /https?:\/\/[^\s<>]+/gi;
// "3", "#3", "3.", "3:", "nr. 3", "nummer 3"
const PRODUCT_NUMBER = /^(?:(?:nr\.?|nummer)\s*|#)?(\d{1,9})(?:[.:)!?](?=\s|$)|(?=\s|$))\s*/i;

export const actionOf = (word) => ACTIONS.get(fold(word));

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
    const d = distance(fold(word), fold(command));
    if (d < bestDistance) [best, bestDistance] = [command, d];
  }
  if (!best) return null;
  const suggestion = [best, ...rest].join(' ');
  return parseInput(suggestion) ? suggestion : null;
}

/** Edit distance, counting two swapped letters as one mistake. */
export function distance(a, b) {
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
