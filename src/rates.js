// Exchange rates: the daily reference rates of the European Central Bank. Free, no key, nothing about the user is sent.
import { UserError } from './errors.js';

const URL_ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const CACHE_MS = 6 * 3_600_000;
const TIMEOUT_MS = 10_000;

// What people write instead of the code
const NAMES = {
  '€': 'EUR', euro: 'EUR', euros: 'EUR',
  $: 'USD', dollar: 'USD', 'us-dollar': 'USD', usdollar: 'USD',
  '£': 'GBP', pfund: 'GBP',
  '¥': 'JPY', yen: 'JPY',
  fr: 'CHF', 'fr.': 'CHF', franken: 'CHF', sfr: 'CHF',
  'zł': 'PLN', zloty: 'PLN', złoty: 'PLN',
  forint: 'HUF', ft: 'HUF',
  kč: 'CZK', kronen: 'CZK',
  lira: 'TRY', tl: 'TRY',
};

export function createRates({ fetch = globalThis.fetch, now = Date.now } = {}) {
  let cached = null;

  async function load() {
    if (cached && now() - cached.at < CACHE_MS) return cached;
    try {
      const response = await fetch(URL_ECB, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      const rates = new Map([['EUR', 1]]);
      for (const [, code, rate] of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates.set(code, Number(rate));
      const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
      if (rates.size < 10 || !date) throw new Error('unexpected answer');
      cached = { at: now(), rates, date };
      return cached;
    } catch {
      // Yesterday's rates are better than none.
      if (cached) return cached;
      throw new UserError('Die Wechselkurse sind gerade nicht abrufbar. Versuch es später noch einmal.', 'temporary');
    }
  }

  return { load };
}

/** "usd", "$", "Dollar" → "USD", or null. Only codes the ECB knows count. */
export function currencyCode(word, rates) {
  const text = word.toLowerCase().replace(/[.!?]+$/, '');
  const code = NAMES[text] ?? NAMES[word.toLowerCase()] ?? text.toUpperCase();
  return rates ? (rates.has(code) ? code : null) : (/^[A-Z]{3}$/.test(code) ? code : null);
}
