// WhatsApp formatting: *bold*, _italic_, `code`. Keep lines short, phones are narrow.
// test/help.test.js runs every `command` in this text, so it cannot promise what does not work.

function interval(ms) {
  const minutes = ms / 60_000;
  if (minutes === 60) return 'jede Stunde';
  return minutes % 60 === 0 ? `alle ${minutes / 60} Stunden` : `alle ${minutes} Minuten`;
}

export function helpText({ intervalMs, minDropPercent, notifyIncrease }) {
  const drop = minDropPercent
    ? `ab ${String(minDropPercent).replace('.', ',')} % Senkung`
    : 'bei jeder Senkung';

  return `*Preistracker – Hilfe*
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
\`name 3 Kopfhörer\` umbenennen
\`löschen 3\` nicht mehr beobachten
\`rückgängig\` Löschen zurücknehmen
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

\`hilfe\` zeigt diese Übersicht.`;
}
