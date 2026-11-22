const SYMBOLS = { '€': 'EUR', EUR: 'EUR', EURO: 'EUR', '£': 'GBP', GBP: 'GBP', CHF: 'CHF', USD: 'USD', $: 'USD', PLN: 'PLN', 'ZŁ': 'PLN' };
const CURRENCY = '(?:€|EURO?\\b|£|GBP\\b|CHF\\b|USD\\b|\\$|PLN\\b|zł)';
const AMOUNT = "\\d{1,3}(?:[ .,'’]\\d{3})+(?:[.,](?:\\d{1,2}|[-–—]))?(?!\\d)|\\d+(?:[.,](?:\\d+|[-–—]))?";

/** Converts a written amount (1.299,99 / 1,299.99 / 1'299.- / 19,-) to cents. */
export function toCents(raw) {
  let s = String(raw).trim().replace(/[\s'’]/g, '').replace(/[.,][-–—]$/, '');
  if (!/^\d+(?:[.,]\d+)*$/.test(s)) return null;

  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (last >= 0) {
    const decimals = s.length - last - 1;
    if (decimals === 3) s = s.replace(/[.,]/g, '');
    else if (decimals <= 2) s = `${s.slice(0, last).replace(/[.,]/g, '')}.${s.slice(last + 1)}`;
    else return null;
  }
  return validCents(Number(s));
}

/** schema.org prices use a dot as decimal separator, but some shops use local formats. */
export function structuredCents(value) {
  if (typeof value === 'number') return validCents(value);
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    // "1.299" may mean 1299 or 1.299, so do not guess.
    if (/^\d\.\d{3}$/.test(s)) return null;
    return validCents(Number(s));
  }
  return parsePrice(s)?.cents ?? null;
}

function validCents(value) {
  const cents = Math.round(value * 100);
  return cents > 0 && cents < 1e10 ? cents : null;
}

export function currencyOf(text) {
  const found = String(text ?? '').match(new RegExp(CURRENCY, 'i'))?.[0];
  return found ? SYMBOLS[found.toUpperCase()] : null;
}

/** Reads exactly one price from text. Returns null instead of guessing. */
export function parsePrice(input) {
  const text = String(input ?? '').replace(/\s+/g, ' ').trim();
  const pattern = new RegExp(`(${CURRENCY})\\s?(${AMOUNT})|(${AMOUNT})\\s?(${CURRENCY})`, 'giu');
  const marked = [...text.matchAll(pattern)].map((m) => ({
    cents: toCents(m[2] ?? m[3]),
    currency: currencyOf(m[1] ?? m[4]),
  }));

  if (marked.length) {
    const distinct = new Set(marked.map((price) => price.cents));
    return distinct.size === 1 && marked[0].cents ? marked[0] : null;
  }
  const plain = text.match(new RegExp(AMOUNT, 'gu'));
  if (plain?.length !== 1) return null;
  const cents = toCents(plain[0]);
  return cents ? { cents, currency: null } : null;
}

export function formatMoney(cents, currency) {
  if (cents == null) return 'unbekannt';
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
