// Voice messages, understood on this PC with Whisper. Nothing leaves the PC except
// the one-time download of the model. Optional: "npm run sprache" installs it.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { actionOf, distance, fold } from './input.js';

const ROOT = join(import.meta.dirname, '..', 'speech');
export const MAX_SECONDS = 120;
export const DEFAULT_MODEL = 'onnx-community/whisper-base';
const RATE = 16_000;
// SPEECH_MODEL=small and so on. Sizes of the q8 files, measured on Hugging Face.
export const MODELS = {
  tiny: { id: 'onnx-community/whisper-tiny', mb: 40 },
  base: { id: 'onnx-community/whisper-base', mb: 80 },
  small: { id: 'onnx-community/whisper-small', mb: 250 },
  turbo: { id: 'onnx-community/whisper-large-v3-turbo', mb: 1100 },
};

/** "small" → the full name, anything else stays as it is. */
export function modelId(name) {
  return MODELS[String(name ?? '').trim().toLowerCase()]?.id ?? (String(name ?? '').trim() || DEFAULT_MODEL);
}

export const speechInstalled = (root = ROOT) => existsSync(join(root, 'node_modules', '@huggingface', 'transformers'));

/**
 * Returns transcribe(oggOpusBuffer) → text, or null without the optional packages.
 * Messages are transcribed one after the other, so two voice messages never fight for the CPU.
 */
