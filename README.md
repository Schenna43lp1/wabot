# WhatsApp-Alltagshelfer

Ein Bot für den Alltag, der per WhatsApp antwortet und lokal auf deinem PC läuft. Du schreibst ihm wie einem Menschen, auch per Sprachnachricht:

```
Du:   Kannst du mich morgen früh an den Müll erinnern?
Bot:  ⏰ Ich erinnere dich morgen um 08:00 Uhr: den Müll

Du:   Milch, Eier und Butter auf die Einkaufsliste
Bot:  ➕ Milch, Eier, Butter
      🛒 Einkaufsliste (3)  1. Milch  2. Eier  3. Butter

Du:   was steht morgen an?
Bot:  📅 Morgen, Mi 25.11.
      10:00 Standup (Büro)
      ⏰ 08:00 den Müll

Du:   🎤 „Was sind 50 Euro in Franken?“
Bot:  💱 50,00 € = 47,50 CHF
```

Was er kann:

- **Erinnerungen:** `erinnere mich morgen 9 an Arzt`, auch wiederkehrend und mit `später` zum Verschieben.
- **Einkaufsliste und To-dos:** `einkauf Milch, Brot`, `todo Steuer`, `erledigt 2`.
- **Notizen:** `notiz WLAN Gäste: sonne123`, wiederfinden mit `suche wlan`.
- **Kalender:** Termine aus Google Kalender oder Outlook in `termine` und im Briefing, auf Wunsch mit Bescheid kurz vorher.
- **Geburtstage:** `geburtstag Anna 12.3.1990`, mit Bescheid 3 Tage vorher und am Tag.
- **Haushaltsbuch:** `ausgabe 12,50 essen`, Monatsübersicht nach Kategorien, Budgets mit Warnung, Export für Excel.
- **Rechner und Währungen:** `rechne 250 + 19%`, `trinkgeld 47,80`, `100 usd in eur` mit den Tageskursen der EZB.
- **Briefing:** jeden Morgen eine Nachricht mit Wetter, Terminen, Erinnerungen, To-dos, Einkaufsliste und Preisänderungen.
- **Preistracker:** Schick einen Produktlink. Der Bot prüft den Preis regelmäßig und schreibt dir, wenn er fällt, dein Zielpreis erreicht ist oder das Produkt wieder verfügbar ist. Mit Preisdiagramm, Export und Ersparnis-Rechnung.
- **Sprachnachrichten** (optional): einfach reinsprechen statt tippen. Verstanden wird auf deinem PC, nicht in einer Cloud.

Alle Daten sichert er täglich.

