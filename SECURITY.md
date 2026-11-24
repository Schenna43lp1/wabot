# Sicherheit

## Lücke melden

Bitte **kein öffentliches Issue** öffnen. Stattdessen im Repository unter **Security → Report a vulnerability** privat melden.

Hilfreich sind:

- was passiert und was man dafür tun muss
- welche Version oder welcher Commit betroffen ist
- wenn möglich ein kurzes Beispiel, ohne echte Telefonnummern oder Links

Du bekommst innerhalb einer Woche eine Antwort. Nach dem Fix wird die Lücke mit Dank an dich veröffentlicht, wenn du das möchtest.

## Unterstützte Versionen

Nur der aktuelle Stand von `main` bekommt Sicherheitsupdates.

## Was als Lücke zählt

- Jemand, der nicht in `ALLOWED_NUMBERS` steht, kann den Bot benutzen oder fremde Daten sehen.
- Ein Link in einer Nachricht erreicht Adressen im Heimnetz.
- Eingaben führen Code aus oder verändern die Datenbank außerhalb des eigenen Kontos.
- Geheimnisse (WhatsApp-Sitzung, Kalender-Links) landen im Log, in Nachrichten an andere oder im Docker-Image.

## Was keine Lücke ist

- WhatsApp sperrt die Nummer. Baileys ist eine inoffizielle Anbindung, das Risiko steht im README.
- Wer Zugriff auf den Ordner `data` oder die `.env` hat, kann alles. Diese Dateien müssen geschützt sein.
- Ein Shop oder Kalender, der langsam antwortet oder falsche Daten liefert.
