# Mitmachen

Danke, dass du helfen willst. Diese Regeln halten den Bot sicher und den Code einfach.

Wie der Code aufgebaut ist und wie man einen neuen Befehl einbaut, steht in [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).

## Ablauf

1. Für größere Änderungen zuerst ein Issue öffnen, damit wir vorher über den Weg sprechen.
2. Einen Branch von `main` anlegen, z. B. `kalender-fix`. Direkt auf `main` geht nicht, das verhindert ein Regelsatz.
3. Änderung machen, Tests ergänzen, `npm test` ausführen.
4. Pull Request öffnen und die Vorlage ausfüllen. Gemergt wird, wenn die CI grün ist.

## Regeln für den Code

- **Node.js 24, ESM, keine Build-Schritte.** Der Code läuft so, wie er im Repository liegt.
- **Neue npm-Pakete nur mit gutem Grund.** Jedes Paket ist Angriffsfläche. Versionen werden exakt festgelegt (`.npmrc`: `save-exact`), Install-Skripte sind abgeschaltet.
- **Große, optionale Pakete** kommen nicht in die Haupt-`package.json`, sondern in einen eigenen Ordner mit eigener Lockfile, wie die Spracherkennung in `speech/`. Der Bot muss ohne sie laufen.
- **Neue Satzformen** gehören nach `src/phrases.js`, mit Beispiel in `test/phrases.test.js`. Jede Regel braucht auch einen Gegentest, dass eine ähnliche Notiz im Chat „Nachricht an dich selbst“ still bleibt.
- **Kein `eval`, kein `new Function`, keine Shell-Befehle mit Nutzereingaben.**
- **Links aus Nachrichten** nur über `fetchPage` oder `fetchCalendar` in `src/fetch-page.js` laden, damit Adressen im Heimnetz gesperrt bleiben.
- **Datenbank:** immer vorbereitete Anweisungen mit Platzhaltern (`?`), nie Eingaben in SQL einsetzen. Neue Spalten über `addMissingColumns`, damit alte Datenbanken weiter funktionieren.
- **Texte an Nutzer** auf Deutsch, kurz und freundlich. Jede Hilfeseite passt in eine Nachricht, jedes Beispiel in Backticks wird in `test/help.test.js` ausgeführt.
- **Kommentare** erklären das Warum, nicht das Was.

## Datenschutz

Der Bot läuft lokal und das soll so bleiben.

- Erinnerungen, Listen, Notizen, Geburtstage, Ausgaben und Telefonnummern verlassen den Rechner nie.
- Neue externe Dienste nur, wenn sie ohne persönliche Daten auskommen, und mit Eintrag im README unter „Sicherheit und Risiken“.
- Keine Telemetrie, keine Analyse-Dienste.
- Geheimnisse (Kalender-Links, Sitzungsdaten) nie ins Log schreiben.

## Was nie ins Repository gehört

- `.env`, der Ordner `data` (WhatsApp-Sitzung, Datenbank, Backups)
- echte Telefonnummern, Kalender-Links oder Chatverläufe, auch nicht in Tests oder Issues
- Logdateien

## Tests

```powershell
npm test
```

- Jede neue Funktion und jeder behobene Fehler bekommt einen Test unter `test/`.
- Tests brauchen kein Internet: Wetter, Kalender, Kurse und Shops werden in `test/helpers.js` ersetzt.
- Die CI prüft Windows und Linux mit Node 24 und 26 sowie die Abhängigkeiten auf bekannte Lücken.

## Commits

- Kurze Betreffzeile auf Englisch im Imperativ, z. B. `Add birthday reminders`.
- Im Text darunter das Warum.
- Ein Commit pro zusammengehöriger Änderung.

## Sicherheitslücken

Bitte **nicht** als Issue melden, sondern wie in [SECURITY.md](SECURITY.md) beschrieben.