**Alles bleibt auf deinem PC**, auch deine Sprachnachrichten. Ins Internet gehen nur Produktlinks, der Ortsname fürs Wetter, die Abfrage der Wechselkurse, dein Kalender-Link und einmalig der Download des Sprachmodells (Details unter [Sicherheit und Datenschutz](#sicherheit-und-datenschutz)).

**Inhalt**

- Einrichten: [Start](#start) · [Docker](#start-mit-docker) · [Welche Nummer?](#welche-nummer) · [Einstellungen](#einstellungen-env)
- Benutzen: [Einfach schreiben](#einfach-schreiben) · [Sprachnachrichten](#sprachnachrichten) · [Alltag](#befehle-für-den-alltag) · [Geld](#geld) · [Preistracker](#preistracker)
- Betrieb: [Sicherheit und Datenschutz](#sicherheit-und-datenschutz) · [Backup](#backup) · [Probleme](#probleme) · [Entwicklung](#entwicklung)

## Start

Voraussetzung: [Node.js](https://nodejs.org) 24 oder neuer.

1. `start.cmd` doppelklicken. Fehlende Pakete installiert es selbst, beim ersten Mal fragt es nach der Nummer.
2. Am Handy **WhatsApp → Verknüpfte Geräte → Gerät hinzufügen** öffnen und den QR-Code am PC scannen.
3. `hilfe` an den Bot schreiben.

Unter Linux oder macOS statt Schritt 1: `npm install` und dann `npm run menu`.

Danach zeigt das Startfenster dieses Menü. Ist WhatsApp verknüpft, startet der Bot nach 10 Sekunden von selbst.

| Taste | Wirkung |
|---|---|
| Enter oder `1` | Bot starten |
| `2` | Nummern einstellen |
| `3` | Link testen |
| `4` | WhatsApp neu verbinden, Produkte bleiben erhalten |
| `0` | Beenden |

Im laufenden Bot führt `Q` oder `Strg+C` zurück ins Menü. Nach einem Absturz startet er nach 10 Sekunden neu, höchstens viermal hintereinander.

Der Bot läuft, solange das Fenster offen und der PC wach ist. Verpasste Prüfungen holt er beim nächsten Start nach.

## Start mit Docker

Für einen Server, NAS oder Raspberry Pi, der ständig läuft. Node.js braucht es dann nicht, aber Docker Compose ab Version 2.24 (`docker compose version`).

1. `.env.example` nach `.env` kopieren und `ALLOWED_NUMBERS` eintragen (ohne Datei geht nur „Nachricht an dich selbst“).
2. `mkdir -p data` (sonst legt Docker den Ordner für root an und der Bot kann nicht schreiben)
3. `docker compose up -d --build`
4. `docker compose logs -f` zeigt den QR-Code. Scannen, dann mit Strg+C die Anzeige verlassen, der Bot läuft weiter.

| Befehl | Wirkung |
|---|---|
| `docker compose logs -f` | Log ansehen |
| `docker compose up -d` | nach einer Änderung an `.env` (`restart` liest sie nicht neu) |
| `docker compose restart` | neu starten, z. B. nachdem der Bot wartet |
| `docker compose down` | beenden |
| `git pull` und `docker compose up -d --build` | aktualisieren |

- Die Daten liegen wie ohne Docker im Ordner `data` neben der `docker-compose.yml`. Eine bestehende Verknüpfung und alle Produkte werden übernommen.
- Bot **nie gleichzeitig** mit `start.cmd` und in Docker auf denselben Ordner starten: WhatsApp würde die Sitzungen gegenseitig trennen.
- Die Uhrzeit für Erinnerungen und Briefing ist `Europe/Berlin`. Andere Zone: `TZ=Europe/Vienna` in `.env`.
- Nach einem Absturz startet Docker den Bot neu. Wird WhatsApp abgemeldet, erscheint im Log von selbst ein neuer QR-Code.
- Bei Fehlern, die ein Neustart nicht behebt (Tippfehler in `.env`, zweite Instanz, gesperrte Nummer, erneute Abmeldung), startet der Bot nicht endlos neu. Er schreibt die Ursache ins Log und wartet auf `docker compose up -d` oder `restart`.
- Unter Linux schreibt der Container als Benutzer 1000. Gehört `data` jemand anderem: `sudo chown -R 1000:1000 data`.
- Sprachnachrichten: `SPEECH=an` in `.env`, dann `docker compose up -d --build`. Das Image wird dadurch etwa 700 MB größer (siehe [Sprachnachrichten](#sprachnachrichten)).
- Ohne Menü stellst du die Nummern in `.env` ein (`ALLOWED_NUMBERS`), danach `docker compose up -d`.

## Welche Nummer?

**Zweite Nummer (empfohlen):** Wähle in der Einrichtung `1`, gib deine normale Nummer ein und scanne den QR-Code mit der Zweitnummer.

So klingelt dein Handy bei jedem Alarm, und dein Hauptkonto ist keinem Sperrrisiko ausgesetzt.

**Eigene Nummer (zum Ausprobieren):** Wähle `2`, scanne mit deinem WhatsApp und schreib in den Chat „Nachricht an dich selbst“. Für eigene Nachrichten zeigt WhatsApp aber **keine Push-Benachrichtigung**, und jeder Link in diesem Chat wird als Produkt gespeichert.

Gruppen, fremde Nummern und deine Chats mit anderen beantwortet der Bot nie.

## Einfach schreiben

Die Befehle in den Tabellen unten sind die kürzeste Form. Du musst sie aber nicht lernen: Der Bot versteht auch ganze Sätze, Groß- und Kleinschreibung, Satzzeichen, „bitte“, „Hallo, …“ am Anfang, Schreibweisen ohne Umlaute (`loeschen`, `rueckgaengig`) und kleine Tippfehler.

| Du schreibst | Der Bot macht daraus |
|---|---|
| `Kannst du mich morgen früh an den Müll erinnern?` | `erinnere mich morgen früh an den Müll` |
| `Hallo, erinnere mich bitte morgen daran, die Wäsche aufzuhängen` | Erinnerung „die Wäsche aufhängen“ |
| `weck mich morgen um 7` | Erinnerung „Aufstehen“ um 7 |
| `zeig mir meine Erinnerungen` · `welche Erinnerungen habe ich?` | `erinnerungen` |
| `was muss ich einkaufen?` · `was brauchen wir noch` | `einkauf` |
| `Milch und Eier auf die Einkaufsliste` · `füge Brot zur Liste hinzu` | `einkauf Milch, Eier` |
| `ich brauche noch Milch` · `die Milch ist alle` | `einkauf Milch` |
| `ich muss noch die Steuer machen` | `todo die Steuer machen` |
| `Milch erledigt` · `hab Milch gekauft` · `streiche Milch von der Liste` | `erledigt Milch` |
| `was muss ich heute noch erledigen?` | `todo` |
| `merk dir: Parkplatz Ebene 3` · `merk dir, dass der Schlüssel beim Nachbarn ist` | `notiz …` |
| `wo ist mein WLAN-Passwort?` | zeigt passende Notizen |
| `was steht heute an?` · `wie sieht mein Tag aus` | `briefing` |
| `was steht morgen an?` · `was habe ich morgen für Termine?` · `was hab ich nächste Woche` | `termine morgen` · `termine nächste woche` |
| `wie wird das Wetter morgen in Graz?` · `brauche ich einen Schirm` | `wetter morgen Graz` · `wetter` |
| `wann hat Anna Geburtstag?` | `geburtstag Anna` |
| `Anna hat am 12.3. Geburtstag` | `geburtstag Anna 12.3.` |
| `ich habe heute 20 Euro für Tanken ausgegeben` | `ausgabe 20 Euro Tanken` |
| `wie viel habe ich diesen Monat ausgegeben?` | `ausgaben diesen Monat` |
| `was ist 12 mal 3` · `12*3` · `wie viel sind 100 Dollar in Euro?` | rechnet oder rechnet um |
| `was beobachtest du` · `meine Produkte` | Produktliste |
| `Guten Morgen` · `Vielen Dank!` · `Tschüss` · `gute Nacht` | kurzer Gruß, `Gern! 👍`, `Bis bald! 👋`, `Gute Nacht! 🌙` |
| `wie spät ist es?` · `welcher Tag ist heute` | Uhrzeit und Datum |
| `ok` · `alles klar` · `👍` | keine Antwort, die braucht es nicht |

Welche Zeitangaben er kennt, steht bei den [Erinnerungen](#erinnerungen). Schlägt der Bot bei einem Tippfehler einen Befehl vor („Meintest du `notizen`?“), genügt `ja`.

Im Chat „Nachricht an dich selbst“ ist er zurückhaltender, weil du dort auch Notizen schreibst. Fragen wie „was muss ich einkaufen?“ und Rechnungen beantwortet er auch dort. „20 Euro für Pizza ausgegeben“ oder „ich brauche noch Milch“ könnten aber Tagebucheinträge sein. Solche Sätze trägt er dort nicht ein, `ausgabe 20 pizza` und `einkauf Milch` aber schon.

## Sprachnachrichten

Der Bot kann Sprachnachrichten verstehen, **ganz auf deinem PC**, mit dem Spracherkennungsmodell [Whisper](https://github.com/openai/whisper). Die Aufnahme geht an keinen fremden Dienst. Was er verstanden hat, schreibt er über seine Antwort:

```
Du:   🎤 (Sprachnachricht)
Bot:  🎤 „Erinnere mich morgen um 9 an den Zahnarzt“
      ⏰ Ich erinnere dich morgen um 09:00 Uhr: den Zahnarzt
```

### Einschalten

Die Spracherkennung ist ein Zusatz, weil sie groß ist (etwa 500 MB Pakete und 80 MB Modell).

1. Im Ordner des Bots `npm run sprache` ausführen, das dauert ein paar Minuten.
2. Bot neu starten. Beim ersten Start lädt er das Modell einmal von Hugging Face herunter, danach liegt es in `data/models`. Im Log steht dann „Sprachmodell bereit“.

In Docker: `SPEECH=an` in `.env` und `docker compose up -d --build`. Abschalten: `SPEECH=aus`. Ohne den Zusatz antwortet der Bot auf Sprachnachrichten mit einem Hinweis.

### So klappt es am besten

Ein Satz pro Nachricht, so wie du ihn schreiben würdest: „Erinnere mich morgen um halb acht an den Bus“, „Milch, Brot und Eier auf die Einkaufsliste“, „Was steht morgen an?“. „Ähm“, „Hallo, …“ und „bitte“ stören nicht. Namen und Orte versteht Whisper am ehesten falsch; die tippst du im Zweifel.

Was der Bot mit der Aufnahme macht:

- **Nur Sprache:** Stille, Rauschen, Musik oder ein Klingelton gehen gar nicht erst an Whisper, das dort sonst ganze Sätze erfindet. Die Stille vor und nach dem Sprechen schneidet er ab, leise Aufnahmen macht er lauter.
- **Wie getippt:** „um neun Uhr dreißig“ → `um 9 Uhr 30`, „am dritten Dezember“ → `am 3. Dezember`, „zwölf Euro fünfzig“ → `12,50 Euro`, „Milch Komma Brot“ → `Milch, Brot`. Wiederholungen und „äh“ fallen weg, typische Hörfehler wie „Weg mich“ statt „Weck mich“ korrigiert er.
- **Zum Nachprüfen:** Was er gehört hat, steht über der Antwort. `rückgängig` nimmt das zuletzt Gelöschte oder Abgehakte zurück, eine falsche Erinnerung löschst du mit `erinnerung weg` und der Nummer.

Grenzen:

- Höchstens 2 Minuten pro Nachricht. Eine Nachricht dauert auf einem normalen PC etwa 1 Sekunde. Kommt die erste kurz nach dem Start, schreibt der Bot „Einen Moment …“, bis das Modell geladen ist.
- Nur in WhatsApp aufgenommene Sprachnachrichten, keine weitergeleiteten Audiodateien (MP3, M4A).
- Nur Deutsch.
- Im Chat „Nachricht an dich selbst“ bleibt eine Sprachnachricht, die kein Befehl ist, eine Sprachnotiz. Der Bot antwortet dann nicht.

### Modell wählen

Mit `SPEECH_MODEL` in `.env`. Gemessen mit erzeugten Testaufnahmen (drei Stimmen, dazu mit Rauschen, leise, schnell, im Auto und im Café) auf einem normalen PC:

| `SPEECH_MODEL` | Download | Zeit pro Nachricht | Hinweis |
|---|---|---|---|
| `tiny` | 40 MB | unter 1 s | nur für sehr schwache PCs |
| `base` (Standard) | 80 MB | etwa 1 s | |
| `small` | 250 MB | etwa 2,5 s | kaum genauer als `base` |
| `turbo` | 1,1 GB | MESSUNG_TURBO | MESSUNG_TURBO_HINWEIS |

Arbeitsspeicher: Das Modell bleibt geladen, mit `base` braucht der Bot etwa 300 MB mehr.

## Befehle für den Alltag

`hilfe` zeigt im Chat eine Übersicht, `hilfe alltag`, `hilfe geld` und `hilfe preise` alle Befehle.

### Erinnerungen

| Nachricht | Wirkung |
|---|---|
| `erinnere mich morgen 9 an Arzt` | einmalig |
| `erinnere mich in 30 min an Wäsche` | auch `in 2 stunden`, `in einer halben stunde`, `in einer Viertelstunde`, `in anderthalb Stunden`, `in 3 tagen`, `in 1 monat` |
| `erinnere mich um 15 uhr an Anruf` | heute, oder morgen, falls schon vorbei; auch `9:30`, `9.30` und `9 Uhr 30` |
| `erinnere mich halb 8 an Kino` | auch `viertel nach 9`, `viertel vor 9`, `dreiviertel 9`, `9h` |
| `erinnere mich heute abend an …` | `früh` 8, `vormittags` 10, `mittags` 12, `nachmittags` 15, `abends` 19, `nachts` 22 Uhr |
| `erinnere mich heute abend um 8 an …` | 20 Uhr; genauso `um 8 Uhr abends`, `um 11 nachts`, `morgen früh um 7` |
| `erinnere mich am Freitag 14:30 an …` | auch `am fr`, `am 24.12.`, `am 1.1.2027`, `am 3. Dezember` oder `am 3 Dez 2027` |
| `erinnere mich morgen daran, Anna anzurufen` | der Text wird „Anna anrufen“; auch `…, dass ich Anna anrufen muss` |
| `erinnere mich nächsten Montag an …` | nie heute; auch `nächste Woche` (Montag) und `am Wochenende` (Samstag) |
| `Müll rausbringen morgen 7` | die Zeit darf auch am Ende stehen |
| `erinnere mich täglich 21 an Tabletten` | auch `jeden Tag` |
| `erinnere mich werktags 7 an Bus` | Montag bis Freitag |
| `erinnere mich jeden Montag 7 an Müll` | auch `montags` oder `jeden mo` |
| `erinnere mich alle 2 Wochen am Donnerstag 6:30 an Papier` | auch `alle 14 tage`, `alle 3 tage` |
| `erinnere mich monatlich am 1. an Miete` | auch `jeden 15.`; am 31. heißt in kürzeren Monaten am letzten Tag |
| `erinnere mich an Arzt` | ohne Zeit fragt der Bot nach, antworte dann z. B. mit `morgen 9` |
| `erinnerungen` | alle mit Nummer |
| `erinnerung 2 morgen 10` | verschieben; bei wiederkehrenden nur das nächste Mal, außer du gibst eine neue Regel an |
| `erinnerung weg 2` | löschen |
| `später` | die letzte Erinnerung in 10 Minuten noch einmal |
| `später 1h` / `später morgen 9` | zu einer anderen Zeit |

Ohne Uhrzeit gilt 9 Uhr. `um 3` oder `halb 8` ohne Tag heißt nachmittags bzw. abends, wenn die Zeit am Morgen schon vorbei ist; ab 8 Uhr gilt die Zeit am Vormittag, notfalls am nächsten Tag. Die Bestätigung nennt immer die erkannte Zeit.

Erinnerungen kommen auch in der Ruhezeit. War der PC zur fälligen Zeit aus, kommt die Erinnerung beim nächsten Start, mit einem Hinweis auf die verpasste Zeit.

### Einkaufsliste, To-dos und Notizen

| Nachricht | Wirkung |
|---|---|
| `einkauf Milch, Brot, Eier` | auf die Einkaufsliste, durch Komma getrennt |
| `einkauf` | Einkaufsliste zeigen |
| `todo Steuer machen` | auf die To-do-Liste, mehrere in eigenen Zeilen |
| `todo` | To-do-Liste zeigen |
| `erledigt 2` / `erledigt 2 3` | abhaken |
| `erledigt Milch, Brot` | mit Namen abhaken |
| `einkauf leeren` | ganze Liste löschen |
| `listen` | Einkaufsliste und To-dos zusammen |
| `notiz WLAN Gäste: sonne123` | Notiz speichern, auch mehrzeilig; die Antwort nennt ein Suchwort zum Wiederfinden |
| `notizen` | alle Notizen |
| `notiz 3` | Notiz 3 ganz lesen |
| `notiz weg 3` | löschen |
| `suche wlan` | in Notizen, Listen und Erinnerungen suchen |
| `rückgängig` | das zuletzt Gelöschte oder Abgehakte zurückholen |

Die Nummern auf den Listen bleiben gleich, bis die Listen leer sind. `erledigt 2` und gleich danach `erledigt 3` treffen also, was zuletzt angezeigt wurde.

### Kalender (Google, Outlook)

Der Bot liest deinen Kalender über dessen geheimen iCal-Link. Er kann Termine nur lesen, nicht ändern, und braucht kein Passwort.

1. Den Link kopieren:
   - **Google Kalender:** calendar.google.com → ⚙️ Einstellungen → links den Kalender wählen → „Geheime Adresse im iCal-Format“.
   - **Outlook / Microsoft 365:** outlook.com → ⚙️ Einstellungen → Kalender → Freigegebene Kalender → „Kalender veröffentlichen“ → Kalender und „Kann alle Details anzeigen“ wählen → Veröffentlichen → ICS-Link.
2. Dem Bot schicken: `kalender https://…` (optional mit Namen: `kalender https://… Arbeit`).
3. Wer den Link hat, sieht deine Termine. Im Chat „Nachricht an dich selbst“ löscht der Bot deine Nachricht mit dem Link danach selbst. Bei einer Zweitnummer lösch sie bitte selbst; der Bot darf fremde Nachrichten nicht löschen.

Nur `https://`-Links werden angenommen, auch Weiterleitungen müssen verschlüsselt sein, damit der Link nie im Klartext durchs Netz geht.

| Nachricht | Wirkung |
|---|---|
| `kalender` | Anleitung, oder die Termine, wenn einer verbunden ist |
| `termine` | die nächsten 7 Tage, zusammen mit deinen Erinnerungen |
| `termine morgen` | nur ein Tag, auch `heute`, `übermorgen`, `wochenende`, `nächste woche` |
| `kalender erinnern 15` | 15 Minuten vor jedem Termin Bescheid geben, auch in der Ruhezeit |
| `kalender erinnern aus` | nicht mehr |
| `kalender weg 1` | Kalender trennen |

Bis zu 5 Kalender pro Person. Der Bot lädt sie höchstens alle 15 Minuten, Änderungen erscheinen also mit etwas Verzögerung. Ist ein Kalender nicht erreichbar, nutzt er die letzte Kopie und sagt sonst Bescheid. Serientermine, verschobene und abgesagte Einzeltermine und Zeitzonen (auch die Windows-Namen von Outlook) werden berücksichtigt. Ein Link, den du in Google oder Outlook zurücksetzt, funktioniert nicht mehr; dann den neuen schicken.

### Geburtstage

| Nachricht | Wirkung |
|---|---|
| `geburtstag Anna 12.3.1990` | speichern; das Jahr ist freiwillig, auch `12. März` geht |
| `geburtstag Anna 13.3.1990` | denselben Namen noch einmal: Datum ändern |
| `geburtstage` | alle, nach dem nächsten Termin sortiert, mit Alter |
| `geburtstag Anna` | nachsehen, wann Anna Geburtstag hat |
| `geburtstag weg 2` | löschen |

Der Bot meldet sich 3 Tage vorher und am Tag selbst um 9 Uhr, in der Ruhezeit erst danach. Geburtstage stehen auch in `termine` und im Briefing. Wer am 29. Februar geboren ist, feiert in anderen Jahren am 28.

### Wetter und Briefing

| Nachricht | Wirkung |
|---|---|
| `ort Wien` | Ort für das Wetter speichern |
| `wetter` | heute und morgen am gespeicherten Ort |
| `wetter morgen` | dasselbe, aber morgen zuerst |
| `wetter Graz` | einmalig für einen anderen Ort, auch `wetter morgen Graz` |
| `briefing` | Briefing jetzt schicken |
| `briefing 7` | jeden Tag um 7 Uhr |
| `briefing werktags 6:30` | Montag bis Freitag |
| `briefing aus` | nicht mehr schicken |

Das Briefing enthält das Wetter, die restlichen Termine und Erinnerungen des Tages, offene To-dos, die Einkaufsliste und Produkte, die in den letzten 24 Stunden günstiger wurden oder den Zielpreis erreicht haben. Liegt es in der Ruhezeit, kommt es an deren Ende.

## Geld

`hilfe geld` zeigt alle Befehle.

### Haushaltsbuch

| Nachricht | Wirkung |
|---|---|
| `ausgabe 12,50 essen` | eintragen; das erste Wort ist die Kategorie |
| `ausgabe 12,50 essen Pizza mit Tom` | mit Notiz |
| `ausgabe 20 chf bahn` | in anderer Währung, wird getrennt summiert |
| `ausgaben` | dieser Monat nach Kategorien, mit den letzten Einträgen |
| `ausgaben oktober` / `ausgaben letzter monat` / `ausgaben 2026` | anderer Zeitraum |
| `ausgaben essen` | nur eine Kategorie |
| `ausgabe weg 3` | löschen, `rückgängig` holt sie zurück |
| `ausgaben export` | alle Ausgaben als CSV-Tabelle |
| `budget 800` | Monatsbudget |
| `budget essen 200` | Budget für eine Kategorie |
| `budget` | Stand aller Budgets |
| `budget aus` / `budget essen aus` | entfernen |

Beim Eintragen sagt der Bot, wie viel diesen Monat schon ausgegeben ist, und warnt bei 80 % eines Budgets und beim Überschreiten. Am 1. jedes Monats um 9 Uhr kommt der Rückblick auf den Vormonat. Kategorien sind frei wählbar; für gängige wie `essen`, `tanken`, `miete` oder `freizeit` gibt es ein passendes Symbol.

### Rechner und Währungen

| Nachricht | Wirkung |
|---|---|
| `rechne 12,5*3+7` | rechnen; auch `x`, `:`, `^`, Klammern, `wurzel` und Wörter wie `12 mal 3`, `2 hoch 10` |
| `12*3` | eine Rechnung allein geht auch ohne `rechne` |
| `rechne 250 + 19%` | plus 19 Prozent (auch `- 20%`) |
| `rechne 19% von 250` | Prozentwert |
| `= 2^10` | kurz für `rechne` |
| `trinkgeld 47,80` | 5, 10 und 15 % mit aufgerundeter Summe |
| `trinkgeld 47,80 10%` | ein bestimmter Satz |
| `100 usd in eur` | umrechnen, auch `$100 in €` oder `100 Dollar nach Euro` |
| `umrechnen 50 chf` | in deine Währung (`DEFAULT_CURRENCY`); Euro in USD, CHF und GBP |
| `kurs usd` | Kurs in beide Richtungen |

Zahlen schreibst du wie gewohnt: `12,5` oder `12.5`, `1.250` ist tausendzweihundertfünfzig. Die Kurse sind die Referenzkurse der Europäischen Zentralbank, werktags gegen 16 Uhr aktualisiert, für rund 30 Währungen.

## Preistracker

`hilfe preise` zeigt alle Befehle im Chat.

### Befehle

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
| `verlauf 3` | Änderungen, Tief und Hoch, Trend und 30-Tage-Schnitt |
| `diagramm 3` | Preisverlauf als Bild, mit Zielpreis und Tiefpunkt |
| `name 3 Kopfhörer` | eigener Name |
| `name 3 auto` | wieder der Name aus dem Shop |
| `pause 3` | nicht mehr automatisch prüfen |
| `weiter 3` | fortsetzen |
| `pause alle` | alles pausieren, z. B. für den Urlaub |
| `weiter alle` | alles fortsetzen, auch einzeln Pausiertes |
| `schwelle 3 5%` | erst ab 5 % Senkung melden |
| `schwelle 3 immer` | jede Senkung melden |
| `schwelle 3 auto` | wieder die Standardschwelle |
| `ruhe 22-7` | in dieser Zeit keine Meldungen |
| `ruhe aus` | Ruhezeit beenden |
| `übersicht` | Änderungen der letzten 7 Tage |
| `übersicht täglich 8` | jeden Tag die Änderungen der letzten 24 Stunden |
| `übersicht werktags 8` | Montag bis Freitag |
| `übersicht sonntag 18:30` | jede Woche die Änderungen der letzten 7 Tage |
| `übersicht aus` | nicht mehr schicken |
| `export` | Produkte und Preisverlauf als CSV-Datei für Excel |
| `löschen 3` | nicht mehr beobachten |
| `rückgängig` | letztes Löschen oder `gekauft` zurücknehmen, samt Verlauf |
| `gekauft 3` | gekauft zum jetzigen Preis, Beobachtung endet |
| `gekauft 3 79,90` | gekauft zu diesem Preis |
| `ersparnis` | Käufe und Ersparnis gegenüber dem Preis zu Beginn der Beobachtung |
| `selektor 3 .price` | Preis per CSS-Selektor lesen |
| `selektor 3 auto` | wieder automatisch erkennen |
| `hilfe` | Übersicht |

Der Bot versteht auch `Lösche 3.`, `3 löschen`, `löschen nr. 3`, `liste bitte` oder einen Link statt der Nummer (`löschen https://…`). Bei Tippfehlern und Produktnamen schlägt er den passenden Befehl vor, führt ihn aber nicht von selbst aus.

Im Chat „Nachricht an dich selbst“ ist er zurückhaltender, damit er deine Notizen nicht kommentiert: keine Tippfehler-Vorschläge, keine Begrüßung, eine Zahl allein zählt nicht, und Wörter wie `pause`, `name` oder `weiter` gelten nur mit gültiger Nummer oder `alle`. `suche`, `später`, `erledigt`, `wetter` und `ort` antworten dort nur, wenn sie etwas finden. `wetter` mit Ort fragt dort nur bei einer klaren Frage („wie wird das Wetter in Graz?“) beim Wetterdienst nach, `ort` nur bei höchstens drei Wörtern ohne Ziffern.

### Wann meldet er sich?

- **Ohne Zielpreis:** bei einer Senkung ab 1 % oder ab deiner `schwelle`. Mehrere kleine Senkungen zählen zusammen.
- **Mit Zielpreis:** erst beim Erreichen, danach bei weiteren Senkungen ab der Schwelle.
- **Wieder verfügbar:** immer.
- **Preissprünge** auf unter die Hälfte oder über das Doppelte werden nach 10 Minuten noch einmal geprüft, bevor sie zählen.
- **Dauerhafte Fehler:** einmal nach fünf Fehlversuchen in Folge.
- **Pausiert:** keine automatischen Prüfungen. Eine Senkung während der Pause wird beim Fortsetzen erkannt, wenn der Preis dann noch niedriger ist.
- **Ruhezeit:** Meldungen kommen gesammelt danach, mit dem Zeitpunkt der Prüfung. Antworten auf deine Nachrichten kommen sofort.
- **Übersicht:** War der PC zur geplanten Zeit aus, kommt sie einmal beim nächsten Start.

Alle Uhrzeiten richten sich nach der Uhr des PCs.

### Shops

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
| `TZ` | die des PCs, in Docker `Europe/Berlin` | Zeitzone für Erinnerungen und Briefing, z. B. `Europe/Vienna` |
| `SPEECH` | an, wenn installiert | `aus` schaltet die [Spracherkennung](#sprachnachrichten) ab; in Docker baut `an` sie ins Image |
| `SPEECH_MODEL` | `base` | `tiny`, `base`, `small`, `turbo` oder ein Whisper-Modell von Hugging Face, siehe [Modell wählen](#modell-wählen) |

## Sicherheit und Datenschutz

- Der Bot nutzt [Baileys](https://github.com/WhiskeySockets/Baileys), eine **inoffizielle** WhatsApp-Anbindung (Version 7.0.0-rc14, ein Release Candidate). **WhatsApp kann die Nummer sperren.** Nur privat und in kleinem Umfang verwenden.
- `data/auth` (auch `data/auth-alt-…`) gewährt Zugriff auf das WhatsApp-Konto. **Niemals weitergeben oder hochladen.** Der Ordner `data` und `.env` stehen in `.gitignore`.
- Links auf Adressen im Heimnetz werden abgelehnt.
- Für das Wetter gehen der Ortsname, den du bei `ort` oder `wetter` angibst, und dessen Koordinaten an [Open-Meteo](https://open-meteo.com). Kalender lädt der Bot nur von der Adresse im Link (Google oder Microsoft). Die Wechselkurse holt er bei der EZB, ohne etwas über dich mitzuschicken. Erinnerungen, Listen, Notizen, Geburtstage und Ausgaben verlassen den PC nie.
- Sprachnachrichten werden auf dem PC transkribiert und weder die Aufnahme noch der Text gespeichert. Das Log nennt nur Länge und Rechenzeit, nicht was gesagt wurde. Nur das Modell kommt einmal von [Hugging Face](https://huggingface.co); dabei geht nichts über dich mit.
- Kalender-Links sind geheim und liegen in `data/tracker.db`. Auch deshalb gehört der Ordner `data` nicht ins Netz.
- Alle Daten liegen lokal in `data/tracker.db`. Beim Export geht die Tabelle über WhatsApp an die Person, die sie angefordert hat.

## Backup

Der Bot legt einmal am Tag eine Kopie aller Daten (Preise, Erinnerungen, Listen, Notizen) in `data/backup` an und behält die letzten 7. Die WhatsApp-Verknüpfung ist nicht enthalten. Gegen einen Plattendefekt hilft nur eine Kopie auf einem anderen Laufwerk. `data/models` (das Sprachmodell) musst du nicht sichern, es wird bei Bedarf neu geladen.

Wiederherstellen:

1. Bot beenden.
2. In `data` die Dateien `tracker.db`, `tracker.db-wal` und `tracker.db-shm` umbenennen, soweit vorhanden.
3. Die gewünschte Datei aus `data/backup` nach `data` kopieren und `tracker.db` nennen.
4. Bot starten.

## Probleme

**Verbindung und Start**

| Problem | Lösung |
|---|---|
| Bot antwortet nicht | im Menü `2` die Nummer prüfen und neu starten; im Fenster steht, wenn eine fremde Nummer geschrieben hat |
| Abgemeldet | die Rückfrage mit Enter bestätigen oder im Menü `4` wählen |
| „läuft bereits“ | das andere Bot-Fenster schließen |
| QR-Code abgeschnitten oder verzerrt | Fenster maximieren oder mit Strg+Mausrad verkleinern |
| Verbindung bricht dauernd mit Code 405 ab | Baileys ist veraltet: `npm install baileys@latest` |
| Docker: Bot wartet und startet nicht neu | die Meldung darüber im Log beheben, dann `docker compose up -d` |

**Verstehen**

| Problem | Lösung |
|---|---|
| Bot versteht einen Satz nicht | die kurze Form aus `hilfe` nehmen, z. B. `einkauf Milch`. Über ein Issue mit dem Satz freuen wir uns |
| Erinnerung zur falschen Zeit | die Bestätigung nennt immer die erkannte Zeit; `erinnerung 2 morgen 10` verschiebt, `rückgängig` hilft nach dem Löschen |

**Sprachnachrichten**

| Problem | Lösung |
|---|---|
| „Sprachnachrichten verstehe ich noch nicht“ | `npm run sprache` und Bot neu starten, siehe [Sprachnachrichten](#sprachnachrichten) |
| Falsch verstanden | einen Satz pro Nachricht, nah am Handy, wenig Hintergrundlärm; Namen und Orte notfalls tippen; anderes [Modell](#modell-wählen) |
| „keine Worte verstanden“ | die Aufnahme war still oder nur Lärm; näher am Handy sprechen |
| „Diese Audiodatei kann ich nicht abspielen“ | eine weitergeleitete Datei statt einer Sprachnachricht; direkt in WhatsApp aufnehmen |
| „Sprachmodell lässt sich gerade nicht laden“ | keine Internetverbindung beim ersten Start oder ein falscher `SPEECH_MODEL`; der Bot versucht es bei der nächsten Sprachnachricht wieder, Details im Log |

## Entwicklung

```powershell
npm test                          # alle Tests, ohne Internet und ohne Sprachmodell
npm run check -- "<Produktlink>"  # einen Shop testen
$env:SPEECH_TEST=1; npm test      # zusätzlich echtes Whisper mit einer Testaufnahme (nach npm run sprache, lädt einmal 80 MB)
```

Wie die Teile zusammenspielen und wie man einen Befehl hinzufügt, steht in [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md). Regeln für Änderungen: [CONTRIBUTING.md](CONTRIBUTING.md), Sicherheitslücken: [SECURITY.md](SECURITY.md).

| Datei in `src` | Aufgabe |
|---|---|
| `cli.js`, `setup.js` | Startmenü und Einrichtung |
| `container.js`, `supervise.js` | Start in Docker statt des Menüs, ohne Neustart-Schleifen |
| `check.js` | Link ohne WhatsApp testen |
| `config.js` | liest die `.env` |
| `index.js` | Start und Zeitplan |
| `exit-codes.js` | warum der Bot endete, für Menü und Docker |
| `errors.js` | Fehler mit Text für den Nutzer |
| `whatsapp.js` | Verbindung, Empfang und Versand |
| `access.js` | wer den Bot benutzen darf |
| `commands.js` | Chat-Befehle |
| `help.js` | Hilfetext des Bots |
| `input.js` | versteht die Befehle, auch ohne Umlaute |
| `phrases.js` | macht aus ganzen Sätzen Befehle |
| `speech.js` | Sprachnachrichten mit Whisper, optional (`speech/`) |
| `when.js` | Zeitangaben wie „morgen halb 9“ und Wiederholungen |
| `reminders.js` | Erinnerungen |
| `lists.js` | Einkaufsliste, To-dos, Notizen |
| `calendar.js`, `ical.js` | Kalender-Anbindung und iCal-Leser |
| `birthdays.js` | Geburtstage |
| `briefing.js`, `weather.js` | Morgen-Briefing und Wetter |
| `expenses.js` | Haushaltsbuch |
| `calc.js`, `tools.js` | Rechner, Trinkgeld, Umrechnung |
| `rates.js` | Wechselkurse der EZB |
| `product.js` | Produktseite laden und auswerten |
| `messages.js` | Antworttexte zu Produkten |
| `tracker.js` | Prüfungen und Alarmregeln |
| `extract.js` | Preiserkennung |
| `money.js` | Preisformate |
| `fetch-page.js` | sicherer Seitenabruf |
| `db.js` | SQLite |
| `options.js` | Pause, Name, Schwelle, Ruhezeit |
| `schedule.js` | Uhrzeiten und Ruhezeit |
| `report.js` | Übersicht |
| `stats.js` | Auswertung des Verlaufs |
| `export.js` | CSV-Export |
| `backup.js` | tägliche Sicherung |
| `purchases.js` | Käufe und Ersparnis |
| `chart.js`, `png.js` | Preisdiagramm als PNG, ohne Bildbibliothek |
