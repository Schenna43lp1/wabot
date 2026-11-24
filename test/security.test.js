import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../src/config.js';
import { fetchPage, publicLookup, validateUrl } from '../src/fetch-page.js';

const blocked = [
  'http://127.0.0.1', 'http://2130706433', 'http://0x7f.1', 'http://10.0.0.1', 'http://192.168.1.1',
  'http://169.254.169.254', 'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://0.0.0.0',
  'http://example.com:8080', 'http://a:b@example.com', 'file:///C:/Windows/win.ini',
];
for (const url of blocked) {
  test(`blocks ${url}`, () => assert.throws(() => validateUrl(url)));
}

test('blocks names resolving to local addresses', async () => {
  const error = await new Promise((done) => publicLookup('localhost', {}, done));
  assert.match(error.message, /gesperrt/);
  await assert.rejects(fetchPage('http://localhost/'), /gesperrt/);
});

test('phone numbers need a country code', () => {
  assert.throws(() => readConfig({ ALLOWED_NUMBERS: '0170 1234567' }));
  assert.ok(readConfig({ ALLOWED_NUMBERS: '+49 170 1234567' }).allowed.has('491701234567'));
});

test('a resent message only goes to the chat that got it', async () => {
  const { sameChat } = await import('../src/whatsapp.js');
  const socket = {
    user: { id: '491700000000:7@s.whatsapp.net', lid: '111:7@lid' },
    signalRepository: { lidMapping: { getPNForLID: async (lid) => (lid === '333@lid' ? '491701234567:0@s.whatsapp.net' : null) } },
  };
  assert.ok(await sameChat(socket, '491701234567@s.whatsapp.net', '491701234567:3@s.whatsapp.net'), 'other device');
  assert.ok(await sameChat(socket, '491701234567@s.whatsapp.net', '333@lid'), 'LID');
  assert.ok(await sameChat(socket, '491700000000@s.whatsapp.net', '111@lid'), 'self-chat');
  assert.ok(!(await sameChat(socket, '491701234567@s.whatsapp.net', '499999999999@s.whatsapp.net')), 'stranger');
  assert.ok(!(await sameChat(socket, '491701234567@s.whatsapp.net', '444@lid')), 'unknown LID');
  assert.ok(!(await sameChat(socket, null, '491701234567@s.whatsapp.net')), 'old row without chat');
});

test('shop titles lose control characters', async () => {
  const { extractProduct } = await import('../src/extract.js');
  const html = `<html><head><meta property="og:title" content="Tisch&#x1b;]52;c;ZWNobyBoaQ==&#x07;&#x202e;neu">
    <meta property="product:price:amount" content="19.99"><meta property="product:price:currency" content="EUR&#x1b;[2J"></head><body><h1>x</h1></body></html>`;
  const found = extractProduct(html, 'https://shop.de/p');
  assert.doesNotMatch(found.title, /[\u0000-\u001f\u007f-\u009f‮]/);
  assert.equal(found.currency, 'EUR');
});

test('a voice message is too long by its header, before decoding', async () => {
  const { oggSeconds } = await import('../src/speech.js');
  const page = Buffer.alloc(27);
  page.write('OggS');
  page.writeBigUInt64LE(BigInt(48_000 * 600), 6);
  assert.equal(oggSeconds(page), 600);
  assert.equal(oggSeconds(Buffer.from('nothing')), 0);
});
