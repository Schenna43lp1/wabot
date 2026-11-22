// Commands that change how the bot behaves for a product or a user
import { productName, thresholdText } from './messages.js';
import { clockText, isQuiet, nextReport, parseQuiet, parseReport, reportText } from './schedule.js';
import { overview } from './report.js';

const OFF = /^(aus|weg|kein|keine)$/i;
const MAX_NAME = 60;

/**
 * Every function returns the reply, or null if the text was probably just a note
 * in the self-chat (quiet).
 */
export function createOptions({ db, config, empty, now = Date.now }) {
  function setPaused(product, paused) {
    const name = `*${product.id}. ${productName(product)}*`;
    if (Boolean(product.paused) === paused) return `${name} ${paused ? 'ist schon pausiert' : 'läuft schon'}.`;
    db.update(product.id, paused ? { paused: 1 } : { paused: 0, next_check_at: 0 });
    return paused
      ? `⏸️ Pausiert: ${name}\nIch prüfe nicht mehr, bis du \`weiter ${product.id}\` schreibst.`
      : `▶️ Läuft wieder: ${name}\nIch prüfe den Preis gleich.`;
  }

  function setAllPaused(user, paused) {
    const products = db.products(user);
    if (!products.length) return empty;
    const changing = products.filter((product) => Boolean(product.paused) !== paused);
    if (!changing.length) return paused ? 'Es ist schon alles pausiert.' : 'Es läuft schon alles.';
    db.transaction(() => {
      for (const { id } of changing) db.update(id, paused ? { paused: 1 } : { paused: 0, next_check_at: 0 });
    });
    const count = `${products.length} ${products.length === 1 ? 'Produkt' : 'Produkte'}`;
    return paused
      ? `⏸️ Alles pausiert (${count}). Fortsetzen: \`weiter alle\``
      : `▶️ Alles läuft wieder (${count}). Ich prüfe die Preise gleich.`;
  }

  function rename(product, value, quiet) {
    const { id } = product;
    if (!value) return quiet ? null : `So geht es: \`name ${id} Kopfhörer\`\nShop-Namen zurückholen: \`name ${id} auto\``;
    if (value.toLowerCase() === 'auto') {
      db.update(id, { name: null });
      return `✏️ Nr. ${id} heißt wieder wie im Shop: *${productName({ ...product, name: null })}*`;
    }
    const name = value.replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name || name.length > MAX_NAME || /https?:\/\//i.test(name)) {
      return quiet ? null : `Ein Name braucht 1 bis ${MAX_NAME} Zeichen und darf kein Link sein.`;
    }
    db.update(id, { name });
    return `✏️ Nr. ${id} heißt jetzt *${name}*.`;
  }

  function setThreshold(product, value, quiet) {
    const { id } = product;
    let percent;
    if (/^auto$/i.test(value)) percent = null;
    else if (/^immer$/i.test(value)) percent = 0;
    else {
      const match = value.match(/^(?:ab\s+)?(\d{1,2}(?:[.,]\d)?)\s*(?:%|prozent)$/i);
      if (!match) {
        if (quiet && !value) return null;
        return 'So geht es:\n' +
          `\`schwelle ${id} 5%\` erst ab 5 % Senkung melden\n` +
          `\`schwelle ${id} immer\` jede Senkung melden\n` +
          `\`schwelle ${id} auto\` wie eingestellt (${thresholdText(config.minDropPercent)})`;
      }
      percent = Number(match[1].replace(',', '.'));
    }
    db.update(id, { min_drop: percent });
    const lines = [
      `🔔 *${id}. ${productName(product)}*`,
      `Ich melde ${thresholdText(percent ?? config.minDropPercent)}.`,
    ];
    if (product.target != null) lines.push('Da ein Zielpreis gesetzt ist, gilt das erst, nachdem er erreicht wurde.');
    return lines.join('\n');
  }

  function setQuietHours(user, value, quiet) {
    if (!value) {
      if (quiet) return null;
      const settings = db.settings(user);
      const current = settings?.quiet_from == null
        ? 'Keine Ruhezeit eingestellt.'
        : `Ruhezeit: ${clockText(settings.quiet_from)} bis ${clockText(settings.quiet_to)} Uhr.`;
      return `🌙 ${current}\nEinstellen: \`ruhe 22-7\`, ausschalten: \`ruhe aus\``;
    }
    if (OFF.test(value)) {
      db.saveSettings(user, { quiet_from: null, quiet_to: null });
      return '🔔 Ruhezeit aus. Zurückgehaltene Meldungen kommen innerhalb einer Minute.';
    }
    const hours = parseQuiet(value);
    if (!hours) return quiet ? null : 'So geht es: `ruhe 22-7` oder `ruhe 22:30-6:45`, ausschalten: `ruhe aus`';
    db.saveSettings(user, { quiet_from: hours.from, quiet_to: hours.to });
    return `🌙 Ruhezeit von ${clockText(hours.from)} bis ${clockText(hours.to)} Uhr.\n` +
      'Meldungen sammle ich bis danach. Auf deine Nachrichten antworte ich trotzdem.';
  }

  function report(user, value, quiet) {
    if (!value) {
      const text = overview(db, user, now());
      if (!text) return empty;
      return db.settings(user)?.report_day == null ? `${text}\n\n_Regelmäßig schicken:_ \`übersicht täglich 8\`` : text;
    }
    if (OFF.test(value)) {
      db.saveSettings(user, { report_day: null, report_minute: null, report_next: null });
      return '📊 Die regelmäßige Übersicht ist aus.';
    }
    const when = parseReport(value);
    if (!when) {
      if (quiet) return null;
      return 'So geht es:\n`übersicht täglich 8`\n`übersicht sonntag 18:30`\n`übersicht aus`';
    }
    const next = nextReport(when, now());
    db.saveSettings(user, { report_day: when.day, report_minute: when.minute, report_next: next });

    const lines = [`📊 Die Übersicht kommt ${reportText(when)}.`];
    const settings = db.settings(user);
    if (isQuiet(settings, next)) {
      lines.push(`Das liegt in deiner Ruhezeit, sie kommt daher um ${clockText(settings.quiet_to)} Uhr.`);
    }
    return lines.join('\n');
  }

  return { setPaused, setAllPaused, rename, setThreshold, setQuietHours, report };
}
