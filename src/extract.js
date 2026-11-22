import { load } from 'cheerio';
import { UserError } from './errors.js';
import { currencyOf, parsePrice, structuredCents } from './money.js';

// A wrong price is worse than no price: every strategy returns null when unsure.

const SOLD_OUT = /OutOfStock|SoldOut|Discontinued|^oos$|out[ _]of[ _]stock/i;
const list = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const isType = (node, ...types) =>
  list(node?.['@type']).some((type) => types.includes(String(type).split('/').pop()));

export function extractProduct(html, pageUrl, { selector, currency = 'EUR' } = {}) {
  const $ = load(html);
  const url = new URL(pageUrl);

  const blocked = /\/captcha(\/|$)/i.test(url.pathname) ||
    $('form[action*="validateCaptcha"], #challenge-form').length > 0 ||
    /^Just a moment/.test($('title').text());
  if (blocked) {
    throw new UserError('Der Shop verlangt ein CAPTCHA und lässt sich nicht automatisch abfragen.', 'blocked');
  }

  const found = selector
    ? fromSelector($, selector)
    : /(^|\.)amazon\.[a-z.]+$/.test(url.hostname)
      ? fromAmazon($)
      : (fromJsonLd($, url) ?? fromMeta($) ?? fromMicrodata($));

  if (!found?.cents && found?.available !== false) {
    if (!$('h1').length && html.length < 5000) {
      throw new UserError('Der Shop liefert nur eine leere Seite (Bot-Sperre oder Seite braucht JavaScript).', 'blocked');
    }
    throw new UserError(selector
      ? 'Der CSS-Selektor liefert keinen eindeutigen Preis.'
      : 'Ich finde auf dieser Seite keinen eindeutigen Preis.', 'no_price');
  }

  const title = clean(found.title || $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text() || $('title').first().text() || url.hostname);

  return {
    title: title.slice(0, 120),
    cents: found.cents ?? null,
    currency: String(found.currency || currency).toUpperCase(),
    available: found.available ?? true,
    from: found.from ?? false,
    source: found.source,
  };
}

function fromSelector($, selector) {
  let element;
  try {
    element = $(selector).first();
  } catch {
    throw new UserError('Der CSS-Selektor ist ungültig.');
  }
  const price = parsePrice(element.attr('content') ?? element.text());
  return price && {
    ...price,
    currency: price.currency ?? $('meta[property$="price:currency"]').attr('content'),
    source: 'CSS-Selektor',
  };
}

function fromAmazon($) {
  // Other prices on an Amazon page belong to ads, bundles and recommendations.
  const areas = ['#corePriceDisplay_desktop_feature_div', '#corePrice_feature_div', '#corePriceDisplay_mobile_feature_div'];
  const base = { title: $('#productTitle').text(), source: 'Amazon' };
  for (const area of areas) {
    for (const part of ['.priceToPay .a-offscreen', '.priceToPay', '.a-price:not(.a-text-price) .a-offscreen']) {
      const price = parsePrice($(`${area} ${part}`).first().text());
      if (price?.currency) return { ...base, ...price };
    }
  }
  return $('#outOfStock').length ? { ...base, cents: null, available: false } : null;
}

function fromJsonLd($, url) {
  const products = [];
  const byId = new Map();
  const skipped = new Set(['isRelatedTo', 'isSimilarTo', 'isAccessoryOrSparePartFor', 'itemListElement', 'review']);

  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 30) return;
    if (Array.isArray(node)) return node.forEach((child) => visit(child, depth + 1));
    if (node['@id'] && Object.keys(node).length > 1) byId.set(node['@id'], node);
    if (isType(node, 'Product', 'ProductGroup')) {
      products.push(node);
      return; // nested products are variants or recommendations of this one
    }
    for (const [key, child] of Object.entries(node)) {
      if (!skipped.has(key)) visit(child, depth + 1);
    }
  };

  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      // Raw line breaks inside strings are a common shop bug.
      visit(JSON.parse($(script).text().replace(/[\r\n\t]+/g, ' ').trim().replace(/;$/, '')));
    } catch {
      // One broken block must not hide the valid ones.
    }
  });

  const resolveRef = (node) => byId.get(node?.['@id']) ?? node;
  const candidates = products.map((product) => {
    const own = list(product.offers).map(resolveRef);
    const variants = list(product.hasVariant).map(resolveRef).flatMap((variant) =>
      list(variant?.offers).map((offer) => ({
        ...resolveRef(offer),
        variantUrl: variant.url ?? variant['@id'],
        variantSku: variant.sku,
      })));
    const price = pickOffer([...own, ...variants].flatMap(expandOffer), url);
    return price && { ...price, title: product.name, productUrl: product.url, source: 'JSON-LD' };
  }).filter(Boolean);

  if (candidates.length <= 1) return candidates[0] ?? null;
  if (new Set(candidates.map((c) => c.cents)).size === 1) return candidates[0];

  const heading = clean($('h1').first().text()).toLowerCase();
  const main = candidates.filter((c) =>
    samePath(c.productUrl, url) || (heading && clean(c.title).toLowerCase() === heading));
  return main.length === 1 ? main[0] : null;
}