export function createSpeech({ dataDir, model: name, log = () => {}, root = ROOT }) {
  if (!speechInstalled(root)) return null;
  const model = modelId(name);
  const size = Object.values(MODELS).find((known) => known.id === model)?.mb;
  let loading = null;
  let loaded = false;
  let queue = Promise.resolve();

  async function load() {
    const { env, pipeline, OggOpusDecoder } = await import(pathToFileURL(join(root, 'index.js')).href);
    // The model belongs with the other data: it survives updates and the read-only Docker image.
    env.cacheDir = join(dataDir, 'models');
    mkdirSync(env.cacheDir, { recursive: true });
    log(`Sprachmodell ${model} wird geladen${size ? ` (beim ersten Mal ein Download von etwa ${size} MB)` : ''} ...`);
    const started = Date.now();
    const recognize = await pipeline('automatic-speech-recognition', model, { dtype: 'q8' });
    const decoder = new OggOpusDecoder();
    await decoder.ready;
    log(`Sprachmodell bereit (${Math.round((Date.now() - started) / 1000)} s). Sprachnachrichten werden jetzt verstanden.`);
    loaded = true;
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
    // WhatsApp voice messages are Ogg Opus. Forwarded music or iPhone files may be something else.
    if (!isOgg(buffer)) throw new SpeechError('format');
    // Decoding a long recording fills the memory before its length is known, so the header decides first.
    if (oggSeconds(buffer) > MAX_SECONDS + 1) throw new SpeechError('long');
    let model;
    try {
      model = await ready();
    } catch (error) {
      throw new SpeechError('load', error);
    }
    const { recognize, decoder } = model;
    let decoded;
    try {
      decoded = await decoder.decodeFile(new Uint8Array(buffer));
    } catch (error) {
      throw new SpeechError('format', error);
    } finally {
      await decoder.reset();
    }
    const audio = toMono16k(decoded.channelData, decoded.sampleRate);
    if (audio.length > MAX_SECONDS * RATE) throw new SpeechError('long');
    // On silence and noise Whisper invents whole sentences, so it only gets to hear speech.
    const speech = findSpeech(audio);
    if (!speech) return '';
    const { text } = await recognize(louder(speech), { language: 'german', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    return text ?? '';
  }

  function transcribe(buffer) {
    const job = queue.then(() => work(buffer));
    queue = job.catch(() => {});
    return job;
  }
  // Loading takes half a minute, better at the start than with the first voice message.
  transcribe.warmUp = () => ready().then(() => {});
  transcribe.isReady = () => loaded;
  return transcribe;
}

/** Why a voice message was not understood: 'format', 'load' (the model) or 'long'. */
export class SpeechError extends Error {
  constructor(kind, cause) {
    super(`${kind}${cause ? `: ${cause.message}` : ''}`, { cause });
    this.kind = kind;
  }
}

/**
 * Length of an Ogg Opus file from the granule position of its last page (always 48 kHz), or 0 if unknown.
 */
export function oggSeconds(buffer) {
  const bytes = Buffer.from(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.length);
  for (let at = bytes.lastIndexOf('OggS'); at >= 0; at = at > 0 ? bytes.lastIndexOf('OggS', at - 1) : -1) {
    // A page header: "OggS", version 0, flags, then the granule position.
    if (at + 14 > bytes.length || bytes[at + 4] !== 0) continue;
    const granule = bytes.readBigUInt64LE(at + 6);
    // -1 marks a page on which no packet ends.
    if (granule !== 0xffffffffffffffffn) return Number(granule) / 48_000;
  }
  return 0;
}

const isOgg = (buffer) => buffer?.length > 4 && buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53;

const FRAME_SECONDS = 0.03;
// Speech rises and falls by 16 dB and more between syllables, even in a car or a café.
// Silence, steady noise and tones stay below 7 dB. Measured on recordings with noise mixed in.
const SPEECH_RANGE_DB = 10;
const MIN_SPEECH_SECONDS = 0.3;

/**
 * The part with speech, with a little room before and after, or null when there is none:
 * silence, a steady hum, wind noise or a tone.
 */
export function findSpeech(audio, rate = RATE) {
  const size = Math.round(rate * FRAME_SECONDS);
  const count = Math.floor(audio.length / size);
  if (count < 10) return null;
  // Engine rumble and wind sit below the voice, so they do not count.
  const voice = highPass(audio, 300, rate);
  const level = new Float64Array(count);
  for (let frame = 0; frame < count; frame++) {
    let sum = 0;
    for (let i = frame * size; i < (frame + 1) * size; i++) sum += voice[i] * voice[i];
    level[frame] = 10 * Math.log10(sum / size + 1e-12);
  }
  const sorted = [...level].sort((a, b) => a - b);
  const floor = sorted[Math.floor(count * 0.1)];
  // The loud end, but not a single click.
  const peak = sorted[Math.min(count - 1, Math.floor(count * 0.97))];
  if (peak < -75 || peak - floor < SPEECH_RANGE_DB) return null;
  const threshold = floor + (peak - floor) * 0.35;
  let first = -1;
  let last = -1;
  let voiced = 0;
  for (let frame = 0; frame < count; frame++) {
    if (level[frame] < threshold) continue;
    if (first < 0) first = frame;
    last = frame;
    voiced++;
  }
  if (voiced * FRAME_SECONDS < MIN_SPEECH_SECONDS) return null;
  const start = Math.max(0, first - Math.round(0.4 / FRAME_SECONDS)) * size;
  const end = Math.min(count, last + Math.round(0.6 / FRAME_SECONDS)) * size;
  return audio.subarray(start, end);
}

/** A second-order Butterworth high-pass filter. */
function highPass(input, cutoff, rate) {
  const w = (2 * Math.PI * cutoff) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / Math.SQRT2;
  const a0 = 1 + alpha;
  const [b0, b1, b2] = [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0];
  const [a1, a2] = [(-2 * cos) / a0, (1 - alpha) / a0];
  const output = new Float32Array(input.length);
  let [x1, x2, y1, y2] = [0, 0, 0, 0];
  for (let i = 0; i < input.length; i++) {
    const y = b0 * input[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    [x2, x1, y2, y1] = [x1, input[i], y1, y];
    output[i] = y;
  }
  return output;
}

/** Quiet recordings brought up to a normal level. */
export function louder(audio) {
  let peak = 0;
  for (const sample of audio) peak = Math.max(peak, Math.abs(sample));
  if (!peak || peak >= 0.5) return audio;
  const gain = Math.min(0.9 / peak, 100);
  return audio.map((sample) => sample * gain);
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
const UNITS = 'uhr|minuten?|min|stunden?|std|tagen?|tage|wochen?|monaten?|monate|jahren?|euro|€|cent|dollar|franken|pfund|kronen|prozent|%|mal|geteilt|plus|minus|durch|hoch|grad|stück|kilo|gramm|liter';
const BEFORE = 'um|ab|bis|halb|viertel|dreiviertel|nach|vor|in|für|mal|plus|minus|durch|hoch|von|alle|kostet|uhr|euro|sind|ist|wären|macht|kosten|nummer|nr';
const HOURS = 'eins|ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf';
// What Whisper often mishears in commands, found with test recordings.
const MISHEARD = [
  [/^(?:weg|weckt|wecke|weg') mich\b/i, 'Weck mich'],
  [/(?<!\p{L})über morgen(?!\p{L})/giu, 'übermorgen'],
  [/^(?:schreit|schreibt|schreibe|schrei) (?=.+ (?:auf|in|zu|zur) )/i, 'Schreib '],
  [/^(?:macht|mag|max) (?=das |es )/i, 'Mach '],
  [/^(?:seid|zeit|zeigt) mir\b/i, 'Zeig mir'],
  [/^(Zeig mir) in (?=meine)/i, '$1 '],
  [/\b(?:10\.?|zehn) ?arzt\b/gi, 'Zahnarzt'],
  [/\b(um|und) neuen\b(?=\s+(?:uhr|an)\b|[,.!?]|$)/gi, 'um neun'],
  [new RegExp(`(?<=(?<!\\p{L})(?:heute|morgen|übermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag) )und (?=(?:\\d{1,2}|${HOURS}|halb|viertel)\\b)`, 'giu'), 'um '],
  [new RegExp(`\\bhalb ?r?(${HOURS})\\b`, 'giu'), 'halb $1'],
  [/\bsteu\p{L}* ?\p{L}*klärung\b/giu, 'Steuererklärung'],
  [/^(?:der |die |er )?innere mich\b/i, 'Erinnere mich'],
  [/^we(?:g|ck|gg) nicht (?=morgen|heute|übermorgen|um |in |am )/i, 'Weck mich '],
  // "Mach das Rückjängig", "Mach das zurück, gängig", "Mach das rückgängig nicht"
  [/^(mach(?:e)? (?:das|es)) (?:r[üu]ck\p{L}*|zurück,? g[äa]ngig)(?:[\s,]+\p{L}+)?$/iu, '$1 rückgängig'],
  [/(?<=\ban den )(?:10\.?|zehn) ?a(?:rzt)?$/i, 'Zahnarzt'],
  // "wann hat Anna geworzt Tag"
  [/(?<=\bhat \p{L}+ )ge\p{L}*\s?tag\b/iu, 'Geburtstag'],
  [/^(?:märk|merkt?|merke) (?:dir|ihr|dia)\b[,.!?]?/iu, 'Merk dir,'],
  [/\bd[ou]nn?[ae]r?s?tag\b/giu, 'Donnerstag'],
  [/(?<=\p{L})geteilt\b/giu, ' geteilt'],
  [/\b(\p{L}*hundert)s\b/giu, '$1'],
  [/\b(?:und|um) (?:zähn|sehen|zehen|zen)(?=\s+(?:uhr|an)\b|[,.!?]|$)/giu, 'um zehn'],
  [/\bund halte? (?=\d|halb|viertel|(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)\b)/giu, 'um halb '],
];
// Long command words that Whisper gets slightly wrong: "Einkaufsiste", "Erinnerrungen"
const KEY_WORDS = ['Einkaufsliste', 'Einkaufszettel', 'Erinnerungen', 'rückgängig', 'Geburtstag', 'Geburtstage', 'Notizen', 'Termine'];
// Hesitations nobody means: "Erinnere mich, äh, morgen …"
const HESITATION = /(?<=^|[\s,])(?:äh+m*|öh+m*|ehm+|hm+|mhm|ähm+)(?=[\s,.!?]|$)[,.]?/giu;
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
  text = withoutRepeats(text.replace(HESITATION, ' ').replace(/\s+/g, ' ').replace(/^[\s,.]+/, ''));
  text = text.replace(/[.!…]+$/, '').trim();
  for (const [heard, meant] of MISHEARD) text = text.replace(heard, meant);
  text = text.replace(/\p{L}{7,}/gu, nearKeyWord);
  // Said out loud: "Milch Komma Brot" and "12 Komma 5"
  text = text.replace(/(?<=\d) Komma (?=\d)/gi, ',').replace(/\s+Komma(?=\s|$)/gi, ',');

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
  // "12 Euro 50" → "12,50 Euro"
  return text.replace(/\b(\d{1,6}) (Euro|€|Franken|Dollar) (\d{1,2})\b(?! ?(?:uhr|minuten?|stunden?|tagen?|%|prozent)\b)/gi,
    (_, whole, unit, cents) => `${whole},${cents.padStart(2, '0')} ${unit}`);
}

/** "Einkaufslüsste" → "Einkaufsliste". Words the bot knows stay, "Erinnerung" is no "Erinnerungen". */
function nearKeyWord(word) {
  const folded = fold(word);
  if (actionOf(word) || KEY_WORDS.some((key) => fold(key) === folded)) return word;
  // Short words are often real words: "Rückgang" is no "rückgängig".
  const allowed = folded.length >= 10 ? 2 : 1;
  return KEY_WORDS.find((key) => distance(folded, fold(key)) <= allowed) ?? word;
}

/**
 * Whisper sometimes loops: "Danke. Danke. Danke." or the same sentence twice.
 * Each sentence and each word counts once in a row.
 */
function withoutRepeats(text) {
  // A full stop followed by a space ends a sentence, "9.30" does not.
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence, i) => i === 0 || simple(sentence) !== simple(sentences[i - 1]));
  return kept.join(' ').replace(/(?<!\p{L})(\p{L}+)(?:[\s,.!?]+\1(?!\p{L})){2,}/giu, '$1');
}
const simple = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function numberText(word) {
  // "in einer Stunde" and "um ein Uhr" read fine as they are, and "ein" is too common to touch.
  if (/^(?:ein|eine|einen|einer|einem)$/i.test(word)) return word;
  const value = numberWord(word);
  return value == null ? word : String(value);
}
