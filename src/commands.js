import { UserError } from './errors.js';
import { validateUrl } from './fetch-page.js';
import { exportCsv } from './export.js';
import { helpText } from './help.js';
import { actionOf, parseInput, parseTarget, suggest } from './input.js';
import { advice, details, listEntry, priceText, productName, targetText } from './messages.js';
import { formatMoney } from './money.js';
import { createOptions } from './options.js';
import { currentSeries, periodStats, sparkline } from './stats.js';

const TRACKING_PARAMS = /^(utm_\w+|gclid|gbraid|wbraid|fbclid|msclkid|igshid|mc_cid|mc_eid)$/i;
const MAX_LINKS = 5;

const USAGE = {
  show: (id) => `zeige ${id}`,
  check: (id) => `prüfen ${id}`,
  target: (id) => `ziel ${id} 89,90`,
  history: (id) => `verlauf ${id}`,
  remove: (id) => `löschen ${id}`,
  selector: (id) => `selektor ${id} .price`,
  pause: (id) => `pause ${id}`,
  resume: (id) => `weiter ${id}`,
  rename: (id) => `name ${id} Kopfhörer`,
  threshold: (id) => `schwelle ${id} 5%`,
};
const TAKES_VALUE = new Set(['target', 'selector', 'rename', 'threshold']);
// Everyday words: in the self-chat they need a valid number to count as a command.
const EVERYDAY_WORDS = new Set(['pause', 'resume', 'rename', 'threshold']);

const WELCOME = `👋 *Hallo, ich bin dein Preistracker.*

1. Öffne ein Produkt im Shop.
2. Tippe auf „Teilen“ und schick es mir.
3. Ich melde mich, wenn der Preis fällt.

\`liste\` zeigt deine Produkte, \`hilfe\` alle Befehle.`;

const EMPTY = 'Du beobachtest noch nichts. Schick mir einfach einen Produktlink, am schnellsten über „Teilen“ im Shop.';
const NEEDS_PRICE = 'Ein Ziel in Prozent geht erst, wenn ein Preis da ist.';

function normalize(link) {
  const url = validateUrl(link);
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  return url.href;
}