function expandOffer(offer) {
  if (!offer || typeof offer !== 'object') return [];
  if (!isType(offer, 'AggregateOffer')) return [offer];
  if (offer.lowPrice != null) {
    return [{ ...offer, price: offer.lowPrice, isFrom: String(offer.lowPrice) !== String(offer.highPrice) }];
  }
  return list(offer.offers);
}

function pickOffer(offers, url) {
  const priced = offers.map((offer) => {
    // Strikethrough, member and unit prices are not the current price.
    const spec = list(offer.priceSpecification).find((s) => !s.priceType && !s.validForMemberTier && !s.referenceQuantity);
    return {
      cents: structuredCents(offer.price ?? spec?.price),
      currency: offer.priceCurrency ?? spec?.priceCurrency,
      available: !SOLD_OUT.test(String(offer.availability ?? '')),
      from: Boolean(offer.isFrom),
      urls: [offer.url, offer.variantUrl, offer['@id']],
      ids: [offer.sku, offer.variantSku].filter(Boolean).map(String),
    };
  }).filter((offer) => offer.cents || !offer.available);
  if (!priced.length) return null;

  const params = [...url.searchParams.values()];
  const selected = url.search
    ? priced.filter((o) => o.ids.some((id) => params.includes(id)) || o.urls.some((link) => sameVariant(link, url)))
    : [];
  let pool = selected.length ? selected : priced;
  if (pool.some((o) => o.available)) pool = pool.filter((o) => o.available);

  const withPrice = pool.filter((o) => o.cents).sort((a, b) => a.cents - b.cents);
  if (new Set(withPrice.map((o) => o.currency)).size > 1) return null;
  const best = withPrice[0] ?? pool[0];
  return {
    cents: best.cents,
    currency: best.currency,
    available: best.available,
    from: best.from || new Set(withPrice.map((o) => o.cents)).size > 1,
  };
}

function samePath(link, url) {
  if (typeof link !== 'string' || !URL.canParse(link, url)) return false;
  return new URL(link, url).pathname.replace(/\/$/, '') === url.pathname.replace(/\/$/, '');
}

function sameVariant(link, url) {
  if (!samePath(link, url)) return false;
  const params = [...new URL(link, url).searchParams];
  return params.length > 0 && params.every(([key, value]) => url.searchParams.get(key) === value);
}

function fromMeta($) {
  for (const prefix of ['product:sale_price', 'product:price', 'og:price']) {
    const read = (key) => $(`meta[property="${key}"], meta[name="${key}"]`).first().attr('content');
    const raw = read(`${prefix}:amount`);
    const cents = structuredCents(raw);
    if (!cents) continue;
    return {
      cents,
      currency: read(`${prefix}:currency`) ?? read('product:price:currency') ?? currencyOf(raw),
      available: !SOLD_OUT.test(read('product:availability') ?? read('og:availability') ?? ''),
      source: 'Meta-Tags',
    };
  }
  return null;
}

function fromMicrodata($) {
  const products = $('[itemtype$="schema.org/Product"]').filter((_, el) =>
    !$(el).parents('[itemtype$="schema.org/Product"]').length);
  if (products.length !== 1) return null;

  const product = products.first();
  const own = (name) => product.find(`[itemprop="${name}"]`).filter((_, el) =>
    $(el).parents('[itemtype$="schema.org/Product"]').first().is(product));

  const prices = own('price').toArray().map((el) => {
    const machine = $(el).attr('content');
    const text = $(el).text();
    return machine ? { cents: structuredCents(machine), currency: currencyOf(text) } : parsePrice(text);
  }).filter((price) => price?.cents);
  if (new Set(prices.map((price) => price.cents)).size !== 1) return null;

  const currency = own('priceCurrency').first();
  const stock = own('availability').first();
  return {
    cents: prices[0].cents,
    currency: currency.attr('content') || clean(currency.text()) || prices[0].currency,
    available: !SOLD_OUT.test(stock.attr('href') ?? stock.attr('content') ?? ''),
    source: 'Microdata',
  };
}
