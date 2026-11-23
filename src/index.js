import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dailyBackup } from './backup.js';
import { queueBirthdays } from './birthdays.js';
import { queueBriefings } from './briefing.js';
import { createCommands } from './commands.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { EXIT } from './exit-codes.js';
import { getProduct } from './product.js';
import { queueReminders } from './reminders.js';
import { queueReports } from './report.js';
import { createTracker } from './tracker.js';
import { startWhatsApp } from './whatsapp.js';

const log = (text) => process.stdout.write(`[${new Date().toLocaleString('de-DE')}] ${text}\n`);

// libsignal prints whole sessions, private keys included, through these methods.
console.info = () => {};
console.warn = () => {};

function fail(text, code = EXIT.fatal) {
  log(text);
  process.exit(code);
}

let config;
try {
  config = loadConfig();
} catch (error) {
  fail(`Fehler in .env: ${error.message}`);
}

mkdirSync(config.dataDir, { recursive: true });

// Two instances would fight over the WhatsApp session. The OS releases this lock on exit.
const lock = new DatabaseSync(join(config.dataDir, 'instance.lock'));
try {
  lock.exec('BEGIN EXCLUSIVE');
} catch {
  fail('Der Bot läuft bereits.');
}

const db = openDatabase(join(config.dataDir, 'tracker.db'));
let whatsapp;

function shutdown() {
  whatsapp?.stop();
  db.close();
  lock.close();
  process.exit(EXIT.stopped);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// In raw mode Ctrl+C is a normal key, so cmd does not ask "Batchvorgang abbrechen?".
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.on('data', (key) => {
    if (['q', 'Q', '\u0003'].includes(String(key))) shutdown();
  });
}

const tracker = createTracker({
  db,
  config,
  log,
  getProduct: (url, selector) => getProduct(url, { selector, currency: config.currency }),
  notify: () => void whatsapp?.flush(),
});
const handle = createCommands({ db, tracker, config });
whatsapp = await startWhatsApp({ db, config, handle, log, onFatal: fail });

let backupFailed = false;
function backup() {
  try {
    if (dailyBackup(db, config.dataDir)) log('Sicherung der Daten angelegt (Unterordner backup).');
    backupFailed = false;
  } catch (error) {
    // Retried every minute, but mentioned once.
    if (!backupFailed) log(`Sicherung fehlgeschlagen: ${error.message}`);
    backupFailed = true;
  }
}

// Calendars are downloaded at most every 15 minutes, a slow one must not pile up.
let alerting = false;

function tick() {
  backup();
  try {
    queueReminders(db);
  } catch (error) {
    log(`Erinnerungen fehlgeschlagen: ${error.stack}`);
  }
  try {
    queueReports(db);
  } catch (error) {
    log(`Übersicht fehlgeschlagen: ${error.stack}`);
  }
  try {
    queueBirthdays(db);
    handle.queueMonthlyExpenses();
    db.pruneOnce(Date.now() - 400 * 86_400_000);
  } catch (error) {
    log(`Geburtstage oder Monatsrückblick fehlgeschlagen: ${error.stack}`);
  }
  queueBriefings(db, handle.composeBriefing)
    .then(() => whatsapp.flush())
    .catch((error) => log(`Briefing fehlgeschlagen: ${error.stack}`));
  if (!alerting) {
    alerting = true;
    handle.queueCalendarAlerts()
      .then(() => whatsapp.flush())
      .catch((error) => log(`Kalender fehlgeschlagen: ${error.stack}`))
      .finally(() => { alerting = false; });
  }
  tracker.checkDue().catch((error) => log(`Preisprüfung fehlgeschlagen: ${error.stack}`));
  void whatsapp.flush();
  db.pruneMessages();
}
tick();
setInterval(tick, 60_000);

log(`Alltagshelfer gestartet, Preisprüfung alle ${config.intervalMs / 60_000} Minuten. Beenden mit Q.`);
