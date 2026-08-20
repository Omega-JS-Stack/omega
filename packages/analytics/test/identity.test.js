/**
 * Identity helper tests — the normalization each platform's match spec demands,
 * and the one digest both surfaces compute.
 *
 * Every expected hex below is a FIXED vector (computed independently of this
 * package), so a normalizer that quietly changes what it feeds the hash fails
 * here instead of silently matching nobody on a live pixel.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const identity = require('../src/identity.js');

// sha256('user@example.com')
const EMAIL_HASH = 'b4c9a289323b21a01c3e940f150eb9b8c542587f1abfd8f0e1cc1ffc5e475514';
// sha256('14155550142') — Meta's bare digits
const META_PHONE_HASH = '61c16289716534ac3a5992f613d7a9fefa5e9c12b8fd27f187387da9efeafd8c';
// sha256('+14155550142') — TikTok's E.164
const TIKTOK_PHONE_HASH = 'abbf04d6f629b136344993dfb197f1fd9296f712eaf103ebc22b1cc29fb0f135';

test('email normalizes to trimmed + lowercase, whatever the visitor typed', () => {
  for (const written of ['user@example.com', 'USER@Example.COM', '  User@Example.com  ', '\tuser@example.com\n']) {
    assert.strictEqual(identity.normalizeEmail(written), 'user@example.com', `"${written}" normalizes`);
  }

  assert.strictEqual(identity.normalizeEmail(), '', 'no email normalizes to nothing');
  assert.strictEqual(identity.normalizeEmail(null), '', 'a null email normalizes to nothing');
});

test('Meta takes bare digits and TikTok takes E.164 — the same number, two match keys', () => {
  for (const written of ['+14155550142', '+1 (415) 555-0142', '+1 415-555-0142', ' +1.415.555.0142 ']) {
    assert.strictEqual(identity.metaPhone(written), '14155550142', `Meta strips everything but the digits of "${written}"`);
    assert.strictEqual(identity.tiktokPhone(written), '+14155550142', `TikTok keeps the plus on "${written}"`);
  }
});

test('an absent phone normalizes to nothing on both — never a lone plus', () => {
  for (const absent of [undefined, null, '', '   ', '()- ']) {
    assert.strictEqual(identity.metaPhone(absent), '', `Meta: ${JSON.stringify(absent)}`);
    assert.strictEqual(identity.tiktokPhone(absent), '', `TikTok: ${JSON.stringify(absent)} never becomes "+"`);
  }
});

test('sha256 is the platforms\' hex digest, and nothing hashes to a shared junk key', async () => {
  assert.strictEqual(await identity.sha256(identity.normalizeEmail('  USER@Example.com ')), EMAIL_HASH);
  assert.strictEqual(await identity.sha256(identity.metaPhone('+1 (415) 555-0142')), META_PHONE_HASH);
  assert.strictEqual(await identity.sha256(identity.tiktokPhone('+1 (415) 555-0142')), TIKTOK_PHONE_HASH);

  assert.notStrictEqual(META_PHONE_HASH, TIKTOK_PHONE_HASH, 'the two specs are genuinely different digests');

  for (const nothing of [undefined, null, '']) {
    assert.strictEqual(await identity.sha256(nothing), null, 'an absent value hashes to null, not to the digest of ""');
  }
});

test('the node fallback digests identically when a runtime has no crypto.subtle', async (t) => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

  // A Cloud Function, an Electron main process, a plain-http origin: no
  // `crypto.subtle` at all — an expected external condition, not our bug, so
  // node's own digest must produce the SAME match key.
  delete globalThis.crypto;
  t.after(() => Object.defineProperty(globalThis, 'crypto', real));

  assert.strictEqual(globalThis.crypto?.subtle, undefined, 'the page digest is genuinely gone');
  assert.strictEqual(await identity.sha256('user@example.com'), EMAIL_HASH);
});

test('a BROWSER with no crypto.subtle hashes to null — never a rejection', async () => {
  const realCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const realProcess = globalThis.process;

  // The bundled-page condition: no secure context AND no node underneath. The
  // node lane must be chosen by the RUNTIME, never by `typeof require`, which a
  // bundler rewrites to a shim of its own that is a function and throws when
  // called — a rejection where the contract promises a quiet null.
  delete globalThis.crypto;
  globalThis.process = undefined;

  // Restored in the SAME synchronous block: sha256 runs to its return before
  // this line, so nothing else ever observes a process-less global.
  const digest = identity.sha256('user@example.com');

  globalThis.process = realProcess;
  Object.defineProperty(globalThis, 'crypto', realCrypto);

  assert.strictEqual(await digest, null, 'no digest anywhere identifies nobody, quietly');
});

test('the node specifier is never a literal — a browser bundle cannot resolve it', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'identity.js'), 'utf8');

  // esbuild builds the web bundle for the browser and fails the WHOLE build on a
  // builtin it cannot resolve, so the specifier stays behind a variable.
  assert.match(source, /require\(NODE_CRYPTO\)/, 'the fallback reads its specifier from a variable');
  assert.doesNotMatch(source, /require\(\s*['"](node:)?crypto['"]\s*\)/, 'and never as a literal');
});
