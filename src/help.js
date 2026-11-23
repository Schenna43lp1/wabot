// WhatsApp formatting: *bold*, _italic_, `code`. Keep lines short, phones are narrow.
// test/help.test.js runs every `command` in this text, so it cannot promise what does not work.

function interval(ms) {
  const minutes = ms / 60_000;
  if (minutes === 60) return 'jede Stunde';
  return minutes % 60 === 0 ? `alle ${minutes / 60} Stunden` : `alle ${minutes} Minuten`;
}

export const HELP_TOPICS = {
  preise: 'prices', preis: 'prices', preistracker: 'prices', produkte: 'prices', tracker: 'prices',
  alltag: 'daily', erinnerungen: 'daily', erinnerung: 'daily', listen: 'daily', notizen: 'daily', briefing: 'daily', wetter: 'daily',
};

/** topic: undefined (overview), 'prices' or 'daily' */
export function helpText(config, topic) {
  if (topic === 'prices') return pricesHelp(config);
  if (topic === 'daily') return DAILY_HELP;
  return OVERVIEW;
}

const OVERVIEW = `*Alltagshelfer – Hilfe*

⏰ *Erinnerungen*
\`erinnere mich morgen 9 an Arzt\`
\`erinnere mich in 30 min an Wäsche\`
\`erinnere mich jeden Montag 7 an Müll\`
\`erinnerungen\` alle ansehen

🛒 *Einkauf und To-dos*
\`einkauf Milch, Brot\` auf die Einkaufsliste
\`todo Steuer machen\` auf die To-do-Liste
\`erledigt 2\` abhaken

📝 *Notizen*
\`notiz WLAN Gäste: sonne123\` merken
\`suche wlan\` wiederfinden

☀️ *Briefing*
\`ort Wien\` für das Wetter
\`briefing 7\` jeden Morgen Wetter und Tagesplan

💶 *Preise beobachten*
Schick mir einen Produktlink. Ich melde mich, wenn der Preis fällt.
\`liste\` zeigt deine Produkte

*Alle Befehle:* \`hilfe alltag\` · \`hilfe preise\``;

const DAILY_HELP = `*Alltag – alle Befehle*

⏰ *Erinnerungen*
\`erinnere mich morgen 9 an Arzt\`
\`erinnere mich in 2 stunden an Ofen\`
\`erinnere mich am 24.12. an Geschenke\`
\`erinnere mich heute abend an Wäsche\`
\`erinnere mich werktags 7 an Tabletten\`
\`erinnere mich jeden Montag 7 an Müll\`
\`erinnere mich monatlich am 1. an Miete\`
\`erinnerungen\` alle mit Nummer
\`erinnerung weg 2\` löschen
\`später\` die letzte Erinnerung in 10 Min. noch mal
\`später 1h\` oder \`später morgen 9\`
_Erinnerungen kommen auch in der Ruhezeit._

🛒 *Einkauf und To-dos*
\`einkauf Milch, Brot, Eier\` hinzufügen
\`einkauf\` Liste zeigen
\`todo Steuer machen\` hinzufügen
\`todo\` Liste zeigen
\`erledigt 2\` oder \`erledigt 2 3\` abhaken
\`erledigt Milch\` mit Namen abhaken
\`einkauf leeren\` alles löschen

📝 *Notizen*
\`notiz WLAN Gäste: sonne123\` speichern
\`notizen\` alle zeigen
\`notiz 1\` ganz lesen
\`suche wlan\` in Notizen, Listen und Erinnerungen
\`notiz weg 1\` löschen

☀️ *Wetter und Briefing*
\`ort Wien\` Ort für das Wetter speichern
\`wetter\` heute und morgen
\`wetter Graz\` anderswo
\`briefing\` jetzt: Wetter, Termine, To-dos, Preise
\`briefing 7\` jeden Tag um 7
\`briefing werktags 6:30\` nur Montag bis Freitag
\`briefing aus\` nicht mehr schicken

↩️ \`rückgängig\` holt das zuletzt Gelöschte oder Abgehakte zurück.
_Ort und Koordinaten gehen für das Wetter an Open-Meteo, sonst bleibt alles auf dem PC._`;

function pricesHelp({ intervalMs, minDropPercent, notifyIncrease }) {
  const drop = minDropPercent
    ? `ab ${String(minDropPercent).replace('.', ',')} % Senkung`
    : 'bei jeder Senkung';

  return `*Preise beobachten – alle Befehle*
Schick mir einen Produktlink. Ich prüfe den Preis ${interval(intervalMs)} und melde mich, wenn es sich lohnt.

➕ *Produkt beobachten*
\`Link\` (auch mehrere auf einmal)
\`Link 99,90\` mit Zielpreis
\`Link -10%\` Ziel 10 % unter jetzt

📋 *Deine Produkte*
\`liste\` alle mit Nummer und Preis
\`zeige 3\` Details und Link
\`prüfen 3\` Preis jetzt abrufen
\`verlauf 3\` Preise, Trend und Tief
\`diagramm 3\` Preisverlauf als Bild
\`name 3 Kopfhörer\` umbenennen
\`löschen 3\` nicht mehr beobachten
\`rückgängig\` Löschen zurücknehmen
\`gekauft 3\` gekauft, Beobachtung beenden
\`gekauft 3 79,90\` mit bezahltem Preis
\`ersparnis\` was du bisher gespart hast
_3 ist die Nummer aus der Liste._

🎯 *Zielpreis*
\`ziel 3 89,90\` setzen oder ändern
\`ziel 3 -10%\` relativ zum jetzigen Preis
\`ziel 3 aus\` entfernen

⏸️ *Pausieren*
\`pause 3\` nicht mehr prüfen
\`weiter 3\` fortsetzen
\`pause alle\` / \`weiter alle\` z. B. für den Urlaub

🔔 *Wann melde ich mich?*
• Ohne Ziel: ${drop}
• Mit Ziel: wenn es erreicht ist und wenn der Preis danach weiter fällt
• Wenn etwas wieder lieferbar ist
${notifyIncrease ? '• Wenn ein Preis steigt\n' : ''}• Wenn ein Shop 5-mal in Folge nicht klappt
_Extreme Preissprünge prüfe ich erst ein zweites Mal._
\`schwelle 3 5%\` erst ab 5 % melden
\`schwelle 3 immer\` jede Senkung melden
\`schwelle 3 auto\` wieder Standard
\`ruhe 22-7\` nachts keine Meldungen
\`ruhe aus\` Ruhezeit beenden

📊 *Übersicht und Export*
\`übersicht\` was sich geändert hat
\`übersicht täglich 8\` jeden Tag um 8
\`übersicht sonntag 18\` jede Woche
\`übersicht aus\` nicht mehr schicken
\`export\` alle Preise als Tabelle

🔧 *Preis fehlt oder ist falsch?*
\`selektor 3 .price\` Preisfeld selbst angeben (CSS)
\`selektor 3 auto\` wieder automatisch
_Manche Shops sperren Bots. Dann hilft oft der Geizhals-Link des Produkts._

\`hilfe\` zeigt die Übersicht, \`hilfe alltag\` Erinnerungen, Listen und Notizen.`;
}
