// "erinnere mich morgen 9 an Arzt", "erinnerungen", "später"
import { isQuiet } from './schedule.js';
import { dueText, nextTime, parseLater, parseReminder, parseWhen, reminderText, ruleText, shortTime } from './when.js';

const MAX_REMINDERS = 100;
const MAX_TEXT = 300;
const SNOOZE_WINDOW_MS = 12 * 3_600_000;
const KEEP_FIRED_MS = 2 * 86_400_000;
const LATE_MS = 5 * 60_000;
const PENDING_MS = 15 * 60_000;
const REMOVE = /^(weg|löschen|lösche|loeschen|entfernen|aus|stopp|stop)$/i;

const USAGE = 'So geht es:\n' +
  '`erinnere mich morgen 9 an Arzt`\n' +
  '`erinnere mich in 30 min an Wäsche`\n' +
  '`erinnere mich jeden Montag 7 an Müll`\n' +
  'Alle ansehen: `erinnerungen`';

const repeatOf = (reminder) => (reminder.repeat ? JSON.parse(reminder.repeat) : null);
const clean = (text) => text.replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();

function whenText(reminder, now) {
  const rule = repeatOf(reminder);
  return rule ? `${ruleText(rule)}, nächstes Mal ${dueText(reminder.due, now)}` : dueText(reminder.due, now);
}

