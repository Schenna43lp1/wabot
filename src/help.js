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
  kalender: 'daily', geburtstage: 'daily',
  geld: 'money', finanzen: 'money', ausgaben: 'money', haushaltsbuch: 'money', rechner: 'money', währung: 'money', waehrung: 'money',
};

/** topic: undefined (overview), 'prices' or 'daily' */
export function helpText(config, topic) {
  if (topic === 'prices') return pricesHelp(config);
  if (topic === 'daily') return DAILY_HELP;
  if (topic === 'money') return MONEY_HELP;
  // Speech recognition is on unless switched off. Without the packages the bot explains how to install them.
  return config?.speech === false ? OVERVIEW : OVERVIEW.replace(SAY_IT, `${SAY_IT}\n🎤 Oder sag es einfach per Sprachnachricht.`);
}

const SAY_IT = '`was steht morgen an?`';

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

📅 *Kalender und Geburtstage*
\`kalender\` Google oder Outlook verbinden
\`termine\` die nächsten 7 Tage
\`geburtstag Anna 12.3.1990\`

💸 *Geld*
\`ausgabe 12,50 essen\` ins Haushaltsbuch
\`ausgaben\` diesen Monat
\`rechne 250 + 19%\` · \`100 usd in eur\`

☀️ *Briefing*
\`ort Wien\` für das Wetter
\`briefing 7\` jeden Morgen Wetter und Tagesplan

💶 *Preise beobachten*
Schick mir einen Produktlink. Ich melde mich, wenn der Preis fällt.
\`liste\` zeigt deine Produkte

💬 Du kannst auch ganz normal schreiben: \`was muss ich einkaufen?\` · \`Milch auf die Einkaufsliste\` · \`was steht morgen an?\`

*Alle Befehle:* \`hilfe alltag\` · \`hilfe geld\` · \`hilfe preise\``;

const DAILY_HELP = `*Alltag – alle Befehle*

⏰ *Erinnerungen*
\`erinnere mich morgen 9 an Arzt\`
\`erinnere mich in 2 stunden an Ofen\`
\`erinnere mich am 24.12. an Geschenke\`
\`erinnere mich heute halb 8 an Kino\`
\`erinnere mich nächsten Freitag an Reifen\`
\`erinnere mich werktags 7 an Tabletten\`
\`erinnere mich jeden Montag 7 an Müll\`
\`erinnere mich alle 2 Wochen am Donnerstag 6:30 an Papier\`
\`erinnere mich monatlich am 1. an Miete\`
_Ohne Zeit frage ich nach._
\`erinnerungen\` alle mit Nummer
\`erinnerung 2 morgen 10\` verschieben
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
\`erledigt Milch, Brot\` mit Namen abhaken
\`einkauf leeren\` alles löschen

📝 *Notizen*
\`notiz WLAN Gäste: sonne123\` speichern
\`notizen\` alle zeigen
\`notiz 1\` ganz lesen
\`suche wlan\` in Notizen, Listen und Erinnerungen
\`notiz weg 1\` löschen

📅 *Kalender (Google, Outlook)*
\`kalender\` zeigt, wie du ihn verbindest (nur lesend)
\`termine\` die nächsten 7 Tage mit Erinnerungen
\`kalender erinnern 15\` 15 Min. vor jedem Termin Bescheid
\`kalender erinnern aus\` nicht mehr
\`kalender weg 1\` trennen

🎂 *Geburtstage*
\`geburtstag Anna 12.3.1990\` (Jahr freiwillig)
\`geburtstage\` die nächsten
\`geburtstag weg 1\` löschen
_Ich sage 3 Tage vorher und am Tag um 9 Uhr Bescheid._

☀️ *Wetter und Briefing*
\`ort Wien\` Ort für das Wetter speichern
\`wetter\` heute und morgen
\`wetter Graz\` anderswo
\`briefing\` jetzt: Wetter, Termine, To-dos, Preise
\`briefing 7\` jeden Tag um 7
\`briefing werktags 6:30\` nur Montag bis Freitag
\`briefing aus\` nicht mehr schicken

↩️ \`rückgängig\` holt das zuletzt Gelöschte oder Abgehakte zurück.
_Ort und Koordinaten gehen für das Wetter an Open-Meteo, der Kalender wird nur bei Google oder Outlook abgerufen. Sonst bleibt alles auf dem PC._`;

const MONEY_HELP = `*Geld – alle Befehle*

💸 *Haushaltsbuch*
\`ausgabe 12,50 essen\` eintragen
\`ausgabe 12,50 essen Pizza mit Tom\` mit Notiz
\`ausgabe 20 chf bahn\` andere Währung
\`ausgaben\` diesen Monat nach Kategorien
\`ausgaben oktober\` · \`ausgaben letzter monat\` · \`ausgaben 2026\`
\`ausgaben essen\` nur eine Kategorie
\`ausgabe weg 3\` löschen
\`ausgaben export\` als Tabelle
_Am 1. kommt der Rückblick auf den Vormonat._

💰 *Budget*
\`budget 800\` für den ganzen Monat
\`budget essen 200\` für eine Kategorie
\`budget\` Stand ansehen
\`budget aus\` · \`budget essen aus\`
_Ich warne bei 80 % und beim Überschreiten._

🧮 *Rechner*
\`rechne 12,5*3+7\`
\`rechne 250 + 19%\` · \`rechne 19% von 250\`
\`= 2^10\` geht auch
\`trinkgeld 47,80\` · \`trinkgeld 47,80 10%\`

💱 *Währungen*
\`100 usd in eur\`
\`umrechnen 50 chf\`
\`kurs usd\`
_Tageskurse der Europäischen Zentralbank._`;

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
