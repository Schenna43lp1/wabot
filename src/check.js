// Tests a link without WhatsApp: npm run check -- <link> [css selector]
import { loadConfig } from './config.js';
import { formatMoney } from './money.js';
import { getProduct } from './product.js';

const [link, selector] = process.argv.slice(2);

if (!link) {
  console.log('Aufruf: npm run check -- "<Link>" ["CSS-Selektor"]');
  process.exitCode = 1;
} else {
  try {
    const found = await getProduct(link, { selector, currency: loadConfig().currency });
    console.log(`Produkt:   ${found.title}`);
    console.log(`Preis:     ${found.from ? 'ab ' : ''}${formatMoney(found.cents, found.currency)}`);
    console.log(`Verfügbar: ${found.available ? 'ja' : 'nein'}`);
    console.log(`Quelle:    ${found.source}`);
  } catch (error) {
    console.log(`Fehler: ${error.message}`);
    process.exitCode = 1;
  }
}
