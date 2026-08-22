// Tests for the wave-2 security fix-batch (cp259): env-secret escaping
// (MGR-5), webhook-URL redaction (MGR-1), and token-store file modes (MGR-8).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeEnvValue } = require('../src/lib/env-secret.js');
const { envLine } = require('../src/services/disperse/write/env.js');
const { redactWebhookUrl, buildWebhookUrl } = require('../src/services/payment/lib/payment-utils.js');
const { GoogleOAuth2Client } = require('../src/lib/google-auth.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-secfix-'));
}

test('envLine escapes backslashes, quotes, and newlines', () => {
  assert.equal(envLine('K', 'plain'), 'K="plain"');
  assert.equal(envLine('K', 'a"b'), 'K="a\\"b"');
  assert.equal(envLine('K', 'a\\b'), 'K="a\\\\b"');
  assert.equal(envLine('K', 'a\nb'), 'K="a\\nb"');
});

test('writeEnvValue appends with envLine escaping', () => {
  const root = tmpDir();
  writeEnvValue(root, 'OMEGA_TEST_SECRET', 'pa"ss\nword');

  const content = fs.readFileSync(path.join(root, '.env'), 'utf8');
  assert.ok(content.includes('OMEGA_TEST_SECRET="pa\\"ss\\nword"'), `unexpected: ${content}`);
});

test('writeEnvValue replace path does not expand $-patterns in the secret', () => {
  const root = tmpDir();
  writeEnvValue(root, 'OMEGA_TEST_SECRET', 'first-value');
  // $& and $1 are String.replace expansion patterns — a replacer function
  // must deliver them verbatim
  writeEnvValue(root, 'OMEGA_TEST_SECRET', 'weird$&pass$1word');

  const content = fs.readFileSync(path.join(root, '.env'), 'utf8');
  assert.ok(content.includes('OMEGA_TEST_SECRET="weird$&pass$1word"'), `unexpected: ${content}`);
  assert.ok(!content.includes('first-value'), 'old value should be replaced');
});

test('redactWebhookUrl masks the key param and keeps the rest', () => {
  const brandConfig = { brand: { url: 'https://example.com' } };
  process.env.OMEGA_WEBHOOK_KEY = 'super-secret-key';
  const url = buildWebhookUrl(brandConfig, 'stripe');
  const redacted = redactWebhookUrl(url);

  assert.ok(url.includes('key=super-secret-key'));
  assert.ok(!redacted.includes('super-secret-key'), redacted);
  assert.ok(redacted.includes('key=***'), redacted);
  assert.ok(redacted.includes('provider=stripe'), redacted);
});

test('saveTokens writes the token store 0600 in a 0700 dir', { skip: process.platform === 'win32' }, () => {
  const root = tmpDir();
  const storePath = path.join(root, 'auth', 'google-tokens.json');
  const client = new GoogleOAuth2Client({ tokenStorePath: storePath, scopes: ['a'] });

  client.saveTokens({ refresh_token: 'fake', access_token: 'fake' });

  const fileMode = fs.statSync(storePath).mode & 0o777;
  const dirMode = fs.statSync(path.dirname(storePath)).mode & 0o777;
  assert.equal(fileMode, 0o600);
  assert.equal(dirMode, 0o700);

  // Pre-existing loose file AND directory both get tightened on the next save
  fs.chmodSync(storePath, 0o644);
  fs.chmodSync(path.dirname(storePath), 0o755);
  client.saveTokens({ access_token: 'fake2' });
  assert.equal(fs.statSync(storePath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(storePath)).mode & 0o777, 0o700);
});
