// The optional packages for voice messages. src/speech.js loads this file only
// after "npm run sprache" installed them here, so the bot itself stays small.
export { env, pipeline } from '@huggingface/transformers';
export { OggOpusDecoder } from 'ogg-opus-decoder';
