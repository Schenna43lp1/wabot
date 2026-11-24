import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cleanTranscript, createSpeech, findSpeech, louder, modelId, numberWord, speechInstalled, toMono16k } from '../src/speech.js';

const RATE = 16_000;
// Something that rises and falls like syllables: bursts of noise with pauses, at the given level.
function speechLike(seconds = 2, level = 0.3, background = 0) {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => {
    const t = i / RATE;
    const syllable = Math.sin(Math.PI * ((t * 4) % 1)) ** 2 * (Math.floor(t * 4) % 3 === 2 ? 0 : 1);
    return random() * level * syllable + random() * background;
  });
}
const silence = (seconds) => new Float32Array(seconds * RATE);
const tone = (seconds) => Float32Array.from({ length: seconds * RATE }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE));
function join32(...parts) {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

test('spoken numbers', () => {
  const cases = { neun: 9, zwölf: 12, zwanzig: 20, fünfundzwanzig: 25, einundvierzig: 41, hundert: 100, zweihundertfünfzig: 250, einhundertzwei: 102, Haus: null, und: null };
  for (const [word, value] of Object.entries(cases)) assert.equal(numberWord(word), value, word);
});

test('transcripts are made ready for the commands', () => {
  const cases = [
    [' Erinnere mich morgen um neun an den Zahnarzt.', 'Erinnere mich morgen um 9 an den Zahnarzt'],
    ['Erinnere mich in zwanzig Minuten an die Wäsche.', 'Erinnere mich in 20 Minuten an die Wäsche'],
    ['Erinnere mich um halb acht an Sport!', 'Erinnere mich um halb 8 an Sport'],
    ['Was ist zwölf mal drei?', 'Was ist 12 mal 3?'],
    ['Ausgabe zwölf Euro Essen.', 'Ausgabe 12 Euro Essen'],
    ['Wann ist der dritte Dezember?', 'Wann ist der 3. Dezember?'],
    ['Erinnere mich am einundzwanzigsten März an Steuer.', 'Erinnere mich am 21. März an Steuer'],
    ['Erinnere mich in einer Stunde an den Ofen.', 'Erinnere mich in einer Stunde an den Ofen'],
    ['Milch und Eier auf die Einkaufsliste.', 'Milch und Eier auf die Einkaufsliste'],
    ['„Was steht morgen an?“', 'Was steht morgen an?'],
    ['Drei Äpfel kaufen', 'Drei Äpfel kaufen'],
    ['Ich habe zwölf Euro fünfzig für Essen ausgegeben.', 'Ich habe 12,50 Euro für Essen ausgegeben'],
    ['Ich habe 12 Euro 5 ausgegeben', 'Ich habe 12,05 Euro ausgegeben'],
    ['Wie viel sind fünfzig Dollar in Euro?', 'Wie viel sind 50 Dollar in Euro?'],
    ['Erinnere mich morgen um neun Uhr dreißig an den Arzt.', 'Erinnere mich morgen um 9 Uhr 30 an den Arzt'],
    ['Erinnere mich um 21.15 Uhr an die Tabletten.', 'Erinnere mich um 21.15 Uhr an die Tabletten'],
    ['Erinnere mich um dreiviertel acht an den Bus.', 'Erinnere mich um dreiviertel 8 an den Bus'],
    ['Milch Komma Brot Komma Eier auf die Einkaufsliste.', 'Milch, Brot, Eier auf die Einkaufsliste'],
    ['Was ist 12 Komma 5 mal 2?', 'Was ist 12,5 mal 2?'],
    ['Ähm, erinnere mich, äh, morgen an den Müll.', 'erinnere mich, morgen an den Müll'],
    ['Danke. Danke. Danke. Danke.', 'Danke'],
    ['Erinnere mich morgen an X. Erinnere mich morgen an X.', 'Erinnere mich morgen an X'],
    ['ja ja ja ja ja ja ja', 'ja'],
    ['Wir sehen uns um 9.30 Uhr. Bis dann.', 'Wir sehen uns um 9.30 Uhr. Bis dann'],
    // What Whisper mishears, from test recordings
    ['Weg mich morgen um 6.30 Uhr.', 'Weck mich morgen um 6.30 Uhr'],
    ['Erinnere mich über morgen um Halbracht an das Meeting.', 'Erinnere mich übermorgen um halb 8 an das Meeting'],
    ['Erinnere mich morgen und neuen an den Zahnarzt.', 'Erinnere mich morgen um 9 an den Zahnarzt'],
    ['Erinnere mich morgen um 9 an den 10. Arzt.', 'Erinnere mich morgen um 9 an den Zahnarzt'],
    ['Schreit Milch, Brot und Eier auf die Einkaufsliste.', 'Schreib Milch, Brot und Eier auf die Einkaufsliste'],
    ['Mach das Rückgang, ich.', 'Mach das rückgängig'],
    ['Seid mir meine Erinnerungen.', 'Zeig mir meine Erinnerungen'],
    ['neue Aufgabe steuere Erklärung machen', 'neue Aufgabe Steuererklärung machen'],
    ['neue Aufgabe steuereklärung machen', 'neue Aufgabe Steuererklärung machen'],
    ['Der Innere mich in einer halben Stunde an den Ofen.', 'Erinnere mich in einer halben Stunde an den Ofen'],
    ['Weg nicht morgen um 6 Uhr 30', 'Weck mich morgen um 6 Uhr 30'],
    ['Mach das Rückjängig', 'Mach das rückgängig'],
    ['Mach das rückgängig nicht', 'Mach das rückgängig'],
    ['Mach das zurück, gängig', 'Mach das rückgängig'],
    ['Erinnere mich morgen um 9 an den 10 a.', 'Erinnere mich morgen um 9 an den Zahnarzt'],
    ['wann hat Anna geworzt Tag?', 'wann hat Anna Geburtstag?'],
    ['Schreib Eier auf die Einkaufslüsste.', 'Schreib Eier auf die Einkaufsliste'],
    ['Zeig mir meine Erinnerrungen', 'Zeig mir meine Erinnerungen'],
    ['Lösch die Erinnerung', 'Lösch die Erinnerung'],
    ['Die Uhr ist kaputt.', 'Die Uhr ist kaputt'],
    ['Die Wäsche ist trocken, Rückgang der Preise.', 'Die Wäsche ist trocken, Rückgang der Preise'],
    ['Untertitel der Amara.org-Community', ''],
    ['Vielen Dank fürs Zuschauen!', ''],
    [' ♪ ', ''],
    ['', ''],
  ];
  for (const [raw, clean] of cases) assert.equal(cleanTranscript(raw), clean, raw);
});

test('audio becomes one channel at 16 kHz', () => {
  const left = Float32Array.from({ length: 4800 }, () => 0.5);
  const right = Float32Array.from({ length: 4800 }, () => -0.1);
  const audio = toMono16k([left, right], 48_000);
  assert.equal(audio.length, 1600);
  assert.ok(Math.abs(audio[100] - 0.2) < 1e-6);
  assert.equal(toMono16k([], 48_000).length, 0);
});

test('without the optional packages there is no speech recognition', () => {
  assert.equal(createSpeech({ dataDir: 'x', root: join(import.meta.dirname, 'nowhere') }), null);
});

test('speech is found in the recording, silence, hum and tones are not speech', () => {
  const found = findSpeech(join32(silence(3), speechLike(2), silence(3)));
  assert.ok(found.length >= 1.5 * RATE && found.length < 3.5 * RATE, `only the speech with some room: ${found.length / RATE} s`);
  assert.ok(findSpeech(speechLike(2, 0.3, 0.03)), 'speech in a noisy room');
  assert.ok(findSpeech(join32(silence(1), speechLike(2, 0.002), silence(1))), 'very quiet speech');
  assert.equal(findSpeech(silence(4)), null);
  assert.equal(findSpeech(tone(3)), null);
  assert.equal(findSpeech(speechLike(3, 0, 0.1)), null, 'steady noise');
  assert.equal(findSpeech(join32(silence(1), speechLike(0.2), silence(1))), null, 'a click is no speech');
  assert.equal(findSpeech(new Float32Array(100)), null);
});

test('quiet recordings are made louder, normal ones stay', () => {
  const quiet = Float32Array.from([0.01, -0.02, 0.005]);
  assert.ok(Math.abs(Math.max(...louder(quiet).map(Math.abs)) - 0.9) < 1e-6);
  const normal = Float32Array.from([0.6, -0.2]);
  assert.equal(louder(normal), normal);
  assert.deepEqual([...louder(new Float32Array(3))], [0, 0, 0]);
});

test('model names: short ones for the known models, the rest as written', () => {
  assert.equal(modelId(undefined), 'onnx-community/whisper-base');
  assert.equal(modelId(' Small '), 'onnx-community/whisper-small');
  assert.equal(modelId('turbo'), 'onnx-community/whisper-large-v3-turbo');
  assert.equal(modelId('someone/whisper-german'), 'someone/whisper-german');
});

// A stand-in for the optional packages: decodes "OggS" + JSON into samples and "hears" their length.
const FAKE_PACKAGES = `
export const env = {};
export async function pipeline(task, model) {
  if (model.includes('missing')) throw new Error('model not found');
  return async (audio, settings) => ({ text: ' Gehört ' + (audio.length / 16000).toFixed(1) + ' s, ' + settings.language + '.' });
}
export class OggOpusDecoder {
  ready = Promise.resolve();
  async decodeFile(bytes) {
    const spec = JSON.parse(new TextDecoder().decode(bytes.slice(4)));
    if (spec.broken) throw new Error('not opus');
    const rate = 48000;
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const samples = Float32Array.from({ length: spec.seconds * rate }, (_, i) => {
      const t = i / rate;
      return spec.speech && t > 1 && t < spec.seconds - 1 ? random() * 0.3 * Math.sin(Math.PI * ((t * 4) % 1)) ** 2 : 0;
    });
    return { channelData: [samples], sampleRate: rate };
  }
  async reset() {}
}`;
function fakePackages(t) {
  const root = mkdtempSync(join(tmpdir(), 'speech-fake-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'node_modules', '@huggingface', 'transformers'), { recursive: true });
  writeFileSync(join(root, 'index.js'), FAKE_PACKAGES);
  return root;
}
const ogg = (spec) => Buffer.concat([Buffer.from('OggS'), Buffer.from(JSON.stringify(spec))]);

test('transcribe: only speech reaches Whisper, each problem has a kind', async (t) => {
  const root = fakePackages(t);
  const dataDir = mkdtempSync(join(tmpdir(), 'speech-data-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const logs = [];
  const transcribe = createSpeech({ dataDir, root, model: 'tiny', log: (line) => logs.push(line) });
  assert.equal(transcribe.isReady(), false);

  const heard = await transcribe(ogg({ seconds: 5, speech: true }));
  const seconds = Number(heard.match(/^ Gehört (\d+\.\d) s, german\.$/)?.[1]);
  assert.ok(seconds >= 3 && seconds < 4.5, `the silence around is cut: ${heard}`);
  assert.equal(transcribe.isReady(), true);
  assert.ok(logs.some((line) => line.includes('whisper-tiny') && line.includes('40 MB')));

  assert.equal(await transcribe(ogg({ seconds: 4 })), '', 'silence never reaches Whisper');
  await assert.rejects(transcribe(Buffer.from('ID3 mp3 data')), { kind: 'format' });
  await assert.rejects(transcribe(ogg({ broken: true })), { kind: 'format' });
  await assert.rejects(transcribe(ogg({ seconds: 130, speech: true })), { kind: 'long' });
  assert.match(await transcribe(ogg({ seconds: 3, speech: true })), /Gehört/, 'still works after errors');

  const missing = createSpeech({ dataDir, root, model: 'someone/missing' });
  await assert.rejects(missing(ogg({ seconds: 3, speech: true })), { kind: 'load' });
});

// Downloads the model once (about 80 MB): SPEECH_TEST=1 npm test
test('real voice message with Whisper', { skip: !(process.env.SPEECH_TEST && speechInstalled()) && 'SPEECH_TEST=1 and npm run sprache' }, async () => {
  // Outside the project, so the real data folder stays clean and the model is downloaded only once.
  const dataDir = join(tmpdir(), 'wapricetracker-speech-test');
  mkdirSync(dataDir, { recursive: true });
  const transcribe = createSpeech({ dataDir });
  const heard = cleanTranscript(await transcribe(readFileSync(join(import.meta.dirname, 'fixtures', 'erinnerung.ogg'))));
  assert.match(heard, /^Erinnere mich morgen um (?:9|neun)(?: Uhr)? an den Zahnarzt$/i);
});
