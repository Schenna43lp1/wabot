// Everything the bot says about a product
import { formatMoney } from './money.js';

const MAX_TITLE = 60;

/** Shop titles may be very long and contain characters WhatsApp treats as formatting. */
export function shortTitle(title) {
  const plain = title.replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim();
  if (plain.length <= MAX_TITLE) return plain;
  return `${plain.slice(0, MAX_TITLE).replace(/\s+\S*$/, '')}…`;
}

/** The user's own name wins over the shop title. */
export const productName = (product) => shortTitle(product.name ?? product.title);

export function thresholdText(percent) {
  return percent ? `Senkungen ab ${String(percent).replace('.', ',')} %` : 'jede Senkung';
}

export function ago(at, now = Date.now()) {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  if (minutes < 24 * 60) return `vor ${Math.floor(minutes / 60)} Std.`;
  const days = Math.floor(minutes / (24 * 60));
  return days === 1 ? 'gestern' : `vor ${days} Tagen`;
}

export function priceText(product) {
  if (product.price == null) return product.available === 0 ? 'nicht verfügbar' : 'noch kein Preis';
  const price = `${product.is_from ? 'ab ' : ''}${formatMoney(product.price, product.currency)}`;
  return product.available === 0 ? `${price} · nicht verfügbar` : price;
}

export function targetText(product, fallbackCurrency) {
  if (product.target == null) return '';
  const currency = product.currency ?? fallbackCurrency;
  const target = formatMoney(product.target, currency);
  if (product.price == null) return `🎯 Ziel ${target}`;
  if (product.price <= product.target) {
    return product.available === 0 ? `🎯 Ziel ${target}` : `🎯 Ziel ${target} erreicht ✅`;
  }
  return `🎯 Ziel ${target}, noch ${formatMoney(product.price - product.target, currency)}`;
}

/** Compact entry for the list: no link, it would bury the prices. */
export function listEntry(product, firstPrice, currency) {
  let price = priceText(product);
  if (firstPrice && product.price && firstPrice !== product.price) {
    const percent = Math.round((Math.abs(product.price - firstPrice) / firstPrice) * 100);
    if (percent) price += ` ${product.price < firstPrice ? '↓' : '↑'} ${percent} %`;
  }
  const lines = [`*${product.id}. ${productName(product)}*`, price, targetText(product, currency)];
  if (product.paused) lines.push('⏸️ pausiert');
  else if (product.error) lines.push('⚠️ letzte Prüfung fehlgeschlagen');
  return lines.filter(Boolean).join('\n');
}

export function details(product, currency) {
  return [
    `*${product.id}. ${productName(product)}*`,
    priceText(product),
    targetText(product, currency),
    product.min_drop != null ? `🔔 Meldet ${thresholdText(product.min_drop)}` : '',
    product.paused ? `⏸️ Pausiert, fortsetzen mit \`weiter ${product.id}\`` : '',
    product.error ? `⚠️ ${product.error}` : '',
    product.checked_at ? `_Geprüft ${ago(product.checked_at)}_` : '',
    product.url,
  ].filter(Boolean).join('\n');
}

/** What the user can do about an error. */
export function advice(kind, id) {
  switch (kind) {
    case 'blocked':
      return `Dieser Shop lässt keine Bots zu. Such das Produkt auf geizhals.de, schick mir den Link von dort und entferne dieses mit \`löschen ${id}\`.`;
    case 'temporary':
      return 'Das ist meist vorübergehend. Ich versuche es von selbst noch einmal.';
    case 'gone':
      return `Öffne den Link zur Kontrolle. Entfernen: \`löschen ${id}\``;
    case 'no_price':
      return `Ist das die Seite eines einzelnen Produkts? Wenn nicht: \`löschen ${id}\`\nWenn ja, kannst du das Preisfeld selbst angeben: \`selektor ${id} .price\``;
    default:
      return `Entfernen: \`löschen ${id}\``;
  }
}
