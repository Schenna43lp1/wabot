// Turns whole sentences into the short commands that input.js knows:
// "was muss ich einkaufen" → "einkauf", "Milch auf die Einkaufsliste" → "einkauf Milch".
// Only clear sentences: in the self-chat a note must never become a command by accident.
import { actionOf, FREE_TEXT } from './input.js';

const END = '[\\s?!.]*$';
const SHOPPING = '(?:einkaufsliste|einkaufszettel|liste)';
const TODOS = '(?:to-?do-?liste|todo-?liste|to-?dos?|aufgabenliste|aufgaben)';
const LIST = `(${SHOPPING}|${TODOS})`;
const listCommand = (noun) => (new RegExp(`^${SHOPPING}$`, 'i').test(noun) ? 'einkauf' : 'todo');

// What people call the things the bot keeps, and the command that shows them.
const VIEWS = [
  [/^erinnerungen$/i, 'erinnerungen'],
  [/^(?:einkaufsliste|einkaufszettel|einkäufe)$/i, 'einkauf'],
  [/^(?:to-?do-?liste|todo-?liste|to-?dos|aufgaben|aufgabenliste)$/i, 'todo'],
  [/^listen$/i, 'listen'],
  [/^notizen$/i, 'notizen'],
  [/^(?:termine|kalender)$/i, 'termine'],
  [/^geburtstage$/i, 'geburtstage'],
  [/^ausgaben$/i, 'ausgaben'],
  [/^(?:produkte|preise|beobachteten produkte|preisalarme)$/i, 'produkte'],
];
// Words around the thing: "zeig mir bitte meine Erinnerungen", "welche Termine habe ich".
const LEAD = /^(?:(?:bitte|kannst du|könntest du|zeig|zeige|zeig mal|gib|schick|schicke|mir|mal|nochmal|was sind|welche|wie sehen|alle|meine|meinen|mein|die|der|das|aktuellen?|offenen?)\s+)+/i;
const TAIL = /(?:\s+(?:an|aus|habe ich|hab ich|gibt es|gibts|sind da|sind offen|offen|stehen an|bitte|mal|noch|zeigen|anzeigen|da))+$/i;
// Days and periods that the view commands understand themselves.
const PERIOD = /^(?:heute|morgen|übermorgen|diese woche|nächste woche|woche|diesen monat|letzten monat|letzter monat|im \p{L}+|\p{L}+ \d{4}|\d{4})$/iu;

const GREETING = /^(?:guten (?:morgen|tag|abend)|moin moin|grüß gott|grüss gott|hallo (?:bot|du|zusammen)|hi (?:bot|du)|hey (?:bot|du)|na du|huhu)$/i;
const THANKS = /^(?:danke(?:schön| schön| dir| sehr| vielmals| für alles)?|dankeschön|vielen dank|tausend dank|merci|thank you|ty|super,? danke|top,? danke|ok,? danke)[\s!.🙏👍❤️😊]*$/iu;
// Acknowledgements need no answer, a "nicht verstanden" would only be noise.
const ACK = /^(?:ok(?:ay|ey)?|oki|alles klar|klar|passt|gut|sehr gut|super|perfekt|cool|top|prima|klasse|toll|genial|nice|jo|ja|jup|jep|yes|nein|nö|ne|verstanden|gerne|gern|ach so|aha|lol|haha|hm+)[\s!.]*$/i;
const ONLY_SYMBOLS = /^[^\p{L}\p{N}?]+$/u;
const HELP = /^(?:was kannst du(?: alles)?(?: so)?|was kann (?:der bot|ich hier)(?: alles)?|wie funktioniert (?:das|der bot|es)(?: hier)?|wie geht das(?: hier)?|ich brauche hilfe|hilfe bitte|brauche hilfe|anleitung|kommandos|was geht hier)$/i;
const UNDO = /^(?:(?:bitte )?(?:mach(?:e)? )?(?:das |es )?rückgängig(?: machen)?|rückgängig machen|wiederherstellen|zurückholen)$/i;
const PRODUCTS = /^(?:was beobachtest du|welche produkte (?:beobachtest du|habe ich|hab ich)|was überwachst du)$/i;

