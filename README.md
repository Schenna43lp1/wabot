# WhatsApp-Preistracker

Schick dem Bot einen Produktlink per WhatsApp. Er prüft den Preis regelmäßig und schreibt dir, wenn er fällt, dein Zielpreis erreicht ist oder das Produkt wieder verfügbar ist.

## Start

Voraussetzung: [Node.js](https://nodejs.org) 24 oder neuer.

1. `start.cmd` doppelklicken. Fehlende Pakete installiert es selbst, beim ersten Mal fragt es nach der Nummer.
2. Am Handy **WhatsApp → Verknüpfte Geräte → Gerät hinzufügen** öffnen und den QR-Code am PC scannen.
3. `hilfe` an den Bot schreiben.

Danach zeigt `start.cmd` dieses Menü. Ist WhatsApp verknüpft, startet der Bot nach 10 Sekunden von selbst.

| Taste | Wirkung |
|---|---|
| Enter oder `1` | Bot starten |
| `2` | Nummern einstellen |
| `3` | Link testen |
| `4` | WhatsApp neu verbinden, Produkte bleiben erhalten |
| `0` | Beenden |

Im laufenden Bot führt `Q` oder `Strg+C` zurück ins Menü. Nach einem Absturz startet er nach 10 Sekunden neu, höchstens viermal hintereinander.

Der Bot läuft, solange das Fenster offen und der PC wach ist. Verpasste Prüfungen holt er beim nächsten Start nach.

## Welche Nummer?

**Zweite Nummer (empfohlen):** Wähle in der Einrichtung `1`, gib deine normale Nummer ein und scanne den QR-Code mit der Zweitnummer.

So klingelt dein Handy bei jedem Alarm, und dein Hauptkonto ist keinem Sperrrisiko ausgesetzt.

**Eigene Nummer (zum Ausprobieren):** Wähle `2`, scanne mit deinem WhatsApp und schreib in den Chat „Nachricht an dich selbst“. Für eigene Nachrichten zeigt WhatsApp aber **keine Push-Benachrichtigung**, und jeder Link in diesem Chat wird als Produkt gespeichert.

Gruppen, fremde Nummern und deine Chats mit anderen beantwortet der Bot nie.

## Befehle

| Nachricht | Wirkung |
|---|---|
| `https://shop.de/produkt` | Produkt beobachten |
| `https://shop.de/produkt 99,90` | mit Zielpreis |
| `https://shop.de/produkt -10%` | Ziel 10 % unter dem jetzigen Preis |
| mehrere Links in einer Nachricht | bis zu 5 auf einmal |
| `liste` | alle Produkte mit Nummern |
| `zeige 3` (oder nur `3`) | Details und Link |
| `prüfen 3` | Produkt 3 sofort prüfen |
| `ziel 3 89,90` | Zielpreis setzen |
| `ziel 3 -10%` | Zielpreis relativ zum jetzigen Preis |
| `ziel 3 aus` | Zielpreis entfernen |
| `verlauf 3` | letzte Änderungen, Tief und Hoch |
| `löschen 3` | nicht mehr beobachten |
| `rückgängig` | letztes Löschen zurücknehmen, samt Verlauf |
| `selektor 3 .price` | Preis per CSS-Selektor lesen |
| `selektor 3 auto` | wieder automatisch erkennen |
| `hilfe` | Übersicht |

Der Bot versteht auch `Lösche 3.`, `3 löschen`, `löschen nr. 3`, `liste bitte` oder einen Link statt der Nummer (`löschen https://…`). Bei Tippfehlern und Produktnamen schlägt er den passenden Befehl vor, führt ihn aber nicht von selbst aus.

Im Chat „Nachricht an dich selbst“ ist er zurückhaltender, damit er deine Notizen nicht kommentiert: keine Tippfehler-Vorschläge, keine Begrüßung, eine Zahl allein zählt nicht.

## Wann kommt eine Nachricht?

- **Ohne Zielpreis:** bei einer Senkung ab 1 %. Mehrere kleine Senkungen zählen zusammen.
- **Mit Zielpreis:** erst beim Erreichen, danach bei weiteren Senkungen.
- **Wieder verfügbar:** immer.
- **Preissprünge** auf unter die Hälfte oder über das Doppelte werden nach 10 Minuten noch einmal geprüft, bevor sie zählen.
- **Dauerhafte Fehler:** einmal nach fünf Fehlversuchen in Folge.

## Einstellungen (`.env`)

Nach Änderungen den Bot neu starten.

| Name | Standard | Bedeutung |
|---|---|---|
| `ALLOWED_NUMBERS` | leer | erlaubte Nummern mit Ländervorwahl, durch Komma getrennt |
| `CHECK_INTERVAL_MINUTES` | 180 | Prüfabstand, mindestens 15 |
| `MIN_DROP_PERCENT` | 1 | kleinste gemeldete Senkung |
| `NOTIFY_INCREASE` | false | auch Erhöhungen melden |
| `DEFAULT_CURRENCY` | EUR | falls der Shop keine Währung angibt |
| `MAX_PRODUCTS_PER_USER` | 50 | Limit pro Person |
| `DATA_DIR` | data | Speicherort |

## Shops

Stand der Tests mit echten Seiten am 22.11.2026:

| Ergebnis | Shops |
|---|---|
| Preis erkannt | Amazon.de, IKEA, Alternate, Reichelt, Geizhals, Allbirds (Shopify) |
| Erkannt, sperrt aber bei vielen Abrufen kurz hintereinander | Thomann |
| Blockiert den Bot | MediaMarkt, Decathlon, Galaxus, Bike24 |

Andere Shops sind nicht getestet. Gute Chancen haben Seiten mit maschinenlesbaren Produktdaten (JSON-LD, Meta-Tags, Microdata). Einen Link ohne WhatsApp testen:

```powershell
npm run check -- "https://shop.de/produkt"
```

Wird kein Preis gefunden: im Browser Rechtsklick auf den Preis → *Untersuchen*, die Klasse ablesen (`class="price"` wird zu `.price`) und mit `selektor` setzen. Gegen Bot-Sperren und Preise, die erst per JavaScript laden, hilft das nicht. Für blockierte Shops kannst du oft die Geizhals-Seite des Produkts beobachten.

Grenzen:

- Versandkosten, Gutscheine und Mitgliederpreise werden nicht berücksichtigt.
- Bei mehreren Varianten zählt die aus dem Link, sonst die günstigste („ab“).
- Manche Shops untersagen automatische Abfragen in ihren Bedingungen. Halte das Intervall großzügig.

## Sicherheit und Risiken

- Der Bot nutzt [Baileys](https://github.com/WhiskeySockets/Baileys), eine **inoffizielle** WhatsApp-Anbindung (Version 7.0.0-rc14, ein Release Candidate). **WhatsApp kann die Nummer sperren.** Nur privat und in kleinem Umfang verwenden.
- `data/auth` (auch `data/auth-alt-…`) gewährt Zugriff auf das WhatsApp-Konto. **Niemals weitergeben oder hochladen.** Der Ordner `data` und `.env` stehen in `.gitignore`.
- Links auf Adressen im Heimnetz werden abgelehnt.
- Alle Daten liegen lokal in `data/tracker.db`. Für ein Backup den Bot beenden und `data` kopieren.

## Probleme

| Problem | Lösung |
|---|---|
| Abgemeldet | die Rückfrage mit Enter bestätigen oder im Menü `4` wählen |
| „läuft bereits“ | das andere Bot-Fenster schließen |
| Bot antwortet nicht | im Menü `2` die Nummer prüfen und neu starten |
| QR-Code abgeschnitten oder verzerrt | Fenster maximieren oder mit Strg+Mausrad verkleinern |
| Verbindung bricht dauernd mit Code 405 ab | Baileys ist veraltet: `npm install baileys@latest` |

## Entwicklung

```powershell
npm test
```

| Datei in `src` | Aufgabe |
|---|---|
| `cli.js`, `setup.js` | Startmenü und Einrichtung |
| `index.js` | Start und Zeitplan |
| `whatsapp.js` | Verbindung, Empfang und Versand |
| `access.js` | wer den Bot benutzen darf |
| `commands.js` | Chat-Befehle |
| `help.js` | Hilfetext des Bots |
| `input.js` | versteht die Eingaben |
| `messages.js` | Antworttexte zu Produkten |
| `tracker.js` | Prüfungen und Alarmregeln |
| `extract.js` | Preiserkennung |
| `money.js` | Preisformate |
| `fetch-page.js` | sicherer Seitenabruf |
| `db.js` | SQLite |