export function createCommands({ db, tracker, config, now = Date.now }) {
  const options = createOptions({ db, config, empty: EMPTY, now });
  function yourProducts(user) {
    const products = db.products(user);
    if (!products.length) return EMPTY;
    const lines = products.slice(0, 10).map((p) => `${p.id}. ${productName(p)}`);
    if (products.length > 10) lines.push('… alle mit `liste`');
    return `Deine Produkte:\n${lines.join('\n')}`;
  }

  function owned(user, ref) {
    if (ref.link) {
      const product = db.byUrl(user, normalize(ref.link));
      if (product) return product;
      throw new UserError(`Diesen Link beobachtest du nicht.\n\n${yourProducts(user)}`);
    }
    const product = db.product(ref.id);
    if (product?.user === user) return product;
    throw new UserError(`Produkt ${ref.id} gibt es nicht.\n\n${yourProducts(user)}`);
  }

  function usage(user, action, id) {
    const products = db.products(user);
    if (!products.length) return EMPTY;
    const which = id ? '' : `\n\n${yourProducts(user)}`;
    return `So geht es: \`${USAGE[action](id ?? products[0].id)}\`${which}`;
  }

  function resolveTarget(product, parsed) {
    if (parsed.cents) return parsed.cents;
    if (!product.price) return null;
    return Math.max(1, Math.round(product.price * (1 - parsed.percent / 100)));
  }

  function saveTarget(product, target) {
    const hit = product.available === 1 && product.price <= target;
    db.update(product.id, { target, target_hit: Number(hit) });
    return db.product(product.id);
  }

  async function add(user, link, after) {
    const url = normalize(link);
    const parsed = after ? parseTarget(after) : null;
    // Text that looks like a target but is not one must not be dropped silently.
    const unclear = !parsed && /^(?:ziel|unter|max|[-−]?\d)/i.test(after);
    const notUnderstood = (id) =>
      `⚠️ „${after.slice(0, 40)}“ habe ich nicht als Zielpreis verstanden. Beispiel: \`ziel ${id} 89,90\``;

    let product = db.byUrl(user, url);
    if (product) {
      const target = parsed && resolveTarget(product, parsed);
      if (target) product = saveTarget(product, target);
      let note = '';
      if (target) note = ' Den Zielpreis habe ich aktualisiert.';
      else if (parsed) note = ` ${NEEDS_PRICE}`;
      else if (unclear) note = `\n${notUnderstood(product.id)}`;
      return `Das beobachtest du schon.${note}\n\n${details(product, config.currency)}`;
    }
    if (db.products(user).length >= config.maxProducts) {
      throw new UserError(`Du hast das Limit von ${config.maxProducts} Produkten erreicht. Mach mit \`löschen\` Platz.`);
    }

    product = db.add(user, url, parsed?.cents);
    const { id } = product;
    const result = await tracker.check(id);

    if (result.error) {
      if (result.kind === 'gone' || result.kind === 'invalid') {
        db.remove(id);
        return `❌ *Nicht gespeichert*\n${result.error}\nPrüf den Link und schick ihn noch einmal.`;
      }
      const lines = [`⚠️ *Nr. ${id} gespeichert, aber noch ohne Preis*`, result.error];
      if (parsed?.percent) lines.push(NEEDS_PRICE);
      if (unclear) lines.push(notUnderstood(id));
      lines.push('', advice(result.kind, id));
      return lines.join('\n');
    }

    product = db.product(id);
    if (parsed?.percent && product.price) product = saveTarget(product, resolveTarget(product, parsed));

    const lines = ['✅ *Wird beobachtet*', `*${id}. ${productName(product)}*`, priceText(product)];
    if (product.target) lines.push(targetText(product, config.currency));

    lines.push('');
    if (unclear) {
      lines.push(notUnderstood(id));
    } else if (parsed?.percent && !product.target) {
      lines.push(NEEDS_PRICE);
    } else if (!product.target && product.price) {
      const example = Math.max(1, Math.floor((product.price * 0.9) / 100));
      lines.push(`Ich melde mich, wenn er fällt. Mit Wunschpreis: \`ziel ${id} ${example}\``);
    }
    lines.push(`Falsches Produkt? \`löschen ${id}\``);
    return lines.join('\n');
  }

  async function addAll(user, links) {
    const unique = [...new Map(links.map((item) => [item.link, item])).values()];
    const replies = [];
    for (const { link, after } of unique.slice(0, MAX_LINKS)) {
      try {
        replies.push(await add(user, link, after));
      } catch (error) {
        if (!(error instanceof UserError)) throw error;
        replies.push(`❌ ${link}\n${error.message}`);
      }
    }
    if (unique.length > MAX_LINKS) {
      replies.push(`Ich nehme ${MAX_LINKS} Links pro Nachricht. Schick die übrigen ${unique.length - MAX_LINKS} bitte noch einmal.`);
    }
    return replies.join('\n\n');
  }

  function list(user) {
    const products = db.products(user);
    if (!products.length) return EMPTY;
    const entries = products.map((p) => listEntry(p, db.firstPrice(p.id, p.currency), config.currency));
    const count = `${products.length} ${products.length === 1 ? 'Produkt' : 'Produkte'}`;
    return `📋 *${count}*\n\n${entries.join('\n\n')}\n\n_Mit Link ansehen:_ \`zeige ${products[0].id}\``;
  }

  async function check(product) {
    const result = await tracker.check(product.id);
    if (result.error) {
      const last = product.price ? `\nLetzter Preis: ${priceText(product)}` : '';
      return `⚠️ *${productName(product)}*\n${result.error}${last}\n\n${advice(result.kind, product.id)}`;
    }
    if (result.pending) {
      return `Ungewöhnlicher Preissprung auf ${formatMoney(result.pending, result.currency)}. ` +
        'Ich prüfe in 10 Minuten noch einmal, bevor ich ihn übernehme.';
    }

    const latest = result.product;
    let change = '';
    if (product.price && latest.price && product.currency === latest.currency) {
      change = product.price === latest.price ? 'Preis unverändert\n' : `Vorher ${formatMoney(product.price, product.currency)}\n`;
    }
    return `🔄 ${change}${details(latest, config.currency)}`;
  }

  function setTarget(product, value) {
    const { id } = product;
    const name = `*${id}. ${productName(product)}*`;
    if (/^(aus|weg|kein|0|-)$/i.test(value)) {
      db.update(id, { target: null, target_hit: 0 });
      return `Zielpreis entfernt. Ich melde mich wieder bei jeder spürbaren Senkung.\n${name}`;
    }

    const parsed = parseTarget(value);
    if (!parsed) {
      const problem = value ? `„${value.slice(0, 40)}“ verstehe ich nicht als Preis.\n` : '';
      return `${problem}So geht es:\n` +
        `\`ziel ${id} 89,90\` fester Preis\n` +
        `\`ziel ${id} -10%\` 10 % unter dem jetzigen Preis\n` +
        `\`ziel ${id} aus\` entfernen`;
    }
    const target = resolveTarget(product, parsed);
    if (!target) return `${NEEDS_PRICE} So geht es: \`ziel ${id} 89,90\``;

    const saved = saveTarget(product, target);
    return `✅ Zielpreis gespeichert\n${name}\n${priceText(saved)}\n${targetText(saved, config.currency)}`;
  }

  async function setSelector(user, product, value) {
    if (!value) return usage(user, 'selector', product.id);
    const selector = value.toLowerCase() === 'auto' ? null : value;
    const result = await tracker.changeSelector(product.id, selector);
    if (result.error) {
      return `⚠️ ${result.error}\nIch habe nichts geändert, Einstellung und Verlauf bleiben wie bisher.`;
    }
    const mode = selector ? 'Preisfeld übernommen' : 'Wieder automatisch erkannt';
    return `✅ ${mode}, der Verlauf beginnt neu.\n\n${details(result.product, config.currency)}`;
  }

  function history(product) {
    const rows = db.history(product.id, 15);
    if (!rows.length) return `Für *${productName(product)}* gibt es noch keinen Preis.`;

    const { id, currency } = product;
    const money = (cents) => formatMoney(cents, currency);
    const { low, high } = db.stats(id, currency);
    const head = [`📈 *${id}. ${productName(product)}*`, `Jetzt ${priceText(product)}`, `Tief ${money(low)} · Hoch ${money(high)}`];

    const series = currentSeries(db.allHistory(id), currency);
    if (series.length > 1) {
      const at = now();
      const month = periodStats(series, at, 30);
      if (month.span >= 86_400_000) {
        head.push(`30 Tage: Tief ${money(month.low)} · Ø ${money(month.average)}`);
      }
      const line = sparkline(series, at);
      if (line) head.push(`\`${line}\``);
      if (product.available !== 0) {
        const above = ((product.price - low) / low) * 100;
        if (product.price === low) head.push('⭐ So günstig wie noch nie seit Beobachtung');
        else head.push(`${above < 1 ? 'Weniger als 1' : Math.round(above)} % über dem Tiefstpreis`);
      }
    }

    const lines = rows.map((row, i) => {
      const older = rows[i + 1];
      let arrow = '•';
      if (older && older.currency === row.currency) arrow = row.price < older.price ? '↓' : '↑';
      const date = new Date(row.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
      return `${arrow} ${date}  ${formatMoney(row.price, row.currency)}`;
    });
    if (rows.length === 1) lines.push('_Seitdem keine Änderung._');
    return `${head.join('\n')}\n\n${lines.join('\n')}`;
  }

  function exportData(user) {
    if (!db.products(user).length) return EMPTY;
    return {
      text: '📄 Deine Produkte mit Preisverlauf. Öffnet in Excel und anderen Tabellenprogrammen.',
      file: { name: 'preise.csv', mimetype: 'text/csv', data: exportCsv(db, user) },
    };
  }

  function remove(product) {
    db.moveToTrash(product);
    return `🗑️ Gelöscht: *${productName(product)}*\nVersehen? Schreib \`rückgängig\`.`;
  }

  function undo(user) {
    const deleted = db.trashed(user);
    if (!deleted) return 'Es gibt nichts wiederherzustellen. Zurückholen kann ich nur das zuletzt gelöschte Produkt.';
    const same = db.byUrl(user, deleted.product.url);
    if (same) return `Dieses Produkt beobachtest du schon wieder als Nr. ${same.id}.`;
    if (db.products(user).length >= config.maxProducts) return 'Deine Liste ist voll, ich kann es nicht zurückholen.';
    db.restore(user, deleted);
    return `↩️ Wieder da, mit Verlauf:\n\n${details(db.product(deleted.product.id), config.currency)}`;
  }

  function unknown(user, text) {
    const [first, ...others] = text.trim().split(/\s+/);
    const action = actionOf(first.replace(/[!?.,:]+$/, ''));
    if (USAGE[action]) return byName(user, action, others);
    if (action === 'help') return helpText(config);
    if (action === 'list') return list(user);

    const guess = suggest(text);
    if (guess) return `Meintest du \`${guess}\`?`;
    return 'Das habe ich nicht verstanden.\n\n' +
      '• Schick einen *Produktlink* zum Beobachten\n' +
      '• `liste` zeigt deine Produkte\n' +
      '• `hilfe` zeigt alle Befehle';
  }

  /** "löschen billy": point to the number, but never act on a name. */
  function byName(user, action, words) {
    const search = words.map((word) => word.toLowerCase()).filter((word) => word.length >= 3 && !/\d/.test(word));
    const matches = db.products(user).filter((product) => search.some((word) => `${product.name ?? ''} ${product.title}`.toLowerCase().includes(word)));
    if (!matches.length) return usage(user, action);
    const lines = matches.slice(0, 5).map((product) => `\`${USAGE[action](product.id)}\` ${productName(product)}`);
    return `Meinst du das? Dann schick:\n${lines.join('\n')}`;
  }

  /**
   * Returns the reply (text, or { text, file }), or null for ordinary notes in the self-chat.
   * quiet = self-chat: only answer what is clearly meant for the bot.
   */
  return async function handle(user, text, { quiet = false } = {}) {
    const input = parseInput(text);
    if (!input) return quiet ? null : unknown(user, text);
    const { action, ref, value } = input;

    try {
      switch (action) {
        case 'add': return await addAll(user, input.links);
        case 'help': return quiet && text.trim() === '?' ? null : helpText(config);
        case 'hello': return quiet ? null : WELCOME;
        case 'thanks': return quiet ? null : 'Gern! 👍';
        case 'list': return list(user);
        case 'undo': return undo(user);
        case 'export': return exportData(user);
        case 'quietHours': return options.setQuietHours(user, value, quiet);
        case 'report': return options.report(user, value, quiet);
        case 'number': return quiet ? null : details(owned(user, ref), config.currency);
      }

      if (ref?.all) return options.setAllPaused(user, action === 'pause');
      if (quiet && EVERYDAY_WORDS.has(action)) {
        // "Pause 15 Minuten" is a note. A link or an existing number is a command.
        if (!ref || (ref.id && db.product(ref.id)?.user !== user)) return null;
      }
      if (!ref) return usage(user, action);
      // "prüfen 3 Rechnungen" is a note, not a command.
      if (value && !TAKES_VALUE.has(action)) {
        return quiet ? null : usage(user, action, ref.id);
      }

      const product = owned(user, ref);
      switch (action) {
        case 'show': return details(product, config.currency);
        case 'check': return await check(product);
        case 'target': return setTarget(product, value);
        case 'history': return history(product);
        case 'remove': return remove(product);
        case 'selector': return await setSelector(user, product, value);
        case 'pause': return options.setPaused(product, true);
        case 'resume': return options.setPaused(product, false);
        case 'rename': return options.rename(product, value, quiet);
        case 'threshold': return options.setThreshold(product, value, quiet);
      }
      return quiet ? null : unknown(user, text);
    } catch (error) {
      if (error instanceof UserError) return error.message;
      throw error;
    }
  };
}
