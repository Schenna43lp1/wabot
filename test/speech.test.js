import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cleanTranscript, createSpeech, numberWord, speechInstalled, toMono16k } from '../src/speech.js';

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

// Downloads the model once (about 80 MB): SPEECH_TEST=1 npm test
test('real voice message with Whisper', { skip: !(process.env.SPEECH_TEST && speechInstalled()) && 'SPEECH_TEST=1 and npm run sprache' }, async () => {
  // Outside the project, so the real data folder stays clean and the model is downloaded only once.
  const dataDir = join(tmpdir(), 'wapricetracker-speech-test');
  mkdirSync(dataDir, { recursive: true });
  const transcribe = createSpeech({ dataDir });
  const heard = cleanTranscript(await transcribe(readFileSync(join(import.meta.dirname, 'fixtures', 'erinnerung.ogg'))));
  assert.match(heard, /^Erinnere mich morgen um (?:9|neun)(?: Uhr)? an den Zahnarzt$/i);
});
