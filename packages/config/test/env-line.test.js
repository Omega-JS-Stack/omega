/**
 * The .env serializer: envLine writes one `KEY="value"` line and serializeEnv a
 * whole file, and dotenv, the reader every OMEGA loader uses, must read each
 * value back exactly as given. A value it cannot throws, naming the key only.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { envLine, serializeEnv } = require('../src/index.js');

// Every value the writer takes, as dotenv must read it back.
const ROUND_TRIP_VALUES = {
  PLAIN: 'value',
  QUOTED: 'say "hi"',
  SLASHED: 'C:\\keys\\file',
  SINGLE: "it's",
  HASHED: 'a#b #c',
  MULTILINE: 'line1\nline2',
  CARRIAGE: 'line1\r\nline2',
  TRAILING: 'ends\\',
  EMPTY: '',
};

test('envLine: every value reads back through dotenv exactly as written', () => {
  for (const [key, value] of Object.entries(ROUND_TRIP_VALUES)) {
    const line = envLine(key, value);
    assert.strictEqual(line.split('\n').length, 1, `${key} stays on one line`);
    assert.strictEqual(require('dotenv').parse(line)[key], value, `${key} reads back unchanged`);
  }
});

test('envLine: quotes and backslashes are written raw, a newline as the two characters \\n', () => {
  assert.strictEqual(envLine('K', 'say "hi"'), 'K="say "hi""');
  assert.strictEqual(envLine('K', 'C:\\keys\\'), 'K="C:\\keys\\"');
  assert.strictEqual(envLine('K', 'line1\nline2'), 'K="line1\\nline2"');
  assert.strictEqual(envLine('K', ''), 'K=""');
});

test('envLine: a value dotenv would read back changed throws, naming the key and never the value', () => {
  // dotenv expands a literal backslash-n or backslash-r, and a quote followed
  // by # ends a double-quoted value, so none of these can round-trip.
  for (const value of ['a\\nb-secret', 'a\\rb-secret', 'x "y" #secret']) {
    assert.throws(() => envLine('OMEGA_TEST_KEY', value), (error) => {
      assert.match(error.message, /OMEGA_TEST_KEY/);
      assert.ok(!error.message.includes('secret'), 'the value never reaches the message');
      return true;
    });
  }
});

test('serializeEnv: the whole file reads back through dotenv exactly as given', () => {
  const content = serializeEnv(ROUND_TRIP_VALUES);

  assert.strictEqual(content.split('\n').length, Object.keys(ROUND_TRIP_VALUES).length + 1, 'one line per key');
  assert.deepStrictEqual(require('dotenv').parse(content), ROUND_TRIP_VALUES);
});

test('serializeEnv: a trailing backslash that would swallow the next line throws', () => {
  // The escaped closing quote lets dotenv's match run on to the next line's
  // opening quote, and a value starting with # then reads as a comment.
  assert.throws(() => serializeEnv({ FIRST: 'x\\', SECOND: ' #z' }), /FIRST/);
});

// The backend deploy workflow writes its `.env` through this serializer, so a
// value holding a quote, a backslash or a newline must stay on its own line
// and never declare a key of its own.
test('serializeEnv: a hostile value stays on its own line, and never bleeds into the next key', () => {
  const hostile = 'a"b\\c\nOMEGA_ADMIN_KEY="stolen"';
  const content = serializeEnv({ FIRST: hostile, SECOND: 'intact' });

  assert.strictEqual(content.split('\n').filter(Boolean).length, 2, 'one line per key, whatever the value holds');

  const parsed = require('dotenv').parse(content);
  assert.deepStrictEqual(Object.keys(parsed), ['FIRST', 'SECOND'], 'the file declares exactly the keys it was given');
  assert.strictEqual(parsed.SECOND, 'intact', 'the neighbouring key survives the quote');
  assert.strictEqual(parsed.OMEGA_ADMIN_KEY, undefined, 'a value can never inject a key of its own');
  assert.strictEqual(parsed.FIRST, hostile, 'the quote, the backslash and the newline all read back as given');
});
