/**
 * The .env serializer: envLine writes one `KEY="value"` line and serializeEnv a
 * whole file, and dotenv, the reader every OMEGA loader uses, must read each
 * value back exactly as given. A value it cannot throws, naming the key only.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

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

module.exports = defineCases({
  type: 'group',
  description: 'env-line',
  tests: [
    {
      name: 'envLine: every value reads back through dotenv exactly as written',
      run: (ctx) => {
        for (const [key, value] of Object.entries(ROUND_TRIP_VALUES)) {
          const line = envLine(key, value);
          ctx.expect(line.split('\n').length, `${key} stays on one line`).toBe(1);
          ctx.expect(require('dotenv').parse(line)[key], `${key} reads back unchanged`).toBe(value);
        }
      },
    },

    {
      name: 'envLine: quotes and backslashes are written raw, a newline as the two characters \\n',
      run: (ctx) => {
        ctx.expect(envLine('K', 'say "hi"')).toBe('K="say "hi""');
        ctx.expect(envLine('K', 'C:\\keys\\')).toBe('K="C:\\keys\\"');
        ctx.expect(envLine('K', 'line1\nline2')).toBe('K="line1\\nline2"');
        ctx.expect(envLine('K', '')).toBe('K=""');
      },
    },

    {
      name: 'envLine: a value dotenv would read back changed throws, naming the key and never the value',
      run: (ctx) => {
        // dotenv expands a literal backslash-n or backslash-r, and a quote followed
        // by # ends a double-quoted value, so none of these can round-trip.
        for (const value of ['a\\nb-secret', 'a\\rb-secret', 'x "y" #secret']) {
          ctx.expect(() => envLine('OMEGA_TEST_KEY', value)).toThrow((error) => {
            ctx.expect(error.message).toMatch(/OMEGA_TEST_KEY/);
            ctx.expect(!error.message.includes('secret'), 'the value never reaches the message').toBeTruthy();
            return true;
          });
        }
      },
    },

    {
      name: 'serializeEnv: the whole file reads back through dotenv exactly as given',
      run: (ctx) => {
        const content = serializeEnv(ROUND_TRIP_VALUES);

        ctx.expect(content.split('\n').length, 'one line per key').toBe(Object.keys(ROUND_TRIP_VALUES).length + 1);
        ctx.expect(require('dotenv').parse(content)).toEqual(ROUND_TRIP_VALUES);
      },
    },

    {
      name: 'serializeEnv: a trailing backslash that would swallow the next line throws',
      run: (ctx) => {
        // The escaped closing quote lets dotenv's match run on to the next line's
        // opening quote, and a value starting with # then reads as a comment.
        ctx.expect(() => serializeEnv({ FIRST: 'x\\', SECOND: ' #z' })).toThrow(/FIRST/);
      },
    },

    // The backend deploy workflow writes its `.env` through this serializer, so a
    // value holding a quote, a backslash or a newline must stay on its own line
    // and never declare a key of its own.
    {
      name: 'serializeEnv: a hostile value stays on its own line, and never bleeds into the next key',
      run: (ctx) => {
        const hostile = 'a"b\\c\nOMEGA_ADMIN_KEY="stolen"';
        const content = serializeEnv({ FIRST: hostile, SECOND: 'intact' });

        ctx.expect(content.split('\n').filter(Boolean).length, 'one line per key, whatever the value holds').toBe(2);

        const parsed = require('dotenv').parse(content);
        ctx.expect(Object.keys(parsed), 'the file declares exactly the keys it was given').toEqual(['FIRST', 'SECOND']);
        ctx.expect(parsed.SECOND, 'the neighbouring key survives the quote').toBe('intact');
        ctx.expect(parsed.OMEGA_ADMIN_KEY, 'a value can never inject a key of its own').toBe(undefined);
        ctx.expect(parsed.FIRST, 'the quote, the backslash and the newline all read back as given').toBe(hostile);
      },
    },
  ],
});