const ON_LIST = '(?:steht|ist|sind|stehen) (?:alles |noch )*(?:auf|in) (?:der|meiner|unserer|die|meine)';
const SHOPPING_QUESTION = new RegExp(`^(?:was (?:muss|soll|sollte|wollte) ich (?:noch )?(?:ein)?kaufen|was (?:brauche|brauchen) (?:ich|wir)(?: noch)?(?: (?:vom|aus dem) supermarkt)?|was ${ON_LIST} (?:einkaufsliste|einkaufszettel|liste)|was (?:muss|soll) ich (?:noch )?besorgen|was fehlt (?:noch|uns)(?: noch)?)$`, 'i');
const TODO_QUESTION = new RegExp(`^(?:was (?:muss|soll|sollte) ich (?:noch |heute |alles )*(?:tun|machen|erledigen)|was ist (?:noch )?(?:zu tun|offen)|was ${ON_LIST} (?:to-?do-?liste|todo-?liste|aufgabenliste))$`, 'i');
const DAY_QUESTION = /^(?:was (?:steht|liegt) (?:heute )?an|was (?:habe|hab) ich heute(?: vor| für termine| so)?|habe ich heute (?:termine|was vor)|was ist heute(?: los)?|wie sieht mein tag aus|mein tag|mein tagesplan|tagesplan|tagesübersicht|was gibt'?s heute)$/i;
const LATER_QUESTION = /^(?:was (?:steht|liegt) (morgen|übermorgen|diese woche|nächste woche|am wochenende) an|was (?:habe|hab) ich (morgen|übermorgen|diese woche|nächste woche|am wochenende)(?: vor| für termine| so)?|(?:habe|hab) ich (morgen|übermorgen|diese woche|nächste woche|am wochenende) (?:termine|was vor|zeit)|was ist (morgen|übermorgen|am wochenende)(?: los)?|wie sieht (?:mein )?(morgen|die woche|das wochenende) aus)$/i;
// Only in chats with the bot, in the self-chat these may be diary entries.
const NEED = /^(?:ich|wir) (?:brauche|brauchen|benötige|benötigen) (?:noch |dringend |unbedingt |neue[nsr]? )*(.+)$/i;
const RUN_OUT = /^(?:(?:der|die|das) )?(.+?) (?:ist|sind) (?:alle|aufgebraucht)$|^uns fehlt (?:noch )?(.+)$/i;
const MUST = /^ich (?:muss|sollte|soll) (?:noch |unbedingt |dringend |endlich )+(.+)$/i;
// Spoken and typed openers: "Hallo, erinnere mich …", "Ähm, Milch auf die Liste", "Hey Bot, …"
const OPENER = /^(?:(?:hallo|hey|hi|huhu|moin|servus|okay|ok|also|ähm?|öhm|ehm|hm+|ja|na|so|und|bot|alltagshelfer)(?: (?:bot|du))?\s*[,!.:]\s*)+/i;
const WEATHER_QUESTION = /^(?:wie (?:wird|ist) das wetter|wie wird es|wie ist es draußen|wetterbericht|wettervorhersage|regnet es|wird es regnen|schneit es|wird es (?:heute |morgen )?(?:regnen|schneien|kalt|warm|sonnig|heiß)|brauche ich (?:einen )?(?:regen)?schirm|wie (?:kalt|warm) (?:ist|wird) es)(?:\s+(?:heute|morgen|jetzt|gerade|draußen))?(?:\s+in\s+(.+?))?(?:\s+(?:heute|morgen|jetzt|gerade))?$/i;
const SPENT_QUESTION = /^wie ?viel (?:habe|hab) ich (.*?)\s*ausgegeben$/i;
const SPENT = /^(?:ich )?(?:habe |hab )?(.*\d.*?)\s+(?:ausgegeben|bezahlt)$/i;
// "heute 20 € für Essen": the first word after the amount is the category, so these must go.
const SPENT_FILLER = /(?<=^|\s)(?:heute|gestern|eben|gerade|grad|vorhin|insgesamt|so|ca\.?|etwa|für|fuer)\s+/gi;
const BIRTHDAY_QUESTION = /^wann (?:hat|ist) (.+?) geburtstag$|^wann ist (?:der )?geburtstag (?:von )?(.+)$/i;
const BIRTHDAY_IS = /^(.+?) (?:hat|hatte) (?:am |den )?(\d.*?|.*\d) geburtstag$/i;
const BIRTHDAY_ON = /^(.+?) (?:hat|hatte) geburtstag (?:am |den )?(.*\d.*)$/i;
const REMIND_AT_END = /^(?:(?:kannst|könntest|würdest) du |bitte )*mich (?:bitte )?(.+?) erinnern$/i;
// "kannst du mich morgen daran erinnern, die Wäsche aufzuhängen"
const REMIND_CLAUSE = /^(?:(?:kannst|könntest|würdest) du |bitte )*mich (?:bitte )?(.*?)\s*(?:daran |dran )?erinnern, (.+)$/i;
const REMIND_POLITE = /^(?:kannst|könntest|würdest) du mich (?:bitte )?((?:morgen|heute|übermorgen|in |am |um |jeden |nächste).+?)(?: erinnern)?$/i;
const NOTE = /^(?:merk(?:e)? dir|notier(?:e)?(?: dir| mal)?|schreib(?:e)? (?:dir |mal )?auf|schreib(?:e)? dir|speicher(?:e)? (?:dir|mal))(?:\s*[:\-–.!]\s*|\s*,\s*(?:dass\s+)?|\s+dass\s+|\s+)([\s\S]+)$/i;
// Questions like "wo ist mein wlan passwort" find notes by any word, see lists.related.
const SEARCH = /^such(?:e)? nach\s+(.+)$/i;
const ADD_TO_LIST = new RegExp(`^(?:(?:bitte |noch )*(?:füg(?:e)?|setz(?:e)?|schreib(?:e)?|pack(?:e)?|tu(?:e)?|trag(?:e)?|nimm)\\s+)?(?:noch\\s+)?(.+?)\\s+(?:auf|zu|zur|in|an)\\s+(?:die\\s+|der\\s+|meine\\s+|unsere\\s+|den\\s+)?${LIST}(?:\\s+(?:hinzu|ein|dazu|drauf|auf|setzen|schreiben|packen))?$`, 'i');
const REMOVE_FROM_LIST = new RegExp(`^(?:(?:streich(?:e)?|lösch(?:e)?|nimm|entfern(?:e)?)\\s+(.+?)\\s+(?:von|aus)\\s+(?:der\\s+|meiner\\s+|den\\s+)?${LIST}(?:\\s+(?:runter|raus|weg))?|(.+?)\\s+(?:von|aus)\\s+(?:der\\s+|meiner\\s+|den\\s+)?${LIST}\\s+(?:streichen|löschen|nehmen|entfernen|runter|raus))$`, 'i');
const DONE_AT_END = /^(.+?)\s+(?:ist |sind |habe ich |hab ich )?(?:erledigt|abgehakt|gemacht|fertig|done)[\s✅✔️!.]*$/iu;
const BOUGHT = /^(?:ich )?(?:habe |hab )(.+?)\s+gekauft$|^([^\d\s][^\d]*?)\s+gekauft$/i;
const WORD_MATH = /^(?:was|wie ?viele?) (?:ist|sind|ergibt|macht|gibt) (.+)$/i;
const MATH_WORDS = /^(?:[\d.,]+|plus|minus|mal|x|durch|geteilt|hoch|prozent|%|von|wurzel|aus|[-+*/×÷^()]|\s)+$/i;
// Arithmetic on its own: "12*3", "250 + 19%". Phone numbers and dates have no operator between numbers.
const BARE_MATH = /^(?![+0]\d)[\d\s.,()%]*\d\s*(?:[+*×÷^]|\s[-x:/]\s)\s*[\d(][\d\s.,()%+\-*/×÷^x:]*$/;
const CONVERSION_QUESTION = /^(?:was|wie ?viele?) (?:ist|sind|macht|ergibt|kosten|wären) (.+?\s(?:in|nach)\s\S+)$/i;

// Keyboards without umlauts: "fuer", "naechste Woche", "koenntest du".
const SPELLINGS = [
  [/\bfuer\b/gi, 'für'], [/\bueber/gi, 'über'], [/\buebermorgen\b/gi, 'übermorgen'], [/\bnaechst/gi, 'nächst'],
  [/\bkoenn/gi, 'könn'], [/\bwuerd/gi, 'würd'], [/\bgruess/gi, 'grüß'], [/\bdraussen\b/gi, 'draußen'],
  [/\brueckgaengig\b/gi, 'rückgängig'], [/\bloesch/gi, 'lösch'], [/\bfueg/gi, 'füg'], [/\beinkaeufe\b/gi, 'einkäufe'],
  [/\bmuesst/gi, 'müsst'], [/\bwieviel\b/gi, 'wie viel'], [/\bwie vil\b/gi, 'wie viel'], [/\bgeburtstg\b/gi, 'geburtstag'],
];
const SPACED = [[/\bto do\b/gi, 'todo'], [/\bto dos\b/gi, 'todos'], [/\beinkaufs liste\b/gi, 'einkaufsliste'], [/\bnotiz en\b/gi, 'notizen']];
const BYE = /^(?:tschüss|tschüs|tschau|ciao|bye|bis (?:später|morgen|dann|bald|nachher)|gute nacht|n8|schlaf gut|schönen (?:abend|tag)|ade|servus und tschüss)$/i;
const CLOCK = /^(?:wie spät ist es|wie viel uhr ist es|uhrzeit|welcher tag ist heute|welches datum (?:ist|haben wir) heute|der wievielte ist heute|was ist heute für ein tag|welchen tag haben wir)$/i;
const NEW = /^neu(?:e|es|er|en)?\s+(?=(?:notiz|erinnerung|aufgabe|todo|to-do|ausgabe|geburtstag|eintrag)\b)/i;
const CLEAR_LIST = new RegExp(`^(?:lösch(?:e)?|leer(?:e)?|lehr(?:e)?)\\s+(?:die\\s+|meine\\s+|den\\s+|ganze\\s+)*${LIST}$`, 'i');
const WAKE = /^weck(?:e)? mich (?:bitte )?(.+)$/i;
const SAVED = /^(?:was|wie ?viel) (?:habe|hab) ich (?:bisher |schon |insgesamt )*gespart$/i;

/**
 * Returns
 *   { text, sure }  the command to run instead; sure = clearly meant for the bot, also in the self-chat
 *                   chatOnly = only outside the self-chat, where it could be a diary entry
 *   { silent }      an acknowledgement, no answer needed
 *   { answer }      a fixed reply, like "Gute Nacht! 🌙"
 *   { clock }       the time and date
 *   null            nothing to rephrase
 */
export function rephrase(input) {
  const original = input.trim().replace(/\s+/g, ' ').replace(/[\s?!.]+$/, '');
  if (!original || original.length > 300) return null;
  let text = original;
  for (const [pattern, word] of [...SPELLINGS, ...SPACED]) text = text.replace(pattern, word);
  // "Hallo, erinnere mich …": the opener is only politeness, the rest is what counts.
  const opener = text.match(OPENER)?.[0];
  if (opener && opener.length < text.length) {
    const rest = text.slice(opener.length);
    const inner = match(input.trim().replace(OPENER, ''), rest);
    if (inner && !inner.silent) return inner;
    if (actionOf(rest.split(' ')[0].replace(/[!?.,:]+$/, ''))) return { text: rest, sure: false };
  }
  const result = match(input, text);
  // "To Do" → "todo": a spelling fix alone is worth passing on.
  return result ?? (text !== original ? { text, sure: false } : null);
}

function match(input, text) {
  // "neue Notiz: …" is "notiz …"
  if (NEW.test(text)) return { text: text.replace(NEW, ''), sure: false };
  const sure = (command) => ({ text: command, sure: true });
  const plain = (command) => ({ text: command, sure: false });

  if (ONLY_SYMBOLS.test(input.trim())) return { silent: true };
  if (ACK.test(text)) return { silent: true };
  const note = input.trim().match(NOTE);
  if (note) return plain(`notiz ${note[1]}`);
  // These start with a command word but are sentences: "streiche Milch von der Liste", "such nach wlan".
  const removeEarly = text.match(REMOVE_FROM_LIST);
  if (removeEarly) return plain(`erledigt ${removeEarly[1] ?? removeEarly[3]}`);
  const searchEarly = text.match(SEARCH);
  if (searchEarly) return plain(`suche ${searchEarly[1]}`);
  // "todo Steuer erledigt" is already a command, its text stays as it is.
  if (FREE_TEXT.has(actionOf(text.split(' ')[0].replace(/[!?.,:]+$/, '')))) return null;
  if (THANKS.test(input.trim()) || THANKS.test(text)) return plain('danke');
  if (GREETING.test(text)) return plain('hallo');
  if (BYE.test(text)) return { answer: /nacht|n8|schlaf/i.test(text) ? 'Gute Nacht! 🌙' : 'Bis bald! 👋' };
  if (CLOCK.test(text)) return { clock: true };
  if (HELP.test(text)) return sure('hilfe');
  if (UNDO.test(text)) return plain('rückgängig');
  if (PRODUCTS.test(text)) return sure('produkte');

  if (SHOPPING_QUESTION.test(text)) return sure('einkauf');
  if (TODO_QUESTION.test(text)) return sure('todo');
  if (DAY_QUESTION.test(text)) return sure('briefing');
  const later = text.match(LATER_QUESTION);
  if (later) return sure(`termine ${later.slice(1).find(Boolean)}`);
  const weather = text.match(WEATHER_QUESTION);
  // "morgen" decides which day comes first, "übermorgen" does not count.
  if (weather) return sure(`wetter ${/(?<!\p{L})morgen(?!\p{L})/iu.test(text) ? 'morgen ' : ''}${weather[1] ?? ''}`.trim());

  const conversion = text.match(CONVERSION_QUESTION);
  if (conversion) return sure(conversion[1]);
  const math = text.match(WORD_MATH);
  if (math && MATH_WORDS.test(math[1]) && /\d/.test(math[1])) return sure(`rechne ${math[1]}`);
  if (BARE_MATH.test(text)) return sure(`rechne ${text}`);

  const spentQuestion = text.match(SPENT_QUESTION);
  if (spentQuestion) return sure(`ausgaben ${spentQuestion[1].replace(/^(?:für|fuer) /i, '')}`.trim());
  const spent = text.match(SPENT);
  // In the self-chat "20 € für Pizza ausgegeben" may be a diary, so only in chats with the bot.
  if (spent && !/^ausgabe/i.test(text)) return { ...plain(`ausgabe ${spent[1].replace(SPENT_FILLER, '').trim()}`), chatOnly: true };

  const birthdayQuestion = text.match(BIRTHDAY_QUESTION);
  if (birthdayQuestion) return sure(`geburtstag ${birthdayQuestion[1] ?? birthdayQuestion[2]}`);
  const birthday = text.match(BIRTHDAY_IS) ?? text.match(BIRTHDAY_ON);
  if (birthday) return plain(`geburtstag ${birthday[1]} ${birthday[2]}`);

  const clause = text.match(REMIND_CLAUSE);
  if (clause) return plain(`erinnere mich ${clause[1] ? `${clause[1]} ` : ''}daran, ${clause[2]}`);
  const remind = text.match(REMIND_AT_END) ?? text.match(REMIND_POLITE);
  if (remind) return plain(`erinnere mich ${remind[1]}`);
  // "weck mich morgen um 7" is a reminder without a text of its own.
  const wake = text.match(WAKE);
  if (wake) return plain(`erinnere mich ${wake[1]}${/\san\s/i.test(wake[1]) ? '' : ' an Aufstehen ⏰'}`);
  if (SAVED.test(text)) return sure('ersparnis');
  const clearList = text.match(CLEAR_LIST);
  if (clearList) return plain(`${listCommand(clearList[1])} leeren`);

  // "ich brauche noch Milch und Brot", "die Milch ist alle", "ich muss noch Steuer machen"
  const need = text.match(NEED);
  if (need && !/\b(?:hilfe|zeit|ruhe|urlaub|pause|schlaf|termine?|dich|nichts|nicht|mehr|jemanden|einen rat)\b/i.test(need[1])) {
    return { ...plain(`einkauf ${need[1].replace(/\s+und\s+/gi, ', ')}`), chatOnly: true };
  }
  const runOut = text.match(RUN_OUT);
  if (runOut && (runOut[1] ?? runOut[2]).split(' ').length <= 3) return { ...plain(`einkauf ${runOut[1] ?? runOut[2]}`), chatOnly: true };
  const must = text.match(MUST);
  if (must && must[1].includes(' ')) return { ...plain(`todo ${must[1]}`), chatOnly: true };

  const add = text.match(ADD_TO_LIST);
  if (add) {
    const command = listCommand(add[2]);
    // "Milch und Eier auf die Einkaufsliste" is two things, a to-do with "und" is one task.
    return plain(`${command} ${command === 'einkauf' ? add[1].replace(/\s+und\s+/gi, ', ') : add[1]}`);
  }
  const done = text.match(DONE_AT_END);
  if (done && !/^erledigt\b/i.test(text)) {
    // "das ist erledigt", "alles gemacht": a reply to someone, nothing to tick off.
    if (/^(?:das|es|alles|ich|wir|schon|ok|gut)$/i.test(done[1])) return { silent: true };
    return plain(`erledigt ${done[1]}`);
  }
  const bought = text.match(BOUGHT);
  if (bought) {
    const what = bought[1] ?? bought[2];
    // "hab 3 gekauft" is product 3 from the price tracker.
    return plain(/^#?\d+$/.test(what) ? `gekauft ${what}` : `erledigt ${what}`);
  }

  return view(text);
}

/** "zeig mir meine Erinnerungen", "welche Termine habe ich morgen", "meine Notizen" */
function view(text) {
  const lead = text.match(LEAD)?.[0] ?? '';
  let rest = text.slice(lead.length);
  const tail = rest.match(TAIL)?.[0] ?? '';
  rest = rest.slice(0, rest.length - tail.length);
  if (!lead && !tail) return null;
  // "welche Termine habe ich morgen"
  rest = rest.replace(/\s+(?:habe ich|hab ich|gibt es|gibts|stehen|sind)(?=\s|$)/gi, '');

  for (const [noun, command] of VIEWS) {
    const words = rest.split(' ');
    // The thing, maybe followed by a day or a month: "termine morgen", "ausgaben im oktober"
    for (let take = Math.min(3, words.length); take >= 1; take--) {
      if (!noun.test(words.slice(0, take).join(' '))) continue;
      const period = words.slice(take).join(' ');
      if (!period) return { text: command, sure: true };
      if (PERIOD.test(period) && ['termine', 'ausgaben'].includes(command)) return { text: `${command} ${period}`, sure: true };
    }
  }
  return null;
}
