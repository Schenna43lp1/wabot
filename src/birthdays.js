// "geburtstag Anna 12.3.1990", "geburtstage", "geburtstag weg 2"
import { capitalize, DAYS } from './schedule.js';

const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const MAX_BIRTHDAYS = 300;
const MAX_NAME = 50;
const SHOWN = 30;
const NOTIFY_HOUR = 9;
const SOON_DAYS = 3;
const DAY_MS = 86_400_000;
const REMOVE = /^(weg|löschen|lösche|loeschen|entfernen)$/i;

const startOfDay = (ms) => {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};
const shortDate = (ms) => {
  const date = new Date(ms);
  return `${capitalize(DAYS[date.getDay()]).slice(0, 2)} ${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`;
};

/** The day in a year; 29 February is the 28th in other years. */
function dayIn(year, { month, day }) {
  const last = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, Math.min(day, last)).getTime();
}

/** The next birthday from today on (today included), with the age then. */
export function nextBirthday(birthday, at) {
  const today = startOfDay(at);
  let year = new Date(at).getFullYear();
  if (dayIn(year, birthday) < today) year++;
  return { start: dayIn(year, birthday), age: birthday.year ? year - birthday.year : null };
}

/** Finds the date in "Anna 12.3.1990", "12. März Anna", "Anna am 3.10." */
export function parseBirthday(text, now) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let day;
    let month;
    let year;
    let used = 1;
    const numeric = words[i].match(/^(\d{1,2})\.(\d{1,2})\.?(\d{4}|\d{2})?[,.]?$/);
    const named = words[i].match(/^(\d{1,2})\.$/) && words[i + 1]?.toLowerCase().replace(/[.,]$/, '');
    if (numeric) {
      [day, month] = [Number(numeric[1]), Number(numeric[2])];
      year = numeric[3] ? Number(numeric[3]) : null;
    } else if (named) {
      const index = MONTHS.findIndex((name) => name === named || (named.length >= 3 && name.startsWith(named)));
      if (index < 0) continue;
      [day, month] = [Number(words[i].slice(0, -1)), index + 1];
      used = 2;
      const next = words[i + 2]?.match(/^(\d{4})[,.]?$/);
      if (next) {
        year = Number(next[1]);
        used = 3;
      }
    } else {
      continue;
    }
    if (year != null && year < 100) year += year > new Date(now).getFullYear() % 100 ? 1900 : 2000;
    // 29 February must exist in the year of birth, otherwise in a leap year.
    const check = new Date(year ?? 2000, month - 1, day);
    if (check.getMonth() !== month - 1 || check.getDate() !== day) return { error: 'Dieses Datum gibt es nicht.' };
    if (year != null && (year < 1900 || new Date(year, month - 1, day).getTime() > now)) return { error: 'Das Geburtsjahr kann nicht stimmen.' };

    const rest = [...words.slice(0, i), ...words.slice(i + used)]
      .filter((word) => !/^(am|hat|von|ist|geboren|geb\.?|-|–|:)$/i.test(word));
    const name = rest.join(' ').replace(/[*_~`]/g, '').replace(/[,:;]+$/, '').trim();
    if (!name) return null;
    if (name.length > MAX_NAME) return { error: `Der Name darf höchstens ${MAX_NAME} Zeichen haben.` };
    return { name, day, month, year: year ?? null };
  }
  return null;
}

function ageText(age, today) {
  if (age == null) return '';
  return today ? ` (wird heute ${age})` : ` (wird ${age})`;
}

export function createBirthdays({ db, now = Date.now }) {
  function list(user) {
    const rows = db.birthdays(user);
    if (!rows.length) return '🎂 Noch keine Geburtstage. So geht es: `geburtstag Anna 12.3.1990` (das Jahr ist freiwillig)';
    const at = now();
    const today = startOfDay(at);
    const upcoming = rows.map((row) => ({ row, ...nextBirthday(row, at) })).sort((a, b) => a.start - b.start || a.row.name.localeCompare(b.row.name));
    const lines = upcoming.slice(0, SHOWN).map(({ row, start, age }) => {
      const days = Math.round((start - today) / DAY_MS);
      let when = `in ${days} Tagen`;
      if (days === 0) when = '🎉 heute';
      else if (days === 1) when = 'morgen';
      return `*${row.nr}.* ${row.name} – ${shortDate(start)}, ${when}${age != null ? `, wird ${age}` : ''}`;
    });
    if (rows.length > SHOWN) lines.push(`… und ${rows.length - SHOWN} weitere`);
    return `🎂 *Geburtstage* (${rows.length})\n${lines.join('\n')}\n\n_Löschen:_ \`geburtstag weg ${upcoming[0].row.nr}\``;
  }

  function add(user, value, quiet) {
    const text = value.trim();
    if (!text) return list(user);
    const words = text.split(/\s+/);
    if (REMOVE.test(words[0])) return remove(user, words.slice(1).join(' '), quiet);
    const at = now();
    const parsed = parseBirthday(text, at);
    if (!parsed) {
      // "geburtstag anna" without a date looks it up.
      const found = lookUp(user, text, at);
      if (found) return found;
      if (quiet) return null;
      // "wann hat Anna Geburtstag" for someone not saved yet
      const name = text.replace(/^(?:von|für)\s+/i, '');
      if (/^\p{L}[\p{L}' -]{1,40}$/u.test(name) && name.split(/\s+/).length <= 3) {
        return `🎂 Von *${name}* kenne ich keinen Geburtstag.\nSpeichern: \`geburtstag ${name} 12.3.\` oder mit Jahr \`geburtstag ${name} 12.3.1990\``;
      }
      return 'So geht es: `geburtstag Anna 12.3.1990` oder ohne Jahr `geburtstag Anna 12.3.`';
    }
    if (parsed.error) return quiet ? null : parsed.error;

    const existing = db.birthdays(user).find((row) => row.name.toLowerCase() === parsed.name.toLowerCase());
    if (!existing && db.birthdays(user).length >= MAX_BIRTHDAYS) return `Du hast schon ${MAX_BIRTHDAYS} Geburtstage gespeichert.`;
    const row = existing ? db.updateBirthday(existing.id, parsed) : db.addBirthday(user, parsed);
    const { start, age } = nextBirthday(row, at);
    const days = Math.round((start - startOfDay(at)) / DAY_MS);
    const when = days === 0 ? 'heute! 🎉' : `am ${shortDate(start)}, in ${days} ${days === 1 ? 'Tag' : 'Tagen'}`;
    return [
      `🎂 ${existing ? 'Geändert' : 'Gespeichert'}: *${row.name}*, ${String(row.day).padStart(2, '0')}.${String(row.month).padStart(2, '0')}.${row.year ?? ''}`,
      `Nächster Geburtstag ${when}${ageText(age, false)}.`,
      `Ich sage ${SOON_DAYS} Tage vorher und am Tag selbst um ${NOTIFY_HOUR} Uhr Bescheid.`,
    ].join('\n');
  }

  function lookUp(user, name, at) {
    const search = name.toLowerCase().replace(/^(?:von|für)\s+/, '').replace(/s$/, '');
    if (search.length < 2) return null;
    const rows = db.birthdays(user).filter((row) => row.name.toLowerCase().startsWith(search) || row.name.toLowerCase().split(/\s+/).includes(search));
    if (!rows.length) return null;
    const today = startOfDay(at);
    return rows.slice(0, 5).map((row) => {
      const { start, age } = nextBirthday(row, at);
      const days = Math.round((start - today) / DAY_MS);
      let when = `in ${days} Tagen`;
      if (days === 0) when = 'heute! 🎉';
      else if (days === 1) when = 'morgen';
      return `🎂 *${row.name}*: ${String(row.day).padStart(2, '0')}.${String(row.month).padStart(2, '0')}., nächstes Mal am ${shortDate(start)}, ${when}${ageText(age, false)}`;
    }).join('\n');
  }

  function remove(user, value, quiet) {
    const nr = Number(value.match(/^#?(\d{1,6})[.!]?$/)?.[1]);
    const row = nr && db.birthday(user, nr);
    if (!row) return quiet ? null : 'So geht es: `geburtstag weg 2`. Die Nummern zeigt `geburtstage`.';
    db.removeBirthday(row.id);
    db.keepInTrash(user, { kind: 'birthday', birthday: row });
    return `🗑️ Geburtstag gelöscht: *${row.name}*\nVersehen? \`rückgängig\``;
  }

  function restore(user, { birthday }) {
    const row = db.restoreBirthday(birthday);
    return `↩️ Geburtstag wieder da: *${row.name}*`;
  }

  /** Birthdays in [from, to) as { start, name, age }. */
  function between(user, from, to) {
    const found = [];
    for (const row of db.birthdays(user)) {
      const next = nextBirthday(row, from);
      if (next.start < to) found.push({ ...next, name: row.name });
    }
    return found.sort((a, b) => a.start - b.start);
  }

  return { add, list, restore, between };
}

/** At 9 on the day and 3 days before. Quiet hours hold them back like price alerts. */
export function queueBirthdays(db, now = Date.now()) {
  if (new Date(now).getHours() < NOTIFY_HOUR) return;
  const today = startOfDay(now);
  for (const row of db.allBirthdays()) {
    const { start, age } = nextBirthday(row, now);
    const days = Math.round((start - today) / DAY_MS);
    const year = new Date(start).getFullYear();
    if (days === 0 && db.claimOnce(row.user, `birthday:${row.id}:${year}:day`, now)) {
      db.queue(row.user, `🎂 Heute hat *${row.name}* Geburtstag!${ageText(age, true)}`, { at: now });
    } else if (days === SOON_DAYS && db.claimOnce(row.user, `birthday:${row.id}:${year}:soon`, now)) {
      db.queue(row.user, `🎁 In ${SOON_DAYS} Tagen, am ${shortDate(start)}, hat *${row.name}* Geburtstag${ageText(age, false)}. Schon ein Geschenk?`, { at: now });
    }
  }
}
