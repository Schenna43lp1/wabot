// Start menu behind start.cmd
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { styleText } from 'node:util';
import { EXIT } from './exit-codes.js';
import { isLinked, isRunning, readSettings, resetLink, saveNumbers } from './setup.js';

const ROOT = resolve(import.meta.dirname, '..');
const AUTOSTART_SECONDS = 10;
const RESTART_SECONDS = 10;
const MAX_CRASHES = 5;

const bold = (text) => styleText('bold', text);
const green = (text) => styleText('green', text);
const yellow = (text) => styleText('yellow', text);
const red = (text) => styleText('red', text);

/** Asks a question. With a timeout it resolves to null unless the user starts typing. */
function ask(question, { seconds } = {}) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let timer;
    const stopTimer = () => clearTimeout(timer);
    const finish = (answer) => {
      stopTimer();
      process.stdin.off('keypress', stopTimer);
      rl.close();
      done(answer);
    };

    // Readline catches Ctrl+C, so cmd never asks "Batchvorgang abbrechen?".
    rl.on('SIGINT', () => {
      process.stdout.write('\n');
      process.exit(0);
    });
    rl.question(question, (answer) => finish(answer.trim()));

    if (seconds) {
      timer = setTimeout(() => {
        process.stdout.write('\n');
        finish(null);
      }, seconds * 1000);
      process.stdin.on('keypress', stopTimer);
    }
  });
}

const pause = () => ask('\n  Weiter mit Enter ');

function header(title) {
  console.clear();
  console.log(`\n  ${bold(green('WHATSAPP-PREISTRACKER'))}${title ? `  /  ${title}` : ''}`);
  console.log(`  ${'─'.repeat(46)}\n`);
}

/** Runs one of our scripts in this window and resolves to its exit code. */
function run(script, args = []) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, script), ...args], { cwd: ROOT, stdio: 'inherit' });
    const ignore = () => {}; // the child handles Ctrl+C
    process.on('SIGINT', ignore);
    const finish = (code) => {
      process.off('SIGINT', ignore);
      done(code);
    };
    child.on('error', () => finish(1));
    child.on('exit', finish);
  });
}

async function setup() {
  for (;;) {
    header('Einrichtung');
    console.log('  Mit welcher Nummer läuft der Bot?\n');
    console.log(`  ${bold('1')}  Zweitnummer (empfohlen)`);
    console.log('     Dein Handy klingelt bei jedem Preisalarm.\n');
    console.log(`  ${bold('2')}  Meine eigene Nummer`);
    console.log('     Über "Nachricht an dich selbst", ohne Push-Benachrichtigung.\n');
    console.log(`  ${bold('0')}  Zurück\n`);

    const choice = await ask('  Auswahl: ');
    if (choice === '0') return false;
    if (choice === '2') {
      saveNumbers(ROOT, '');
      console.log(green('\n  Gespeichert. Scanne den QR-Code gleich mit deinem eigenen WhatsApp.'));
      await pause();
      return true;
    }
    if (choice !== '1') continue;

    console.log('\n  Welche Nummern dürfen dem Bot schreiben? (deine normale, nicht die des Bots)');
    console.log('  Mit Ländervorwahl, mehrere mit Komma getrennt. Beispiel: +49 170 1234567\n');
    for (;;) {
      const input = await ask('  Nummer (leer = zurück): ');
      if (!input) break;
      try {
        saveNumbers(ROOT, input);
        console.log(green('\n  Gespeichert. Scanne den QR-Code gleich mit der Zweitnummer.'));
        await pause();
        return true;
      } catch (error) {
        console.log(red(`  ${error.message}`));
      }
    }
  }
}

async function startBot() {
  let crashes = 0;
  for (;;) {
    header('Bot');
    const started = Date.now();
    const code = await run('index.js');

    if (code === EXIT.stopped) return;

    if (code === EXIT.loggedOut) {
      const answer = await ask(yellow('\n  Jetzt neu mit WhatsApp verbinden? [J/n] '));
      if (/^n/i.test(answer)) return;
      resetLink(readSettings(ROOT).dataDir);
      continue;
    }

    if (code === EXIT.fatal) {
      await pause();
      return;
    }

    if (Date.now() - started > 10 * 60_000) crashes = 0;
    if (++crashes >= MAX_CRASHES) {
      console.log(red(`\n  Der Bot ist ${crashes}-mal abgestürzt. Die Ursache steht oben.`));
      await pause();
      return;
    }
    console.log(red(`\n  Der Bot wurde unerwartet beendet (Code ${code}).`));
    const answer = await ask(`  Neustart in ${RESTART_SECONDS} s (Enter = sofort, 0 = Menü): `, { seconds: RESTART_SECONDS });
    if (answer === '0') return;
  }
}

async function testLink() {
  header('Link testen');
  const link = await ask('  Produktlink einfügen (leer = zurück): ');
  if (!link) return;
  console.log('');
  await run('check.js', [link]);
  await pause();
}

async function relink() {
  header('WhatsApp neu verbinden');
  console.log('  Danach musst du einen neuen QR-Code scannen.');
  console.log('  Produkte und Preisverlauf bleiben erhalten.\n');
  const answer = await ask('  Wirklich neu verbinden? [j/N] ');
  if (!/^j/i.test(answer)) return;
  resetLink(readSettings(ROOT).dataDir);
  await startBot();
}

function showStatus() {
  try {
    const { allowed, dataDir, intervalMs } = readSettings(ROOT);
    const running = isRunning(dataDir);
    const linked = isLinked(dataDir);
    console.log(`  WhatsApp   ${linked ? green('verknüpft') : yellow('noch nicht verknüpft')}`);
    console.log(`  Nummern    ${allowed.size ? [...allowed].join(', ') : 'nur "Nachricht an dich selbst"'}`);
    console.log(`  Prüfung    alle ${intervalMs / 60_000} Minuten`);
    if (running) console.log(yellow('\n  Der Bot läuft bereits in einem anderen Fenster.'));
    // Count down only when nothing needs the user's attention.
    return linked && !running;
  } catch (error) {
    console.log(red(`  Fehler in .env: ${error.message}`));
    return false;
  }
}

async function main() {
  process.title = 'WhatsApp-Alltagshelfer';
  if (!process.stdin.isTTY) {
    console.log('Bitte start.cmd per Doppelklick öffnen. Ohne Fenster: npm start');
    process.exitCode = 1;
    return;
  }

  if (!existsSync(join(ROOT, '.env')) && (await setup())) await startBot();

  let first = true;
  for (;;) {
    header();
    const ready = showStatus();
    console.log(`\n  ${bold('1')}  Bot starten`);
    console.log(`  ${bold('2')}  Nummern einstellen`);
    console.log(`  ${bold('3')}  Link testen`);
    console.log(`  ${bold('4')}  WhatsApp neu verbinden`);
    console.log(`  ${bold('0')}  Beenden\n`);

    // Only on opening, otherwise stopping the bot would start it again.
    const seconds = first && ready ? AUTOSTART_SECONDS : undefined;
    first = false;
    const hint = seconds ? `, startet in ${seconds} s von selbst` : '';
    const choice = (await ask(`  Auswahl (Enter = starten${hint}): `, { seconds })) ?? '1';

    try {
      if (choice === '' || choice === '1') await startBot();
      else if (choice === '2') await setup();
      else if (choice === '3') await testLink();
      else if (choice === '4') await relink();
      else if (choice === '0') return;
    } catch (error) {
      console.log(red(`\n  ${error.message}`));
      await pause();
    }
  }
}

await main();
