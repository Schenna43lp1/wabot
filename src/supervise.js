import { EXIT } from './exit-codes.js';

// A second logout this soon means the new link failed too, so a person has to look.
export const RELINK_WINDOW_MS = 10 * 60_000;
const RELINK_DELAY_MS = 5_000;

/**
 * Decides in Docker what happens after the bot ends. Docker restarts every
 * exit, so whatever a restart cannot fix waits here instead of looping.
 * run() resolves to the exit code, or null when the container is stopping.
 */
export async function supervise({ run, relink, checkData, log, idle, exit, sleep, now = Date.now }) {
  try {
    checkData();
  } catch (error) {
    log(error.message);
    return idle();
  }

  let lastLogout = -Infinity;
  for (;;) {
    const code = await run();
    if (code === null) return exit(EXIT.stopped);

    if (code === EXIT.loggedOut) {
      if (now() - lastLogout < RELINK_WINDOW_MS) {
        log('WhatsApp hat auch die neue Verknüpfung sofort beendet. Ist die Nummer gesperrt? Der Bot wartet. Neuer Versuch: docker compose restart');
        return idle();
      }
      lastLogout = now();
      try {
        relink();
      } catch (error) {
        log(`Neu verbinden geht nicht: ${error.message} Der Bot wartet.`);
        return idle();
      }
      log('Neuer QR-Code folgt gleich. Die alte Verknüpfung liegt in data/auth-alt-…');
      await sleep(RELINK_DELAY_MS);
      continue;
    }

    // The cause is in the log above: a typo in .env, a second instance, a blocked number.
    if (code === EXIT.fatal) {
      log('Der Bot wartet, bis der Fehler oben behoben ist. Danach: docker compose up -d (nach Änderungen an .env) oder docker compose restart');
      return idle();
    }

    // A crash: Docker starts the container again, with growing pauses.
    return exit(code);
  }
}
