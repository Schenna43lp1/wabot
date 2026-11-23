// "ausgabe 12,50 essen pizza", "ausgaben", "ausgaben oktober", "budget 800", "budget essen 200"
import { capitalize } from './schedule.js';
import { currencyOf, formatMoney, toCents } from './money.js';

const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const MAX_CATEGORY = 30;
const MAX_NOTE = 100;
const SHOWN = 5;
const OTHER = 'sonstiges';
const REMOVE = /^(weg|löschen|lösche|loeschen|entfernen)$/i;
const OFF = /^(aus|weg|kein|keine|löschen)$/i;
const ICONS = {
  essen: '🍽️', restaurant: '🍽️', lebensmittel: '🛒', einkauf: '🛒', supermarkt: '🛒', tanken: '⛽', auto: '🚗', sprit: '⛽',
  miete: '🏠', wohnen: '🏠', strom: '💡', haushalt: '🧹', freizeit: '🎉', sport: '⚽', kleidung: '👕', gesundheit: '💊',
  apotheke: '💊', drogerie: '🧴', geschenke: '🎁', geschenk: '🎁', urlaub: '✈️', reisen: '✈️', bahn: '🚆', öffis: '🚌',
  kinder: '🧸', haustier: '🐾', abo: '📺', abos: '📺', handy: '📱', technik: '💻', bildung: '📚', kaffee: '☕', [OTHER]: '📦',
};

const icon = (category) => ICONS[category] ?? '🏷️';
const label = (category) => `${icon(category)} ${capitalize(category)}`;
const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const monthKey = (year, month) => `${year}-${String(month + 1).padStart(2, '0')}`;

function monthRange(year, month) {
  return { from: new Date(year, month, 1).getTime(), to: new Date(year, month + 1, 1).getTime(), title: `${capitalize(MONTHS[month])} ${year}` };
}

/** "oktober", "okt 2025", "letzter monat", "2026" → { from, to, title } or null */
export function parsePeriod(text, now) {
  const today = new Date(now);
  const value = text.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (!value || /^(dieser|diesen|aktueller|aktuellen) monat$/.test(value)) return monthRange(today.getFullYear(), today.getMonth());
  if (/^(letzte[nr]?|vorige[nr]?) monat$|^vormonat$/.test(value)) {
    const date = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return monthRange(date.getFullYear(), date.getMonth());
  }
  const year = value.match(/^(?:jahr\s+)?(\d{4})$/)?.[1] ?? (/^(dieses )?jahr$/.test(value) ? String(today.getFullYear()) : null);
  if (year) return { from: new Date(Number(year), 0, 1).getTime(), to: new Date(Number(year) + 1, 0, 1).getTime(), title: `Jahr ${year}` };
  const match = value.match(/^([a-zä]{3,})\.?(?:\s+(\d{4}))?$/);
  if (!match) return null;
  const month = MONTHS.findIndex((name) => name.startsWith(match[1].replace('maerz', 'märz')) && match[1].length >= 3);
  if (month < 0) return null;
  // "oktober" in November means this year's, "dezember" in November last year's.
  let y = match[2] ? Number(match[2]) : today.getFullYear();
  if (!match[2] && month > today.getMonth()) y--;
  return monthRange(y, month);
}

