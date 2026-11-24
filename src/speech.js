// Voice messages, understood on this PC with Whisper. Nothing leaves the PC except
// the one-time download of the model. Optional: "npm run sprache" installs it.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..', 'speech');
export const MAX_SECONDS = 120;
export const DEFAULT_MODEL = 'onnx-community/whisper-base';
const RATE = 16_000;

export const speechInstalled = (root = ROOT) => existsSync(join(root, 'node_modules', '@huggingface', 'transformers'));

/**
 * Returns transcribe(oggOpusBuffer) → text, or null without the optional packages.
 * Messages are transcribed one after the other, so two voice messages never fight for the CPU.
 */
export function createSpeech({ dataDir, model = DEFAULT_MODEL, log = () => {}, root = ROOT }) {
  if (!speechInstalled(root)) return null;
  let loading = null;
  let queue = Promise.resolve();

  async function load() {
    const { env, pipeline, OggOpusDecoder } = await import(pathToFileURL(join(root, 'index.js')).href);
    // The model belongs with the other data: it survives updates and the read-only Docker image.
    env.cacheDir = join(dataDir, 'models');
    mkdirSync(env.cacheDir, { recursive: true });
    log(`Sprachmodell ${model} wird geladen (beim ersten Mal ein Download von etwa 80 MB) ...`);
    const started = Date.now();
    const recognize = await pipeline('automatic-speech-recognition', model, { dtype: 'q8' });
    const decoder = new OggOpusDecoder();
    await decoder.ready;
    log(`Sprachmodell bereit (${Math.round((Date.now() - started) / 1000)} s). Sprachnachrichten werden jetzt verstanden.`);
    return { recognize, decoder };
  }

  function ready() {
    if (!loading) loading = load().catch((error) => {
      loading = null; // try again with the next voice message
      throw error;
    });
    return loading;
  }

  async function work(buffer) {
    const { recognize, decoder } = await ready();
    const { channelData, sampleRate } = await decoder.decodeFile(new Uint8Array(buffer));
    await decoder.reset();
    const audio = toMono16k(channelData, sampleRate);
    if (audio.length < RATE / 4) return '';
    if (audio.length > MAX_SECONDS * RATE) throw new Error('too long');
    const { text } = await recognize(audio, { language: 'german', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    return text ?? '';
  }

  function transcribe(buffer) {
    const job = queue.then(() => work(buffer));
    queue = job.catch(() => {});
    return job;
  }
  // Loading takes half a minute, better at the start than with the first voice message.
  transcribe.warmUp = () => ready().then(() => {});
  return transcribe;
}

/** Whisper wants one channel at 16 kHz. WhatsApp sends Opus at 48 kHz. */
export function toMono16k(channels, rate) {
  if (!channels?.length || !channels[0]?.length) return new Float32Array(0);
  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (const channel of channels) for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
  if (rate === RATE) return mono;
  const ratio = rate / RATE;
  const out = new Float32Array(Math.floor(length / ratio));
  for (let i = 0; i < out.length; i++) {
    // The average over each step also filters what 16 kHz cannot hold.
    const start = Math.floor(i * ratio);
    const end = Math.min(length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += mono[j];
    out[i] = sum / (end - start);
  }
  return out;
}

// Whisper invents these on silence or music, they come from subtitled videos.
const INVENTED = /untertitel|amara\.org|vielen dank (?:fürs|für's|für das) zuschauen|bis zum nächsten mal|copyright|♪|\[musik\]|\(musik\)|swr \d|zdf|ard\b/i;
const UNITS = 'uhr|minuten?|min|stunden?|std|tagen?|tage|wochen?|monaten?|monate|jahren?|euro|€|cent|prozent|%|mal|plus|minus|durch|hoch|grad';
const BEFORE = 'um|ab|bis|halb|nach|vor|in|für|mal|plus|minus|durch|hoch|von|alle|kostet';
const ONES = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const TENS = { zwanzig: 20, dreißig: 30, vierzig: 40, fünfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };
const MONTHS = 'januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember';
const ORDINALS = ['ersten', 'zweiten', 'dritten', 'vierten', 'fünften', 'sechsten', 'siebten', 'achten', 'neunten', 'zehnten', 'elften', 'zwölften'];

/** "neun" → 9, "fünfundzwanzig" → 25, "ein" and "eine" → 1. Anything else is null. */
export function numberWord(word) {
  const text = word.toLowerCase();
  if (/^(?:ein|eine|einen|einer|einem)$/.test(text)) return 1;
  const one = ONES.indexOf(text === 'sieb' ? 'sieben' : text);
  if (one >= 0) return one;
  // "zweihundertfünfzig"
  const hundreds = text.match(/^(\p{L}*?)hundert(\p{L}*)$/u);
  if (hundreds) {
    const count = hundreds[1] ? numberWord(hundreds[1] === 'ein' ? 'eins' : hundreds[1]) : 1;
    const rest = hundreds[2] ? numberWord(hundreds[2].replace(/^und/, '')) : 0;
    return count && count < 10 && rest != null && rest < 100 ? count * 100 + rest : null;
  }
  if (TENS[text]) return TENS[text];
  const compound = text.match(/^(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)und(\p{L}+)$/u);
  if (compound && TENS[compound[2]]) return ONES.indexOf(compound[1] === 'ein' ? 'eins' : compound[1]) + TENS[compound[2]];
  return null;
}

function ordinalWord(word) {
  const text = word.toLowerCase().replace(/(?:ste|sten|ster|stes|te|ter|tes)$/, 'ten');
  const small = ORDINALS.indexOf(text);
  if (small >= 0) return small + 1;
  const base = text.match(/^(\p{L}+?)s?ten$/u)?.[1];
  const value = base && numberWord(base);
  return value && value <= 31 ? value : null;
}

/**
 * What Whisper heard, made ready for the commands: invented subtitles removed,
 * the closing full stop gone, and spoken numbers next to times and amounts as digits:
 * "um neun" → "um 9", "zwölf mal drei" → "12 mal 3", "am dritten Dezember" → "am 3. Dezember".
 */
export function cleanTranscript(raw) {
  let text = String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/^["„“»«]+|["„“»«]+$/g, '').trim();
  if (!text || INVENTED.test(text)) return '';
  text = text.replace(/[.!…]+$/, '').trim();

  const word = '(\\p{L}+)';
  text = text.replace(new RegExp(`(?<=\\s|^)${word}(?=\\s+(?:${MONTHS})\\b)`, 'giu'), (match) => {
    const value = ordinalWord(match);
    return value ? `${value}.` : match;
  });
  // Twice, so that "zwölf mal drei" also turns the second number.
  for (let pass = 0; pass < 2; pass++) {
    text = text.replace(new RegExp(`(?<=(?:^|\\s)(?:${BEFORE})\\s)${word}(?=[\\s,.?!]|$)`, 'giu'), (match) => numberText(match));
    text = text.replace(new RegExp(`(?<=\\s|^)${word}(?=\\s+(?:${UNITS})(?:[\\s,.?!]|$))`, 'giu'), (match) => numberText(match));
  }
  return text;
}

function numberText(word) {
  // "in einer Stunde" and "um ein Uhr" read fine as they are, and "ein" is too common to touch.
  if (/^(?:ein|eine|einen|einer|einem)$/i.test(word)) return word;
  const value = numberWord(word);
  return value == null ? word : String(value);
}
