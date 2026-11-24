// Shopping list, to-dos and notes: "einkauf Milch, Brot", "todo Steuer", "erledigt 3", "notiz …", "suche …"
const LISTS = {
  shopping: { title: '🛒 *Einkaufsliste*', name: 'Einkaufsliste', command: 'einkauf', example: 'einkauf Milch, Brot', split: /[,;\n]+/ },
  todo: { title: '✅ *To-dos*', name: 'To-do-Liste', command: 'todo', example: 'todo Steuer machen', split: /[;\n]+/ },
};
const MAX_ITEMS = 200;
const MAX_ITEM = 100;
const MAX_NOTES = 500;
const MAX_NOTE = 3000;
const SHOWN_NOTES = 15;
const CLEAR = /^(leeren|leer|löschen|loeschen|alles weg|alle weg|weg)$/i;
const REMOVE = /^(weg|löschen|lösche|loeschen|entfernen)$/i;
// Words in almost every question, they say nothing about what is meant.
const COMMON = new Set(['habe', 'hast', 'haben', 'sind', 'mein', 'meine', 'meinen', 'meinem', 'meiner', 'deine', 'nicht', 'noch', 'auch', 'eine', 'einen', 'einer',
  'kann', 'kannst', 'bitte', 'mich', 'dich', 'dass', 'oder', 'aber', 'schon', 'heute', 'morgen', 'gerade', 'wieder', 'dann', 'denn', 'doch', 'jetzt',
  'hier', 'dort', 'warum', 'wieso', 'welche', 'welcher', 'welches', 'gibt', 'machen', 'mach', 'soll', 'will', 'wollte', 'brauche', 'wurde', 'wird',
  'wann', 'woher', 'wohin', 'nochmal', 'eigentlich', 'immer', 'alles', 'etwas', 'viel', 'wieviel', 'dein', 'unser', 'unsere', 'diese', 'dieser', 'dieses']);

