// "rechne 12*3", "trinkgeld 47,80", "100 usd in eur", "kurs chf"
import { calculate, formatNumber, tipText } from './calc.js';
import { formatMoney } from './money.js';
import { currencyCode } from './rates.js';

const CONNECTOR = /^(in|nach|zu|to|→|=|als)$/i;
const SHOWN_RATES = ['USD', 'CHF', 'GBP'];

const rate = (value) => new Intl.NumberFormat('de-DE', { maximumSignificantDigits: 5 }).format(value);
const ecbDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Splits "100usd", "$100" and "100,50€" into amount and currency. */
function tokens(text) {
  return text.trim()
    .replace(/(\d)([^\d\s.,])/g, '$1 $2')
    .replace(/([$€£¥])(?=\d)/g, '$1 ')
    .split(/\s+/)
    .filter(Boolean);
}

function amountOf(token) {
  if (!/^\d[\d.,]*$/.test(token ?? '')) return null;
  const value = token.includes(',') ? Number(token.replace(/\./g, '').replace(',', '.'))
    : /^\d{1,3}(\.\d{3})+$/.test(token) ? Number(token.replace(/\./g, '')) : Number(token);
  return Number.isFinite(value) && value > 0 && value < 1e12 ? value : null;
}

/** "100 usd in eur" → { amount, from, to } (to may be null). Without rates only the shape is checked. */
export function parseConversion(text, rates) {
  const words = tokens(text);
  const at = words.findIndex((word) => amountOf(word) != null);
  if (at < 0 || at > 1) return null;
  const amount = amountOf(words[at]);
  let from;
  let rest;
  if (at === 1) {
    from = currencyCode(words[0], rates);
    rest = words.slice(2);
  } else {
    from = words[1] ? currencyCode(words[1], rates) : null;
    rest = words.slice(2);
  }
  if (!from) return null;
  if (!rest.length) return { amount, from, to: null };
  if (rest.length !== 2 || !CONNECTOR.test(rest[0])) return null;
  const to = currencyCode(rest[1], rates);
  return to ? { amount, from, to } : null;
}

export function createTools({ rates, config }) {
  function calc(value, quiet) {
    const result = calculate(value);
    if (!result) return quiet ? null : 'So geht es: `rechne 12,5*3+7`, `rechne 250 + 19%`, `rechne 19% von 250`, `rechne wurzel 2`';
    if (result.error) return quiet ? null : `🧮 ${result.error}`;
    return `🧮 ${value.trim()} = *${formatNumber(result.value)}*`;
  }

  function tip(value, quiet) {
    const text = tipText(value);
    if (text) return text;
    return quiet ? null : 'So geht es: `trinkgeld 47,80` oder `trinkgeld 47,80 10%`';
  }

  async function convert(value, quiet) {
    // Cheap check first, so that notes never cause a download.
    if (!parseConversion(value)) {
      return quiet ? null : 'So geht es: `100 usd in eur`, `umrechnen 50 chf` oder `kurs usd`';
    }
    const { rates: table, date } = await rates.load();
    const parsed = parseConversion(value, table);
    if (!parsed) return quiet ? null : 'Diese Währung kenne ich nicht. Die EZB-Kurse gibt es für rund 30 Währungen, z. B. USD, CHF, GBP, PLN, CZK, HUF, SEK, NOK, DKK, JPY, TRY.';
    const home = config.currency in Object.fromEntries(table) ? config.currency : 'EUR';
    const targets = parsed.to ? [parsed.to] : parsed.from === home ? SHOWN_RATES.filter((code) => code !== home) : [home];
    const cents = Math.round(parsed.amount * 100);
    const lines = targets.map((to) => {
      const converted = (parsed.amount / table.get(parsed.from)) * table.get(to);
      return `${formatMoney(cents, parsed.from)} = *${formatMoney(Math.round(converted * 100), to)}*`;
    });
    const unit = targets.length === 1 ? targets[0] : parsed.from;
    const other = unit === parsed.from ? targets[0] : parsed.from;
    const one = table.get(other) / table.get(unit);
    return `💱 ${lines.join('\n')}\n_Kurs der EZB vom ${ecbDate(date)}: 1 ${unit} = ${rate(one)} ${other}_`;
  }

  async function exchangeRate(value, quiet) {
    const word = value.trim().split(/\s+/)[0] ?? '';
    if (!word || !currencyCode(word)) {
      if (quiet) return null;
      if (!word) return 'So geht es: `kurs usd` oder `100 usd in eur`';
    }
    const { rates: table, date } = await rates.load();
    const code = currencyCode(word, table);
    if (!code) return quiet ? null : `„${word.slice(0, 20)}“ kenne ich nicht. Beispiele: USD, CHF, GBP, PLN, CZK, JPY`;
    const base = code === 'EUR' ? 'USD' : 'EUR';
    const forward = table.get(code) / table.get(base);
    return `💱 1 ${base} = *${rate(forward)} ${code}*\n1 ${code} = *${rate(1 / forward)} ${base}*\n_Kurs der EZB vom ${ecbDate(date)}_`;
  }

  return { calc, tip, convert, exchangeRate };
}