/** "12,50 essen pizza", "essen 12,50", "12,50€ essen", "€12,50 essen" → { cents, currency, category, note } */
export function parseExpense(text, defaultCurrency) {
  const words = text.trim().replace(/(\d)([€$£])/g, '$1 $2').replace(/([€$£])(\d)/g, '$1 $2').split(/\s+/).filter(Boolean);
  const at = words.findIndex((word) => /^\d[\d.,]*(?:[.,][-–])?$/.test(word) && toCents(word));
  if (at < 0 || at > 2) return null;
  const cents = toCents(words[at]);
  let currency = null;
  const rest = [...words.slice(0, at), ...words.slice(at + 1)];
  // A currency right before or after the amount
  for (const index of [at - 1, at]) {
    const word = index === at ? words[at + 1] : words[index];
    const code = word && currencyOf(word);
    if (code && word.replace(/[.,]/g, '').length <= 4) {
      currency = code;
      rest.splice(rest.indexOf(word), 1);
      break;
    }
  }
  const [first, ...others] = rest;
  const category = (first ?? OTHER).toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '').slice(0, MAX_CATEGORY) || OTHER;
  const note = others.join(' ').replace(/[*_~`]/g, '').replace(/^[-–:]\s*/, '').trim().slice(0, MAX_NOTE);
  return { cents, currency: currency ?? defaultCurrency, category, note };
}

export function createExpenses({ db, config, now = Date.now }) {
  const home = config.currency;

  function budgetLines(user, at, category) {
    const budgets = db.budgets(user);
    const { from, to } = parsePeriod('', at);
    const lines = [];
    for (const budget of budgets) {
      if (category && budget.category && budget.category !== category) continue;
      const spent = db.expenseTotal(user, from, to, home, budget.category || null);
      const share = percent(spent, budget.cents);
      const what = budget.category ? `Budget ${capitalize(budget.category)}` : 'Monatsbudget';
      if (spent > budget.cents) lines.push(`🚨 ${what} überschritten: ${formatMoney(spent, home)} von ${formatMoney(budget.cents, home)}`);
      else if (share >= 80) lines.push(`⚠️ ${what} zu ${share} % verbraucht, noch ${formatMoney(budget.cents - spent, home)}`);
    }
    return lines;
  }

  function add(user, value, quiet) {
    const words = value.trim().split(/\s+/);
    if (REMOVE.test(words[0] ?? '')) return remove(user, words.slice(1).join(' '), quiet);
    if (!value.trim()) return overview(user, '');
    const expense = parseExpense(value, home);
    if (!expense) return quiet ? null : 'So geht es: `ausgabe 12,50 essen` oder mit Notiz `ausgabe 12,50 essen Pizza mit Tom`';
    const at = now();
    const row = db.addExpense(user, { ...expense, at });
    const lines = [`💸 *${formatMoney(row.cents, row.currency)}* ${label(row.category)}${row.note ? ` – ${row.note}` : ''}`];
    if (row.currency === home) {
      const { from, to } = parsePeriod('', at);
      lines.push(`Diesen Monat: ${formatMoney(db.expenseTotal(user, from, to, home), home)}, davon ${capitalize(row.category)} ${formatMoney(db.expenseTotal(user, from, to, home, row.category), home)}`);
      lines.push(...budgetLines(user, at, row.category));
    }
    lines.push(`_Falsch? \`ausgabe weg ${row.nr}\`_`);
    return lines.join('\n');
  }

  function remove(user, value, quiet) {
    const nr = Number(value.match(/^#?(\d{1,6})[.!]?$/)?.[1]);
    const row = nr && db.expense(user, nr);
    if (!row) return quiet ? null : 'So geht es: `ausgabe weg 12`. Die Nummern zeigt `ausgaben`.';
    db.removeExpense(row.id);
    db.keepInTrash(user, { kind: 'expense', expense: row });
    return `🗑️ Ausgabe gelöscht: ${formatMoney(row.cents, row.currency)} ${capitalize(row.category)}\nVersehen? \`rückgängig\``;
  }

  function restore(user, { expense }) {
    const row = db.restoreExpense(expense);
    return `↩️ Wieder da: ${formatMoney(row.cents, row.currency)} ${capitalize(row.category)} (Nr. ${row.nr})`;
  }

  function overview(user, value, quiet) {
    const text = value.trim();
    if (/^(export|csv|tabelle)$/i.test(text)) return exportData(user);
    const at = now();
    let period = parsePeriod(text, at);
    let category = null;
    if (!period) {
      // "ausgaben essen" or "ausgaben essen oktober"
      const [first, ...rest] = text.toLowerCase().split(/\s+/);
      period = parsePeriod(rest.join(' '), at);
      category = first;
      if (!period || !db.expenseCategories(user).includes(category)) {
        return quiet ? null : 'So geht es: `ausgaben`, `ausgaben oktober`, `ausgaben letzter monat`, `ausgaben 2026` oder `ausgaben essen`';
      }
    }
    const rows = db.expenses(user, period.from, period.to).filter((row) => !category || row.category === category);
    const title = `💸 *Ausgaben ${period.title}${category ? `, ${capitalize(category)}` : ''}*`;
    if (!rows.length) return `${title}\nNoch nichts eingetragen. Eintragen mit \`ausgabe 12,50 essen\``;

    const sections = [title];
    const currencies = [...new Set(rows.map((row) => row.currency))].sort((a, b) => Number(b === home) - Number(a === home));
    for (const currency of currencies) {
      const inCurrency = rows.filter((row) => row.currency === currency);
      const total = inCurrency.reduce((sum, row) => sum + row.cents, 0);
      const head = [`Gesamt: *${formatMoney(total, currency)}*`];
      const budget = currency === home && !category && !/jahr/i.test(period.title) ? db.budgets(user).find((b) => !b.category) : null;
      if (budget) head[0] += ` von ${formatMoney(budget.cents, home)} (${percent(total, budget.cents)} %)${total > budget.cents ? ' 🚨' : ''}`;
      if (!category) {
        const sums = new Map();
        for (const row of inCurrency) sums.set(row.category, (sums.get(row.category) ?? 0) + row.cents);
        for (const [name, sum] of [...sums].sort((a, b) => b[1] - a[1])) {
          const limit = currency === home && db.budgets(user).find((b) => b.category === name);
          const of = limit ? ` / ${formatMoney(limit.cents, home)}` : '';
          head.push(`${label(name)} ${formatMoney(sum, currency)}${of} (${percent(sum, total)} %)`);
        }
      }
      sections.push(head.join('\n'));
    }
    const latest = rows.slice(0, category ? 15 : SHOWN).map((row) => {
      const date = new Date(row.at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
      return `*${row.nr}.* ${date} ${formatMoney(row.cents, row.currency)} ${capitalize(row.category)}${row.note ? ` – ${row.note}` : ''}`;
    });
    sections.push(`_Zuletzt:_\n${latest.join('\n')}`);
    sections.push('_Löschen:_ `ausgabe weg` und die Nummer · Tabelle: `ausgaben export`');
    return sections.join('\n\n');
  }

  /** "budget 800", "budget essen 200", "budget aus", "budget essen aus" */
  function budget(user, value, quiet) {
    const words = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
      const budgets = db.budgets(user);
      if (!budgets.length) return quiet ? null : 'Noch kein Budget. Festlegen mit `budget 800` für den Monat oder `budget essen 200` für eine Kategorie.';
      const at = now();
      const { from, to } = parsePeriod('', at);
      const lines = budgets.map((b) => {
        const spent = db.expenseTotal(user, from, to, home, b.category || null);
        return `${b.category ? label(b.category) : '📅 Gesamt'}: ${formatMoney(spent, home)} von ${formatMoney(b.cents, home)} (${percent(spent, b.cents)} %)`;
      });
      return `💰 *Budgets diesen Monat*\n${lines.join('\n')}`;
    }
    let category = '';
    if (!/^\d/.test(words[0]) && !OFF.test(words[0])) category = words.shift().replace(/[^\p{L}\p{N}-]/gu, '').slice(0, MAX_CATEGORY);
    const amount = words.join(' ');
    if (OFF.test(amount)) {
      db.setBudget(user, category, null);
      return `💰 ${category ? `Budget für ${capitalize(category)}` : 'Monatsbudget'} entfernt.`;
    }
    const cents = toCents(amount.replace(/€|eur(?:o)?/gi, '').trim());
    if (!cents) return quiet ? null : 'So geht es: `budget 800`, `budget essen 200` oder `budget aus`';
    db.setBudget(user, category, cents);
    const lines = [`💰 ${category ? `Budget für ${capitalize(category)}` : 'Monatsbudget'}: *${formatMoney(cents, home)}*`, 'Ich sage Bescheid, wenn 80 % verbraucht sind und wenn du darüber kommst.'];
    lines.push(...budgetLines(user, now(), category || null));
    return lines.join('\n');
  }

  function exportData(user) {
    const rows = db.expenses(user, 0, Number.MAX_SAFE_INTEGER);
    if (!rows.length) return 'Noch keine Ausgaben eingetragen.';
    const cell = (value) => {
      let text = String(value ?? '');
      if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const two = (n) => String(n).padStart(2, '0');
    const lines = [['Nr.', 'Datum', 'Betrag', 'Währung', 'Kategorie', 'Notiz'].map(cell).join(';')];
    for (const row of [...rows].reverse()) {
      const d = new Date(row.at);
      lines.push([row.nr, `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`, (row.cents / 100).toFixed(2).replace('.', ','),
        cell(row.currency), cell(capitalize(row.category)), cell(row.note)].join(';'));
    }
    return {
      text: `📄 Deine Ausgaben (${rows.length}). Öffnet in Excel und anderen Tabellenprogrammen.`,
      file: { name: 'ausgaben.csv', mimetype: 'text/csv', data: Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8') },
    };
  }

  /** On the 1st (or the 2nd, if the PC was off): last month in one message. */
  function queueMonthly(at = now()) {
    const date = new Date(at);
    if (date.getDate() > 2 || date.getHours() < 9) return;
    const last = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    const period = monthRange(last.getFullYear(), last.getMonth());
    for (const user of db.expenseUsers(period.from, period.to)) {
      if (!db.claimOnce(user, `expenses:${monthKey(last.getFullYear(), last.getMonth())}`, at)) continue;
      db.queue(user, overview(user, `${MONTHS[last.getMonth()]} ${last.getFullYear()}`).replace('💸 *Ausgaben', '📊 *Dein Monat: Ausgaben'), { at });
    }
  }

  return { add, overview, budget, restore, queueMonthly };
}