const clean = (text) => text.replace(/^[\s\-•*·]+/, '').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();
const firstLine = (text, max = 50) => {
  const line = text.split('\n')[0];
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function createLists({ db, now = Date.now }) {
  function show(user, list, head = '') {
    const { title, example, name } = LISTS[list];
    const items = db.items(user, list);
    const top = head ? `${head}\n\n` : '';
    if (!items.length) return `${top}Die ${name} ist leer. Hinzufügen: \`${example}\``;
    const lines = items.map((item) => `${item.nr}. ${item.text}`);
    return `${top}${title} (${items.length})\n${lines.join('\n')}\n\n_Abhaken:_ \`erledigt ${items[0].nr}\``;
  }

  function addTo(user, list, value, quiet) {
    if (!value.trim()) return show(user, list);
    if (CLEAR.test(value.trim())) return clear(user, list);
    // "einkauf weg 3" means "erledigt 3"
    const removal = value.trim().match(/^(\S+)\s+([\d\s,;#]+)$/);
    if (removal && REMOVE.test(removal[1])) return done(user, removal[2], quiet);

    const { split } = LISTS[list];
    const existing = new Set(db.items(user, list).map((item) => item.text.toLowerCase()));
    const texts = [];
    const twice = [];
    const parts = value.split(split);
    // "Milch, Eier und Butter" is three things, "Salz und Pfeffer" alone stays one.
    if (list === 'shopping' && parts.length > 1) parts.push(...parts.pop().split(/\s+und\s+/i));
    for (const part of parts) {
      const text = clean(part);
      if (!text) continue;
      if (text.length > MAX_ITEM) return `Ein Eintrag darf höchstens ${MAX_ITEM} Zeichen haben. Für Längeres gibt es \`notiz\`.`;
      if (existing.has(text.toLowerCase())) twice.push(text);
      else {
        existing.add(text.toLowerCase());
        texts.push(text);
      }
    }
    if (!texts.length && !twice.length) return quiet ? null : show(user, list);
    if (db.items(user).length + texts.length > MAX_ITEMS) return `Deine Listen sind voll (${MAX_ITEMS} Einträge). Hak erst etwas ab.`;

    db.addItems(user, list, texts, now());
    const head = [];
    if (texts.length) head.push(`➕ ${texts.join(', ')}`);
    if (twice.length) head.push(`Steht schon drauf: ${twice.join(', ')}`);
    return show(user, list, head.join('\n'));
  }

  function clear(user, list) {
    const items = db.items(user, list);
    const { name } = LISTS[list];
    if (!items.length) return `Die ${name} ist schon leer.`;
    db.removeItems(items.map((item) => item.id));
    db.keepInTrash(user, { kind: 'items', items });
    return `🧹 ${name} geleert (${count(items.length, 'Eintrag', 'Einträge')}).\nVersehen? \`rückgängig\``;
  }

  /** "erledigt 3", "erledigt 3 5", "erledigt 3, 5", "erledigt Milch" */
  function done(user, value, quiet) {
    const all = db.items(user);
    if (!all.length) return quiet ? null : 'Deine Listen sind leer. Hinzufügen: `einkauf Milch, Brot` oder `todo Steuer machen`';
    const text = value.trim().replace(/[.!]+$/, '');
    if (!text) return quiet ? null : `So geht es: \`erledigt ${all[0].nr}\` oder \`erledigt ${all[0].text}\``;

    let found;
    if (/^(?:#?\d{1,6}[\s,;+&]*(?:und\s+)?)+$/i.test(text)) {
      const numbers = [...text.matchAll(/\d+/g)].map((match) => Number(match[0]));
      found = all.filter((item) => numbers.includes(item.nr));
      const missing = numbers.filter((nr) => !found.some((item) => item.nr === nr));
      if (missing.length) {
        if (quiet) return null;
        return `${missing.length === 1 ? 'Nummer' : 'Nummern'} ${missing.join(', ')} gibt es nicht.\n\n${overview(user)}`;
      }
    } else {
      const byName = (name) => {
        const search = name.toLowerCase();
        const exact = all.filter((item) => item.text.toLowerCase() === search);
        return exact.length ? exact : all.filter((item) => item.text.toLowerCase().includes(search));
      };
      // "Brot und Butter" may be one entry, "Milch, Brot und Eier" are three.
      const names = [text, ...text.split(/\s*[,;]\s*|\s+und\s+/i).filter(Boolean)];
      const parts = byName(text).length || names.length === 2 ? [text] : names.slice(1);
      found = [];
      for (const name of parts) {
        const matches = byName(name);
        if (!matches.length) return quiet ? null : `„${name.slice(0, 40)}“ steht auf keiner Liste.\n\n${overview(user)}`;
        if (matches.length > 1) {
          if (quiet) return null;
          return `Welches meinst du mit „${name.slice(0, 40)}“?\n${matches.slice(0, 5).map((item) => `\`erledigt ${item.nr}\` ${item.text}`).join('\n')}`;
        }
        if (!found.includes(matches[0])) found.push(matches[0]);
      }
    }

    db.removeItems(found.map((item) => item.id));
    db.keepInTrash(user, { kind: 'items', items: found });
    const lines = [`✔️ Erledigt: ${found.map((item) => item.text).join(', ')}`];
    for (const list of new Set(found.map((item) => item.list))) {
      const left = db.items(user, list).length;
      lines.push(left ? `Noch ${left} auf der ${LISTS[list].name}.` : `🎉 Die ${LISTS[list].name} ist leer.`);
    }
    lines.push('Versehen? `rückgängig`');
    return lines.join('\n');
  }

  function overview(user) {
    const parts = Object.keys(LISTS).filter((list) => db.items(user, list).length).map((list) => show(user, list));
    return parts.join('\n\n') || 'Deine Listen sind leer.';
  }

  function addNote(user, value, quiet) {
    const text = value.trim();
    if (!text) return notes(user);
    const words = text.split(/\s+/);
    if (REMOVE.test(words[0]) && words.length === 2) return removeNote(user, words[1], quiet);
    // "notiz 3" shows note 3. "notiz 3 Reifen gewechselt" is a new note.
    const nr = text.match(/^(?:nr\.?\s*|#)?(\d{1,6})[.!]?$/i)?.[1];
    if (nr && db.note(user, Number(nr))) return showNote(user, Number(nr));

    if (text.length > MAX_NOTE) return `Eine Notiz darf höchstens ${MAX_NOTE} Zeichen haben.`;
    if (db.notes(user).length >= MAX_NOTES) return `Du hast ${MAX_NOTES} Notizen. Lösch alte mit \`notiz weg\` und der Nummer.`;
    const note = db.addNote(user, text, now());
    return `📝 Notiz ${note.nr} gespeichert.\nWiederfinden: \`suche ${firstWord(text)}\` · alle: \`notizen\``;
  }

  function firstWord(text) {
    return text.split(/\s+/).find((word) => word.replace(/\W/g, '').length >= 3)?.replace(/[^\p{L}\p{N}-]/gu, '').toLowerCase() || 'wort';
  }

  function notes(user) {
    const rows = db.notes(user);
    if (!rows.length) return '📝 Noch keine Notizen. So geht es: `notiz WLAN Gäste: sonne123`';
    const lines = rows.slice(0, SHOWN_NOTES).map((note) => `*${note.nr}.* ${firstLine(note.text)}`);
    if (rows.length > SHOWN_NOTES) lines.push(`… und ${rows.length - SHOWN_NOTES} ältere. Finden mit \`suche\`.`);
    return `📝 *Notizen* (${rows.length})\n${lines.join('\n')}\n\n_Ganz lesen:_ \`notiz ${rows[0].nr}\``;
  }

  function showNote(user, nr) {
    const note = db.note(user, nr);
    const date = new Date(note.at).toLocaleDateString('de-DE', { dateStyle: 'medium' });
    return `📝 *Notiz ${nr}* _(${date})_\n${note.text}\n\n_Löschen:_ \`notiz weg ${nr}\``;
  }

  function removeNote(user, value, quiet) {
    const nr = Number(value.replace(/^#|[.!]$/g, ''));
    const note = Number.isInteger(nr) && db.note(user, nr);
    if (!note) return quiet ? null : `Notiz ${value} gibt es nicht.\n\n${notes(user)}`;
    db.removeNote(note.id);
    db.keepInTrash(user, { kind: 'note', note });
    return `🗑️ Notiz ${nr} gelöscht: _${firstLine(note.text)}_\nVersehen? \`rückgängig\``;
  }

  /** Finds notes, list entries and reminders that contain every word. */
  function search(user, value, quiet, reminders) {
    const words = value.toLowerCase().split(/\s+/).map((word) => word.replace(/[!?.,]+$/, '')).filter(Boolean);
    if (!words.length) return quiet ? null : 'So geht es: `suche wlan`. Ich suche in Notizen, Listen und Erinnerungen.';
    const matches = (text) => words.every((word) => text.toLowerCase().includes(word));

    const sections = [];
    const found = db.notes(user).filter((note) => matches(note.text));
    if (found.length === 1) sections.push(showNote(user, found[0].nr));
    else if (found.length) sections.push(`📝 *Notizen*\n${found.slice(0, 10).map((note) => `*${note.nr}.* ${firstLine(note.text, 70)}`).join('\n')}`);
    const items = db.items(user).filter((item) => matches(item.text));
    if (items.length) sections.push(`📋 *Listen*\n${items.map((item) => `${item.nr}. ${item.text} _(${LISTS[item.list].name})_`).join('\n')}`);
    const due = reminders.filter((reminder) => matches(reminder.text));
    if (due.length) sections.push(`⏰ *Erinnerungen*\n${due.map((reminder) => `*${reminder.nr}.* ${reminder.text}`).join('\n')}`);

    if (!sections.length) return quiet ? null : `Zu „${value.slice(0, 40)}“ habe ich nichts gefunden.`;
    return sections.join('\n\n');
  }

  /**
   * For a sentence the bot did not understand, like "wo ist mein wlan passwort":
   * notes and list entries that share a word with it, best match first.
   */
  function related(user, text) {
    const words = [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u))].filter((word) => word.length >= 4 && !COMMON.has(word));
    if (!words.length) return null;
    const hits = (entry) => words.filter((word) => entry.toLowerCase().includes(word)).length;
    const found = [
      ...db.notes(user).map((note) => ({ hits: hits(note.text), line: `📝 *Notiz ${note.nr}:* ${firstLine(note.text, 70)}` })),
      ...db.items(user).map((item) => ({ hits: hits(item.text), line: `📋 ${item.nr}. ${item.text} _(${LISTS[item.list].name})_` })),
    ].filter((entry) => entry.hits).sort((a, b) => b.hits - a.hits).slice(0, 3);
    if (!found.length) return null;
    return `Meinst du das?\n\n${found.map((entry) => entry.line).join('\n')}\n\n_Suchen: \`suche ${words[0]}\` · alle Befehle: \`hilfe\`_`;
  }

  function restoreItems(user, { items }) {
    db.restoreItems(items);
    const lists = [...new Set(items.map((item) => item.list))];
    return lists.map((list) => show(user, list, list === lists[0] ? `↩️ Wieder da: ${items.map((item) => item.text).join(', ')}` : '')).join('\n\n');
  }

  function restoreNote(user, { note }) {
    const restored = db.restoreNote(note);
    return `↩️ Notiz ${restored.nr} ist wieder da.`;
  }

  return {
    shopping: (user, value, quiet) => addTo(user, 'shopping', value, quiet),
    todo: (user, value, quiet) => addTo(user, 'todo', value, quiet),
    done,
    note: addNote,
    notes,
    search,
    restoreItems,
    restoreNote,
    overview,
    related,
    items: (user, list) => db.items(user, list),
  };
}
