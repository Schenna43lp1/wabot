import { UserError } from './errors.js';
import { advice, productName } from './messages.js';
import { formatMoney } from './money.js';

const RETRY_MS = 10 * 60_000;
const HOST_GAP_MS = 5_000;
const FAILURES_BEFORE_ALERT = 5;

export function createTracker({ db, config, getProduct, notify = () => {}, now = Date.now, log = () => {} }) {
  const running = new Map();

  function check(id) {
    if (!running.has(id)) {
      const job = runCheck(id).finally(() => running.delete(id));
      running.set(id, job);
    }
    return running.get(id);
  }

  async function runCheck(id) {
    const before = db.product(id);
    if (!before) return { error: 'Das Produkt wurde gelöscht.' };

    const { found, failure } = await read(before, before.selector);

    // The user may have edited or deleted the product during the request.
    const product = db.product(id);
    if (!product) return { error: 'Das Produkt wurde gelöscht.' };
    if (product.selector !== before.selector) return runCheck(id);

    let result;
    db.transaction(() => {
      result = failure ? saveFailure(product, failure) : saveReading(product, found);
    });
    notify();
    return result;
  }

  async function read(product, selector) {
    try {
      return { found: await getProduct(product.url, selector) };
    } catch (error) {
      if (error instanceof UserError) return { failure: { error: error.message, kind: error.kind } };
      log(`Fehler bei Produkt ${product.id}: ${error.stack}`);
      return { failure: { error: 'Unerwarteter Fehler beim Prüfen.', kind: 'temporary' } };
    }
  }

  /** Tries the selector first and changes nothing unless it finds a price. */
  async function changeSelector(id, selector) {
    const before = db.product(id);
    if (!before) return { error: 'Das Produkt wurde gelöscht.' };
    const { found, failure } = await read(before, selector);
    if (failure) return failure;
    if (!db.product(id)) return { error: 'Das Produkt wurde gelöscht.' };

    let result;
    db.transaction(() => {
      // Another selector measures something else, so the history starts again.
      db.update(id, { selector, price: null, baseline: null, pending: null, available: null, target_hit: 0, checked_at: null });
      db.clearHistory(id);
      result = saveReading(db.product(id), found);
    });
    notify();
    return result;
  }

  function saveFailure(product, { error, kind }) {
    const at = now();
    const failures = product.failures + 1;
    const retrySoon = kind === 'temporary' && failures <= 2;
    const delay = retrySoon ? Math.min(RETRY_MS, config.intervalMs) : Math.min(config.intervalMs * 2 ** Math.min(failures - 1, 5), Math.max(86_400_000, config.intervalMs));
    db.update(product.id, { failures, error, checked_at: at, next_check_at: at + delay });
    if (failures === FAILURES_BEFORE_ALERT) {
      db.queue(product.user, `⚠️ *${productName(product)}* (Nr. ${product.id}) konnte ${failures}-mal nicht geprüft werden.\n${error}\n\n${advice(kind, product.id)}\n${product.url}`, { at });
    }
    return { error, kind };
  }

  function saveReading(product, found) {
    const at = now();
    const comparable = product.price != null && product.currency === found.currency;
    const fields = { failures: 0, error: null, checked_at: at, next_check_at: at + config.intervalMs };

    // Huge jumps are usually broken pages: believe them only after a second reading.
    if (comparable && found.cents) {
      const ratio = found.cents / product.price;
      if ((ratio < 0.5 || ratio > 2) && product.pending !== found.cents) {
        db.update(product.id, { ...fields, pending: found.cents, next_check_at: at + Math.min(RETRY_MS, config.intervalMs) });
        return { pending: found.cents, currency: found.currency };
      }
    }

    const price = found.cents ?? product.price;
    const currency = found.cents ? found.currency : (product.currency ?? found.currency);
    const available = Boolean(found.available && found.cents);
    const changed = Boolean(found.cents) && (!comparable || found.cents !== product.price);
    const currencyChanged = product.price != null && product.currency !== currency;

    let baseline = currencyChanged ? price : (product.baseline ?? price);
    const reached = available && product.target != null && price <= product.target && !currencyChanged;
    const reasons = [];

    if (product.available === 0 && available) reasons.push('📦 *Wieder verfügbar*');
    if (currencyChanged) reasons.push(`⚠️ *Währung hat gewechselt* (${product.currency} → ${currency}), bitte den Zielpreis prüfen`);

    if (product.price != null && !currencyChanged && available) {
      if (reached && !product.target_hit) {
        reasons.push(`🎯 *Zielpreis ${formatMoney(product.target, currency)} erreicht*`);
        baseline = price;
      } else if (price < baseline) {
        // Compared with the last alert, so many small drops still add up.
        const percent = ((baseline - price) / baseline) * 100;
        if ((product.target == null || reached) && percent >= (product.min_drop ?? config.minDropPercent)) {
          reasons.push(`📉 *Preis gesunken* (−${percent.toFixed(1).replace('.', ',')} %, vorher ${formatMoney(baseline, currency)})`);
          baseline = price;
        }
      } else if (price > baseline) {
        if (config.notifyIncrease) reasons.push(`📈 *Preis gestiegen* (vorher ${formatMoney(baseline, currency)})`);
        baseline = price;
      }
    }

    // The reply to adding covers only the first check; a price found later needs its own alert.
    if (product.price == null && product.checked_at != null && reached && !product.target_hit) {
      reasons.push(`🎯 *Zielpreis ${formatMoney(product.target, currency)} erreicht*`);
    }

    db.update(product.id, {
      ...fields,
      title: found.title,
      price,
      baseline,
      currency,
      pending: null,
      available: Number(available),
      is_from: Number(found.from),
      // While sold out, remember whether the target was already reported.
      target_hit: available ? Number(reached) : product.target_hit,
    });
    if (changed) db.record(product.id, at, price, currency);

    if (reasons.length) {
      const amount = `${found.from ? 'ab ' : ''}${formatMoney(price, currency)}`;
      const lines = [reasons.join('\n'), '', `*${productName({ ...product, title: found.title })}* (Nr. ${product.id})`, `Jetzt *${amount}*`];
      const low = db.stats(product.id, currency)?.low;
      if (changed && product.price != null && price < product.price && price === low) lines.push('⭐ Tiefster Preis seit Beobachtung');
      lines.push(product.url);
      if (reached && !product.target_hit) lines.push('', `Gekauft? Dann \`löschen ${product.id}\``);
      db.queue(product.user, lines.join('\n'), { at });
    }
    return { product: db.product(product.id) };
  }

  let sweeping = false;
  async function checkDue() {
    if (sweeping) return;
    sweeping = true;
    try {
      const lastRequest = new Map();
      let checked = 0;
      let failed = 0;
      for (const product of db.due(now())) {
        const host = new URL(product.url).hostname;
        const wait = (lastRequest.get(host) ?? 0) + HOST_GAP_MS - Date.now();
        if (wait > 0) await new Promise((done) => setTimeout(done, wait));
        // The user may have paused or deleted it while we waited.
        const latest = db.product(product.id);
        if (!latest || latest.paused) continue;
        lastRequest.set(host, Date.now());
        const { error } = await check(product.id);
        checked++;
        if (error) failed++;
      }
      // Shows in the window that the bot is working.
      if (checked) log(`Preise geprüft: ${checked - failed} von ${checked} erfolgreich.`);
    } finally {
      sweeping = false;
    }
  }

  return { check, checkDue, changeSelector };
}
