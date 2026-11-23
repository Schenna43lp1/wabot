import { priceText, productName } from './messages.js';
import { formatMoney } from './money.js';
import { clockText, DAILY, isQuiet, nextReport, reportText } from './schedule.js';
import { currentSeries, priceAt } from './stats.js';

/** What changed for the user's products, grouped. */
export function priceChanges(db, user, now, days) {
  const products = db.products(user);
  const groups = { reached: [], cheaper: [], dearer: [], failed: [] };
  let paused = 0;
  for (const product of products) {
    const name = `${product.id}. ${productName(product)}`;
    if (product.paused) {
      paused++;
      continue;
    }
    if (product.error) groups.failed.push(name);
    if (product.price == null || product.available === 0) continue;

    if (product.target != null && product.price <= product.target) {
      groups.reached.push(`${name}: *${priceText(product)}*`);
      continue;
    }
    const series = currentSeries(db.allHistory(product.id), product.currency);
    const before = priceAt(series, now - days * 86_400_000);
    if (!before || before === product.price) continue;
    const percent = ((Math.abs(product.price - before) / before) * 100).toFixed(1).replace('.', ',');
    const line = `${name}: ${formatMoney(before, product.currency)} → *${formatMoney(product.price, product.currency)}* (${percent} %)`;
    groups[product.price < before ? 'cheaper' : 'dearer'].push(line);
  }
  return { products, paused, groups };
}

export function overview(db, user, now = Date.now(), days = 7) {
  const { products, paused, groups } = priceChanges(db, user, now, days);
  if (!products.length) return null;

  const period = days === 1 ? 'letzte 24 Stunden' : `letzte ${days} Tage`;
  const count = `${products.length} ${products.length === 1 ? 'Produkt' : 'Produkte'}${paused ? `, ${paused} pausiert` : ''}`;
  const sections = [`📊 *Übersicht, ${period}*\n${count}`];
  const section = (title, lines) => lines.length && sections.push(`${title}\n${lines.join('\n')}`);
  section('🎯 *Zielpreis erreicht*', groups.reached);
  section('📉 *Günstiger*', groups.cheaper);
  section('📈 *Teurer*', groups.dearer);
  section('⚠️ *Letzte Prüfung fehlgeschlagen*', groups.failed);
  if (sections.length === 1) sections.push('Keine Änderungen.');

  const settings = db.settings(user);
  const footer = [];
  if (settings?.report_day != null) {
    footer.push(`_Kommt ${reportText({ day: settings.report_day, minute: settings.report_minute })}_`);
  }
  if (settings?.quiet_from != null) {
    footer.push(`_Ruhezeit ${clockText(settings.quiet_from)} bis ${clockText(settings.quiet_to)}_`);
  }
  if (footer.length) sections.push(footer.join('\n'));
  return sections.join('\n\n');
}

/** A report missed while the PC was off is sent once, not once per missed day. */
export function queueReports(db, now = Date.now()) {
  for (const settings of db.dueReports(now)) {
    // Written when the quiet hours end, so that it is up to date then.
    if (isQuiet(settings, now)) continue;
    const { user, report_day: day, report_minute: minute } = settings;
    const text = overview(db, user, now, day === DAILY ? 1 : 7);
    db.transaction(() => {
      if (text) db.queue(user, text, { at: now });
      db.saveSettings(user, { report_next: nextReport({ day, minute }, now) });
    });
  }
}
