// "gekauft 3" ends tracking and remembers what it saved.
import { parseTarget } from './input.js';
import { productName } from './messages.js';
import { formatMoney } from './money.js';

const SHOWN = 10;

export function createPurchases({ db, config, now = Date.now }) {
  function purchase(product, value, quiet) {
    const { id } = product;
    const usage = `So geht es: \`gekauft ${id}\` (jetziger Preis) oder \`gekauft ${id} 79,90\``;
    let paid = product.price;
    if (value) {
      paid = parseTarget(value)?.cents;
      if (!paid) return quiet ? null : `„${value.slice(0, 40)}“ verstehe ich nicht als Preis.\n${usage}`;
    }
    if (!paid) return `Für Nr. ${id} kenne ich noch keinen Preis. Schick mir, was du bezahlt hast: \`gekauft ${id} 79,90\``;

    const currency = product.currency ?? config.currency;
    const start = db.firstPrice(id, currency) ?? paid;
    db.buy(product, { title: productName(product), paid, start, currency, at: now() });

    const lines = [`🛍️ *Gekauft:* ${productName(product)}`, `für *${formatMoney(paid, currency)}*`];
    if (start > paid) {
      const percent = Math.round(((start - paid) / start) * 100);
      lines.push(`💰 Gespart: *${formatMoney(start - paid, currency)}*${percent ? ` (−${percent} %)` : ''} gegenüber ${formatMoney(start, currency)} zu Beginn`);
    } else if (start < paid) {
      lines.push(`Zu Beginn der Beobachtung kostete es ${formatMoney(start, currency)}.`);
    }
    lines.push('', 'Ich beobachte es nicht mehr. Versehen? `rückgängig`', 'Deine Bilanz: `ersparnis`');
    return lines.join('\n');
  }

  function savings(user) {
    const rows = db.purchases(user);
    if (!rows.length) {
      return 'Noch keine Käufe eingetragen.\nHast du etwas gekauft, schreib `gekauft` und die Nummer, z. B. `gekauft 3`. Dann rechne ich aus, was du gespart hast.';
    }

    const totals = new Map();
    for (const row of rows) totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.start - row.paid);
    const sums = [...totals].map(([currency, total]) =>
      (total >= 0 ? `Gespart: *${formatMoney(total, currency)}*` : `Mehr bezahlt: *${formatMoney(-total, currency)}*`));
    const count = `${rows.length} ${rows.length === 1 ? 'Kauf' : 'Käufe'}`;

    const lines = rows.slice(0, SHOWN).map((row) => {
      const date = new Date(row.at).toLocaleDateString('de-DE', { dateStyle: 'short' });
      const difference = row.start - row.paid;
      let note = '';
      if (difference > 0) note = ` (−${formatMoney(difference, row.currency)})`;
      else if (difference < 0) note = ` (+${formatMoney(-difference, row.currency)})`;
      return `• ${date} ${row.title}: ${formatMoney(row.paid, row.currency)}${note}`;
    });
    if (rows.length > SHOWN) lines.push(`… und ${rows.length - SHOWN} ältere`);

    return `💰 *Deine Ersparnis* (${count})\n${sums.join('\n')}\n\n${lines.join('\n')}\n\n_Verglichen mit dem Preis zu Beginn der Beobachtung._`;
  }

  return { purchase, savings };
}
