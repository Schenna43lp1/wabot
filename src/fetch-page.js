import dns from 'node:dns';
import ipaddr from 'ipaddr.js';
import { loadBuffer } from 'cheerio';
import { Agent, fetch } from 'undici';
import { UserError } from './errors.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 8;

export function isPublicAddress(address) {
  return ipaddr.isValid(address) && ipaddr.process(address).range() === 'unicast';
}

// Checks the address the socket really connects to, so a DNS answer cannot
// change between check and request (DNS rebinding).
export function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || !addresses.every((a) => isPublicAddress(a.address))) {
      return callback(new UserError('Adressen im lokalen Netzwerk sind gesperrt.', 'invalid'));
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

const dispatcher = new Agent({ connect: { lookup: publicLookup }, maxHeaderSize: 65536 });

export function validateUrl(input) {
  if (!URL.canParse(input)) throw new UserError('Das ist kein gültiger Link.', 'invalid');
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new UserError('Nur normale http(s)-Links sind erlaubt.', 'invalid');
  }
  // IP literals never pass through DNS lookup.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(host) && !isPublicAddress(host)) {
    throw new UserError('Adressen im lokalen Netzwerk sind gesperrt.', 'invalid');
  }
  return url;
}

export async function fetchPage(input) {
  let url = validateUrl(input);
  const cookies = new Map(); // per host, some shops redirect in circles without them
  const signal = AbortSignal.timeout(25_000);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const jar = cookies.get(url.host) ?? new Map();
      cookies.set(url.host, jar);
      const response = await fetch(url, {
        dispatcher,
        signal,
        redirect: 'manual',
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; PriceTracker/1.0)',
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'de-DE,de;q=0.9,en;q=0.5',
          ...(jar.size && { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }),
        },
      });

      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0];
        const split = pair.indexOf('=');
        if (split > 0) jar.set(pair.slice(0, split), pair.slice(split + 1));
      }

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        url = validateUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw httpError(response.status);
      }
      const type = response.headers.get('content-type') ?? '';
      if (type && !/html|text\/plain/i.test(type)) {
        await response.body?.cancel();
        throw new UserError('Der Link zeigt nicht auf eine Webseite, sondern auf eine Datei.', 'invalid');
      }

      const chunks = [];
      let size = 0;
      for await (const chunk of response.body ?? []) {
        size += chunk.length;
        if (size > MAX_BYTES) throw new UserError('Die Seite ist zu groß.', 'invalid');
        chunks.push(chunk);
      }
      return { url: url.href, html: decode(Buffer.concat(chunks), type) };
    }
    throw new UserError('Der Shop leitet im Kreis weiter.', 'blocked');
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (error.cause instanceof UserError) throw error.cause;
    if (signal.aborted) throw new UserError('Der Shop antwortet gerade nicht.', 'temporary');
    if (error.cause?.code === 'ENOTFOUND') {
      throw new UserError('Die Webadresse wurde nicht gefunden (Tippfehler oder kein Internet).', 'temporary');
    }
    throw new UserError(`Die Seite ist gerade nicht erreichbar (${error.cause?.code ?? error.message}).`, 'temporary');
  }
}

/** The link is the password of the calendar, so it never travels unencrypted. */
function encryptedUrl(input) {
  const url = validateUrl(input);
  if (url.protocol !== 'https:') {
    throw new UserError('Kalender-Links müssen mit https:// beginnen, sonst ginge der geheime Link unverschlüsselt durchs Netz.', 'invalid');
  }
  return url;
}

/** A calendar (.ics) behind a secret link, with the same protection as shop pages. */
export async function fetchCalendar(link) {
  let url = encryptedUrl(link.replace(/^webcals?:\/\//i, 'https://'));
  const signal = AbortSignal.timeout(25_000);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await fetch(url, {
        dispatcher,
        signal,
        redirect: 'manual',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; Alltagshelfer/1.0)', accept: 'text/calendar, text/plain;q=0.5' },
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        url = encryptedUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404 || response.status === 410 || response.status === 401 || response.status === 403) {
          throw new UserError(`Den Kalender gibt es unter diesem Link nicht (mehr) (HTTP ${response.status}). Wurde der Link zurückgesetzt?`, 'gone');
        }
        throw new UserError(`Der Kalender ist gerade nicht erreichbar (HTTP ${response.status}).`, 'temporary');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body ?? []) {
        size += chunk.length;
        if (size > MAX_BYTES) throw new UserError('Der Kalender ist zu groß.', 'invalid');
        chunks.push(chunk);
      }
      return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
    }
    throw new UserError('Der Kalender-Link leitet im Kreis weiter.', 'invalid');
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (error.cause instanceof UserError) throw error.cause;
    if (signal.aborted) throw new UserError('Der Kalender antwortet gerade nicht.', 'temporary');
    throw new UserError(`Der Kalender ist gerade nicht erreichbar (${error.cause?.code ?? error.message}).`, 'temporary');
  }
}

function decode(buffer, contentType) {
  const charset = contentType.match(/charset=["']?([\w-]+)/i)?.[1];
  if (charset) {
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      // Unknown charset: fall back to detection from the document itself.
    }
  }
  return loadBuffer(buffer).html();
}

function httpError(status) {
  if (status === 404 || status === 410) return new UserError(`Die Produktseite gibt es nicht (HTTP ${status}).`, 'gone');
  if (status === 429) return new UserError('Der Shop bremst gerade, zu viele Abfragen (HTTP 429).', 'temporary');
  if (status >= 500) return new UserError(`Der Shop hat gerade eine Störung (HTTP ${status}).`, 'temporary');
  return new UserError(`Der Shop blockiert die automatische Abfrage (HTTP ${status}).`, 'blocked');
}
