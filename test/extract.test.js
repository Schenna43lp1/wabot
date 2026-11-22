import assert from 'node:assert/strict';
import test from 'node:test';
import { extractProduct } from '../src/extract.js';

const ld = (value) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const product = (name, price, more = {}) => ({ '@type': 'Product', name, offers: { price, priceCurrency: 'EUR', ...more } });
const read = (html, url = 'https://shop.de/p', options) => extractProduct(html, url, options);

test('JSON-LD', () => assert.equal(read(ld(product('A', '19.99'))).cents, 1999));
test('@graph', () => assert.equal(read(ld({ '@graph': [{ '@type': 'WebPage' }, product('A', 5)] })).cents, 500));
test('broken block next to a valid one', () =>
  assert.equal(read(`<script type="application/ld+json">{oops</script>${ld(product('A', 7))}`).cents, 700));
test('sold out', () =>
  assert.equal(read(ld(product('A', 9, { availability: 'https://schema.org/OutOfStock' }))).available, false));
test('recommendations are ignored', () =>
  assert.equal(read(ld({ ...product('A', 50), isRelatedTo: product('B', 2) })).cents, 5000));
test('heading selects the main product', () =>
  assert.equal(read(`<h1>B</h1>${ld([product('A', 5), product('B', 8)])}`).cents, 800));
test('two unrelated products are ambiguous', () => assert.throws(() => read(ld([product('A', 5), product('B', 8)]))));

const variants = ld({
  '@type': 'Product',
  name: 'V',
  offers: [
    { price: 10, priceCurrency: 'EUR', url: '/p?variant=1' },
    { price: 20, priceCurrency: 'EUR', url: '/p?variant=2' },
  ],
});
test('variant from the link', () => assert.equal(read(variants, 'https://shop.de/p?variant=2').cents, 2000));
test('without a variant: lowest, marked as from', () => {
  const found = read(variants);
  assert.deepEqual([found.cents, found.from], [1000, true]);
});
test('AggregateOffer', () => {
  const found = read(ld({ '@type': 'Product', offers: { '@type': 'AggregateOffer', lowPrice: 30, highPrice: 40 } }));
  assert.deepEqual([found.cents, found.from], [3000, true]);
});
test('strikethrough price is ignored', () => {
  const priceSpecification = [{ priceType: 'StrikethroughPrice', price: 99 }, { price: 79, priceCurrency: 'EUR' }];
  assert.equal(read(ld({ '@type': 'Product', offers: { priceSpecification } })).cents, 7900);
});
test('meta tags', () => {
  const found = read('<meta property="product:price:amount" content="49,95"><meta property="product:price:currency" content="CHF">');
  assert.deepEqual([found.cents, found.currency], [4995, 'CHF']);
});
test('microdata', () => {
  const html = '<div itemscope itemtype="https://schema.org/Product"><span itemprop="price" content="12.50">12,50 €</span></div>';
  assert.equal(read(html).cents, 1250);
});
test('Amazon uses only the main price', () => {
  const html = '<span class="a-price"><span class="a-offscreen">5,00€</span></span><div id="corePriceDisplay_desktop_feature_div"><span class="priceToPay"><span class="a-offscreen">49,99€</span></span></div>';
  assert.equal(read(html, 'https://www.amazon.de/dp/X').cents, 4999);
});
test('Amazon without a main price never takes an ad', () =>
  assert.throws(() => read('<span class="a-offscreen">5,00€</span>', 'https://www.amazon.de/dp/X')));
test('selector', () => assert.equal(read('<b class="p">33,00 €</b>', undefined, { selector: '.p' }).cents, 3300));
test('invalid selector', () => assert.throws(() => read('<b/>', undefined, { selector: '[[[' }), /ungültig/));
test('random numbers are not prices', () => assert.throws(() => read('<h1>Angebot</h1><p>nur 19,99 €</p>'), /keinen eindeutigen/));
test('empty bot wall', () => assert.throws(() => read('<script></script>'), /Bot-Sperre/));
test('redirect to a captcha page', () => assert.throws(() => read('<h1>Check</h1>', 'https://shop.de/captcha'), /CAPTCHA/));
test('captcha', () => assert.throws(() => read('<form action="/errors/validateCaptcha">'), /CAPTCHA/));
