/**
 * Test: the staged `dist/.env` refuses a value Firebase would read back changed.
 *
 * Firebase's own .env reader (deploy runtime and emulator) decodes backslash
 * codes inside double quotes that dotenv leaves alone, so the stage refuses a
 * value holding one before it writes, naming the key and never the value.
 * Offline by construction: only the check runs.
 *
 * Run: npx omega test backend:cli/stage-env-firebase
 */
const assert = require('node:assert');

const { assertFirebaseEnvSafe } = require('../../dist/cli/utils/stage-functions.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const REFUSED = {
  WINDOWS_PATH: 'C:\\temp',
  BACKSLASH_QUOTE: 'a\\"b',
  TRAILING_BACKSLASH: 'first\\\nsecond',
};

const ACCEPTED = {
  QUOTE: 'a"b',
  APOSTROPHE: 'it\'s',
  HASH: 'x#y',
  MULTI_LINE: 'line one\nline two',
  FORWARD_PATH: 'C:/temp',
};

module.exports = defineCases({
  description: 'the staged dist/.env Firebase read-back check',
  type: 'group',

  tests: [
    ...Object.entries(REFUSED).map(([key, value]) => ({
      name: `refuses-${key.toLowerCase().replace(/_/g, '-')}-naming-the-key-only`,
      run() {
        assert.throws(
          () => assertFirebaseEnvSafe({ SAFE: 'plain', [key]: value }),
          (error) => error.message.includes(key)
            && !error.message.includes(value)
            && !error.message.includes('SAFE'),
        );
      },
    })),

    {
      name: 'accepts-values-firebase-reads-back-unchanged',
      run() {
        assert.doesNotThrow(() => assertFirebaseEnvSafe(ACCEPTED));
      },
    },
  ],
});