export function createReminders({ db, now = Date.now }) {
  function list(user) {
    const reminders = db.reminders(user);
    if (!reminders.length) return `⏰ Keine Erinnerungen.\n\n${USAGE.replace('\nAlle ansehen: `erinnerungen`', '')}`;
    const at = now();
    const lines = reminders.map((reminder) => {
      const rule = repeatOf(reminder);
      const repeat = rule ? ` 🔁 _${ruleText(rule).replace(/ um .*/, '')}_` : '';
      return `*${reminder.nr}.* ${shortTime(reminder.due, at)} ${reminder.text}${repeat}`;
    });
    const first = reminders[0].nr;
    return `⏰ *Erinnerungen* (${reminders.length})\n${lines.join('\n')}\n\n_Löschen:_ \`erinnerung weg ${first}\``;
  }

  function remove(user, value, quiet) {
    const nr = Number(value.match(/^(?:nr\.?\s*|#)?(\d{1,6})[.!]?$/i)?.[1]);
    if (!nr) return quiet ? null : 'So geht es: `erinnerung weg 2`. Die Nummern zeigt `erinnerungen`.';
    const reminder = db.reminder(user, nr);
    if (!reminder) return quiet ? null : `Erinnerung ${nr} gibt es nicht.\n\n${list(user)}`;
    db.removeReminder(reminder.id);
    db.keepInTrash(user, { kind: 'reminder', reminder });
    return `🗑️ Erinnerung gelöscht: *${reminder.text}*\nVersehen? \`rückgängig\``;
  }

  function create(user, rawText, { due, rule }, at) {
    const text = clean(rawText);
    if (text.length > MAX_TEXT) return `Bitte kürzer, höchstens ${MAX_TEXT} Zeichen. Für längere Texte gibt es \`notiz\`.`;
    if (db.reminders(user).length >= MAX_REMINDERS) {
      return `Du hast schon ${MAX_REMINDERS} Erinnerungen. Lösch alte mit \`erinnerung weg\` und der Nummer.`;
    }
    const first = rule ? nextTime(rule, at) : due;
    const reminder = db.addReminder(user, { text, due: first, repeat: rule });
    const lines = [`⏰ Ich erinnere dich ${whenText(reminder, at)}:`, `*${text}*`];
    if (isQuiet(db.settings(user), first)) lines.push('_Das ist in deiner Ruhezeit. Erinnerungen kommen trotzdem._');
    lines.push('', `Falsch? \`erinnerung weg ${reminder.nr}\` · andere Zeit: \`erinnerung ${reminder.nr} morgen 10\``);
    return lines.join('\n');
  }

  function add(user, value, quiet) {
    const words = value.trim().split(/\s+/);
    if (REMOVE.test(words[0] ?? '')) return remove(user, words.slice(1).join(' '), quiet);
    if (!value.trim()) return list(user);
    const moved = reschedule(user, value);
    if (moved) return moved;

    const at = now();
    const parsed = parseReminder(value, at);
    if (parsed?.error) return `${parsed.error}\n\n${USAGE}`;
    if (parsed) return create(user, parsed.text, parsed, at);

    // Only a time: "erinnere mich morgen 9"
    const time = parseWhen(reminderText(value), at);
    if (time || /^(mich|uns)$/i.test(value.trim())) return quiet ? null : `Woran soll ich dich erinnern?\n\n${USAGE}`;
    // Only a text: ask for the time and take the next message as the answer.
    const text = clean(reminderText(value));
    if (!text || (quiet && !/^(mich|uns)\s/i.test(value.trim()))) return quiet ? null : USAGE;
    db.saveSettings(user, { pending: JSON.stringify({ text, at }) });
    return `⏰ Wann soll ich dich an *${text}* erinnern?\nAntworte z. B. mit \`morgen 9\`, \`in 2 stunden\` oder \`jeden Montag 7\`.`;
  }

  /**
   * The answer to "Wann soll ich dich erinnern?". Returns the reply, or undefined if the
   * message is not a time, which also ends the question.
   */
  function answer(user, input) {
    const settings = db.settings(user);
    if (!settings?.pending) return undefined;
    const pending = JSON.parse(settings.pending);
    const at = now();
    const parsed = at - pending.at <= PENDING_MS ? parseWhen(input, at) : null;
    if (parsed?.error) return `${parsed.error} Wann dann?`;
    db.saveSettings(user, { pending: null });
    return parsed ? create(user, pending.text, parsed, at) : undefined;
  }

  /** "erinnerung 2 morgen 10", "erinnerung verschieben 2 auf freitag" */
  function reschedule(user, value) {
    const match = value.trim().match(/^(?:verschieben?\s+|verschiebe\s+)?(?:nr\.?\s*|#)?(\d{1,6})\s+(?:(?:verschieben|verschiebe|auf|neu|nach)\s+)*(.+)$/i);
    if (!match) return undefined;
    const at = now();
    const parsed = parseWhen(match[2], at);
    if (!parsed) return undefined;
    const reminder = db.reminder(user, Number(match[1]));
    if (!reminder) return `Erinnerung ${match[1]} gibt es nicht.\n\n${list(user)}`;
    if (parsed.error) return parsed.error;

    const oldRule = repeatOf(reminder);
    // A new rule replaces the old one. A single time with a rule only moves the next time.
    const rule = parsed.rule ?? oldRule;
    const due = parsed.rule ? nextTime(parsed.rule, at) : parsed.due;
    db.updateReminder(reminder.id, { due, repeat: rule ? JSON.stringify(rule) : null });
    const moved = db.reminder(user, reminder.nr);
    const lines = [`🔁 Erinnerung ${reminder.nr} verschoben: *${reminder.text}*`];
    if (oldRule && !parsed.rule) lines.push(`Nächstes Mal ${dueText(due, at)}.`, `_Danach wieder ${ruleText(oldRule)}._`);
    else lines.push(`Jetzt ${whenText(moved, at)}.`);
    return lines.join('\n');
  }

  /** "später", "später 30 min", "später morgen 9" for the reminder that came last. */
  function snooze(user, value, quiet) {
    const at = now();
    const last = db.lastFired(user, at - SNOOZE_WINDOW_MS);
    if (!last) return quiet ? null : 'Es gibt keine Erinnerung von vorhin, die ich verschieben kann.';
    const parsed = parseLater(value, at);
    if (!parsed) return quiet ? null : 'So geht es: `später` (10 Minuten), `später 1h` oder `später morgen 9`';
    if (parsed.error) return parsed.error;

    let reminder;
    if (repeatOf(last)) {
      // The rule keeps going, the snooze is a one-off copy.
      reminder = db.addReminder(user, { text: last.text, due: parsed.due });
      db.updateReminder(last.id, { fired_at: null });
    } else {
      db.removeReminder(last.id);
      reminder = db.addReminder(user, { text: last.text, due: parsed.due });
    }
    return `💤 Ich erinnere dich ${dueText(reminder.due, at)} noch einmal:\n*${reminder.text}*`;
  }

  function restore(user, { reminder }) {
    const at = now();
    const rule = repeatOf(reminder);
    const due = rule && reminder.due <= at ? nextTime(rule, at) : reminder.due;
    if (!rule && due <= at) return 'Diese Erinnerung wäre inzwischen schon fällig gewesen. Leg sie bitte neu an.';
    const restored = db.addReminder(user, { text: reminder.text, due, repeat: rule });
    return `↩️ Erinnerung wieder da: *${restored.text}*, ${whenText(restored, at)}.`;
  }

  /** Today's reminders for the briefing. */
  function today(user, at) {
    const end = new Date(at);
    end.setHours(24, 0, 0, 0);
    return db.reminders(user).filter((reminder) => reminder.due < end.getTime());
  }

  return { add, answer, list, snooze, restore, today };
}

/** Sends what is due. A reminder missed while the PC was off comes once, with a note. */
export function queueReminders(db, now = Date.now()) {
  for (const reminder of db.dueReminders(now)) {
    const rule = repeatOf(reminder);
    const lines = [`⏰ *Erinnerung:* ${reminder.text}`];
    if (now - reminder.due > LATE_MS) {
      const was = new Date(reminder.due).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      lines.push(`_Fällig war ${was} Uhr, da war der Bot aus._`);
    }
    const next = rule ? nextTime(rule, now) : null;
    if (next) lines.push(`_Nächstes Mal ${dueText(next, now)}_`);
    lines.push('', 'Noch mal in 10 Minuten? `später`');
    db.transaction(() => {
      // Reminders are what the user asked for, so quiet hours do not hold them back.
      db.queue(reminder.user, lines.join('\n'), { at: now, urgent: true });
      db.updateReminder(reminder.id, { due: next, fired_at: now });
    });
  }
  db.pruneReminders(now - KEEP_FIRED_MS);
}
