import { join } from 'node:path';
import makeWASocket, {
  BufferJSON, DisconnectReason, downloadMediaMessage, isLidUser, jidNormalizedUser, normalizeMessageContent, useMultiFileAuthState,
} from 'baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { authorize } from './access.js';
import { EXIT } from './exit-codes.js';
import { connectsCalendar } from './calendar.js';
import { isQuiet } from './schedule.js';
import { cleanTranscript, MAX_SECONDS } from './speech.js';

// Prefix of every bot message, so the self-chat cannot answer itself in a loop.
const MARK = '🤖 ';
const DAY_MS = 86_400_000;
const MAX_VOICE_BYTES = 5_000_000;
const TYPING_AFTER_MS = 600;
// Older messages say when they were written: the price may have moved since.
const DELAYED_MS = 30 * 60_000;
// Only a terminal window has the Q key, in Docker there is none.
const KEYS = process.stdin.isTTY;
const ONLY_TEXT = 'Ich kann nur Text lesen. Schick mir den Produktlink als Nachricht, am schnellsten über „Teilen“ im Shop.';
const NO_SPEECH = '🎤 Sprachnachrichten verstehe ich noch nicht, bitte schreib mir. Einschalten lässt sich das am PC des Bots (README, „Sprachnachrichten“).';
const NOT_HEARD = '🎤 Ich habe in der Sprachnachricht keine Worte verstanden. Sprich bitte etwas näher am Handy oder schreib mir.';
const TOO_LONG = `🎤 Die Sprachnachricht ist zu lang. Ich höre mir höchstens ${MAX_SECONDS / 60} Minuten an, kurze Sätze klappen am besten.`;
const SPEECH_FAILED = {
  format: '🎤 Diese Audiodatei kann ich nicht abspielen. Ich verstehe Sprachnachrichten, die du direkt in WhatsApp aufnimmst.',
  load: '🎤 Mein Sprachmodell lässt sich gerade nicht laden, bitte schreib mir. Details stehen im Bot-Fenster.',
  long: TOO_LONG,
  download: '🎤 Die Sprachnachricht konnte ich nicht herunterladen. Schick sie bitte noch einmal.',
};
const LOADING = '🎤 Einen Moment, ich lade beim ersten Mal noch das Sprachmodell …';

const DISCONNECTED = {
  405: 'WhatsApp lehnt diese Bot-Version ab (siehe README, Probleme)',
  408: 'Keine Antwort von WhatsApp, besteht eine Internetverbindung?',
  428: 'Verbindung unterbrochen',
  503: 'WhatsApp ist gerade nicht erreichbar',
  515: 'Kopplung wird abgeschlossen',
};

/**
 * transcribe(buffer) → text turns voice messages into commands, null without speech recognition.
 * download(message, socket) → buffer can be replaced in tests.
 */
