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