export async function startWhatsApp({
  db, config, handle, log, onFatal, createSocket = makeWASocket, now = Date.now, transcribe = null,
  download = (message, socket) => downloadMediaMessage(message, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: socket.updateMediaMessage }),
}) {
  const logger = pino({ level: 'silent' });
  const { state, saveCreds } = await useMultiFileAuthState(join(config.dataDir, 'auth'));
  const queues = new Map();
  let sock;
  let online = false;
  let stopped = false;
  let flushing = false;
  let attempts = 0;
  let timer;
  let showingQr = false;
  let warnedStranger = false;

  function howToUse(me) {
    const own = jidNormalizedUser(me?.id).split('@')[0];
    const others = [...config.allowed].filter((number) => number !== own);
    if (others.length) {
      log(`So geht es: von +${others.join(', +')} eine Nachricht an +${own} schicken, z. B. "hallo".`);
      return;
    }
    if (config.allowed.has(own)) {
      log('Achtung: Die erlaubte Nummer ist die des Bots selbst. Bei einer Zweitnummer gehört dort deine normale Nummer hin (Menü 2).');
    }
    log('So geht es: in WhatsApp den Chat "Nachricht an dich selbst" öffnen und "hilfe" oder einen Produktlink schicken.');
  }

  function connect() {
    const current = createSocket({
      auth: state,
      logger,
      syncFullHistory: false,
      // Otherwise the linked phone stops showing notifications.
      markOnlineOnConnect: false,
      shouldSyncHistoryMessage: () => false,
      // WhatsApp asks for the original when a device could not decrypt it.
      // Anyone can ask for any id, so only the chat that got the message gets it again.
      getMessage: async ({ id, remoteJid }) => {
        const row = id && db.sent(id);
        if (!row?.chat || !(await sameChat(sock, row.chat, remoteJid))) return undefined;
        return JSON.parse(row.body, BufferJSON.reviver);
      },
    });
    sock = current;

    current.ev.on('creds.update', saveCreds);

    current.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        showingQr = true;
        // Replace the expired code instead of stacking a new one below it.
        if (process.stdout.isTTY) console.clear();
        log('QR-Code scannen: WhatsApp → Verknüpfte Geräte → Gerät hinzufügen');
        qrcode.generate(qr, { small: true }, (code) => process.stdout.write(`${code}\n`));
        process.stdout.write(`Code unvollständig? Fenster maximieren. Er erneuert sich von selbst.${KEYS ? ' Q = beenden' : ''}\n`);
      }
      if (connection === 'open') {
        online = true;
        attempts = 0;
        // Only remove a QR code, after a reconnect the log should stay.
        if (showingQr && process.stdout.isTTY) console.clear();
        showingQr = false;
        log(KEYS ? '✔ WhatsApp ist verbunden. Fenster offen lassen, beenden mit Q.' : '✔ WhatsApp ist verbunden.');
        howToUse(current.user);
        void flush();
      }
      if (connection !== 'close') return;

      online = false;
      if (stopped) return;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        return onFatal('WhatsApp wurde abgemeldet. Das Gerät muss neu verknüpft werden.', EXIT.loggedOut);
      }
      if (code === DisconnectReason.connectionReplaced) {
        return onFatal('Die Sitzung wurde von einer anderen Bot-Instanz übernommen.');
      }
      if (code === DisconnectReason.forbidden) {
        return onFatal('WhatsApp hat den Zugriff verweigert. Die Nummer ist eventuell gesperrt.');
      }
      const delay = code === DisconnectReason.restartRequired ? 0 : Math.min(60_000, 2_000 * 2 ** attempts++);
      log(`${DISCONNECTED[code] ?? 'Verbindung getrennt'} (Code ${code ?? 'unbekannt'}). Neuer Versuch in ${delay / 1000} s.`);
      timer = setTimeout(connect, delay);
    });

    current.ev.on('messages.upsert', ({ messages }) => {
      for (const message of messages) {
        receive(current, message).catch((error) => log(`Nachricht nicht verarbeitet: ${error.stack}`));
      }
    });
  }

  async function receive(socket, raw) {
    const { key, message, messageTimestamp } = raw;
    const content = normalizeMessageContent(message);
    const text = content?.conversation || content?.extendedTextMessage?.text ||
      content?.imageMessage?.caption || content?.videoMessage?.caption;
    const media = content?.imageMessage || content?.videoMessage || content?.audioMessage || content?.documentMessage;
    if (!key.id || (!text && !media) || text?.length > 4000 || text?.startsWith(MARK)) return;

    // Messages sent while the PC was off count, but nothing from before the installation.
    const sentAt = Number(messageTimestamp) * 1000;
    if (sentAt < Math.max(Date.now() - DAY_MS, db.installedAt() - 60_000)) return;

    const sender = await authorize({
      key,
      me: socket.user,
      allowed: config.allowed,
      resolveLid: (lid) => socket.signalRepository.lidMapping.getPNForLID(lid),
    });
    if (!sender) {
      // The most common setup mistake is a wrong number, which otherwise looks like a dead bot.
      const direct = !key.fromMe && !key.participant && /@(s\.whatsapp\.net|lid)$/.test(key.remoteJid ?? '');
      if (direct && config.allowed.size && !warnedStranger) {
        warnedStranger = true;
        log(`Nachricht von einer nicht erlaubten Nummer ignoriert. Warst du das? ${KEYS ? 'Dann mit Q ins Menü und 2 wählen.' : 'Dann ALLOWED_NUMBERS in .env prüfen.'}`);
      }
      return;
    }
    const voice = !text && content?.audioMessage ? content.audioMessage : null;
    // In the self-chat photos, audio files and voice messages are notes, unless the bot can listen to voice.
    if (!text && sender.self && !(voice && voice.ptt !== false && transcribe)) return;
    if (!db.claimMessage(`${sender.user}:${key.id}`)) return;

    // One message after the other per user.
    const job = (queues.get(sender.user) ?? Promise.resolve()).then(async () => {
      let reply;
      // Shops can take seconds, show that something is happening.
      const typing = setTimeout(() => setPresence(socket, 'composing', sender.chat), TYPING_AFTER_MS);
      try {
        if (text) reply = await handle(sender.user, text, { quiet: sender.self });
        else if (voice) reply = await listen(socket, raw, voice, sender);
        else reply = ONLY_TEXT;
      } catch (error) {
        log(`Befehl fehlgeschlagen: ${error.stack}`);
        reply = 'Da ist bei mir etwas schiefgelaufen, versuch es bitte noch einmal. Details stehen im Bot-Fenster.';
      } finally {
        clearTimeout(typing);
        setPresence(socket, 'paused', sender.chat);
      }
      if (reply) await answer(sender, reply);
      // The calendar link works like a password. In the self-chat the message is ours, so it can go.
      if (sender.self && key.fromMe && text && connectsCalendar(text)) {
        try {
          await socket.sendMessage(sender.chat, { delete: key });
        } catch (error) {
          log(`Nachricht mit Kalender-Link nicht gelöscht: ${error.message}`);
        }
      }
    });
    queues.set(sender.user, job.catch(() => {}));
    await job;
  }

  /** A voice message: transcribed on this PC, then handled like the same words typed. */
  async function listen(socket, raw, voice, sender) {
    const quiet = sender.self;
    if (!transcribe) return NO_SPEECH;
    // Two minutes of WhatsApp voice are about 300 KB. Anything far bigger is no voice message.
    if (Number(voice.seconds) > MAX_SECONDS || Number(voice.fileLength) > MAX_VOICE_BYTES) return quiet ? null : TOO_LONG;
    let audio;
    try {
      audio = await download(raw, socket);
    } catch (error) {
      log(`Sprachnachricht nicht heruntergeladen: ${error.message}`);
      return quiet ? null : SPEECH_FAILED.download;
    }
    // seconds and fileLength are what the sender's phone claims, the file itself counts.
    if (audio?.length > MAX_VOICE_BYTES) return quiet ? null : TOO_LONG;
    // Only the very first voice message after the start waits for the model.
    if (!quiet && transcribe.isReady?.() === false) await answer(sender, LOADING);
    let heard;
    const started = now();
    try {
      heard = cleanTranscript(await transcribe(audio));
    } catch (error) {
      log(`Sprachnachricht nicht verstanden: ${error.message}`);
      return quiet ? null : (SPEECH_FAILED[error.kind] ?? NOT_HEARD);
    }
    // How long it took, never what was said.
    const took = ((now() - started) / 1000).toFixed(1).replace('.', ',');
    log(`🎤 Sprachnachricht (${Number(voice.seconds) || '?'} s) ${heard ? 'verstanden' : 'ohne erkennbare Worte'} in ${took} s.`);
    if (!heard) return quiet ? null : NOT_HEARD;
    // In the self-chat a voice memo that is no command stays a memo.
    const reply = await handle(sender.user, heard, { quiet });
    if (reply == null) return null;
    const said = `🎤 _„${heard.replace(/[_*~`]/g, '')}“_\n\n`;
    return typeof reply === 'string' ? said + reply : { ...reply, text: said + reply.text };
  }

  async function answer({ user, chat }, reply) {
    try {
      if (reply.file) await sendFile(chat, reply);
      else if (reply.image) await sendImage(chat, reply);
      else await send(chat, reply);
    } catch (error) {
      if (typeof reply === 'string') return void db.queue(user, reply, { urgent: true, at: now() });
      log(`${reply.file ? 'Export' : 'Bild'} nicht gesendet: ${error.message}`);
      const notice = reply.file
        ? '⚠️ Die Tabelle konnte ich nicht senden. Schick bitte noch einmal `export`.'
        : `${reply.text}\n\n⚠️ Das Diagramm konnte ich nicht senden.`;
      db.queue(user, notice, { urgent: true, at: now() });
    }
  }

  function setPresence(socket, presence, jid) {
    // Cosmetic, so it must never break a reply.
    if (online) socket.sendPresenceUpdate?.(presence, jid)?.catch(() => {});
  }

  async function send(jid, text) {
    if (!online) throw new Error('offline');
    for (const part of splitText(text)) {
      const sent = await sock.sendMessage(jid, { text: MARK + part });
      remember(sent);
    }
  }

  async function sendFile(jid, { text, file }) {
    if (!online) throw new Error('offline');
    const sent = await sock.sendMessage(jid, {
      document: file.data, fileName: file.name, mimetype: file.mimetype, caption: MARK + text,
    });
    remember(sent);
  }

  async function sendImage(jid, { text, image }) {
    if (!online) throw new Error('offline');
    const sent = await sock.sendMessage(jid, {
      image: image.data,
      mimetype: image.mimetype,
      caption: MARK + text,
      width: image.width,
      height: image.height,
      // Baileys needs sharp or jimp for a preview. Without one the phone loads the full image.
      jpegThumbnail: '',
    });
    remember(sent);
  }

  function remember(sent) {
    if (sent?.key.id) db.saveSent(sent.key.id, JSON.stringify(sent.message, BufferJSON.replacer), sent.key.remoteJid);
  }

  async function flush() {
    if (flushing || !online) return;
    flushing = true;
    try {
      const own = jidNormalizedUser(sock.user.id).split('@')[0];
      for (const item of db.queued()) {
        if (item.user === own || config.allowed.has(item.user)) {
          const at = now();
          if (!item.urgent && isQuiet(db.settings(item.user), at)) continue;
          await send(`${item.user}@s.whatsapp.net`, withTime(item, at));
        }
        db.dequeue(item.id);
      }
    } catch (error) {
      log(`Benachrichtigung wird später erneut gesendet: ${error.message}`);
    } finally {
      flushing = false;
    }
  }

  function withTime({ text, at }, current) {
    if (!at || current - at < DELAYED_MS) return text;
    const time = new Date(at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `${text}\n\n_Stand: ${time} Uhr_`;
  }

  connect();

  return {
    flush,
    stop() {
      stopped = true;
      online = false;
      clearTimeout(timer);
      sock?.end(undefined);
    },
  };
}

/** True when both are the same person, whether WhatsApp names them by number or by LID. */
export async function sameChat(socket, a, b) {
  if (!a || !b) return false;
  const own = [socket.user?.id, socket.user?.lid].filter(Boolean).map((jid) => jidNormalizedUser(jid));
  const person = async (jid) => {
    const normalized = jidNormalizedUser(jid);
    if (own.includes(normalized)) return 'self';
    if (!isLidUser(normalized)) return normalized;
    const phone = await Promise.resolve(socket.signalRepository?.lidMapping?.getPNForLID(normalized)).catch(() => null);
    return phone ? jidNormalizedUser(phone) : normalized;
  };
  return (await person(a)) === (await person(b));
}

export function splitText(text, max = 3500) {
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut <= 0) cut = rest.lastIndexOf('\n', max);
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  parts.push(rest);
  return parts;
}
