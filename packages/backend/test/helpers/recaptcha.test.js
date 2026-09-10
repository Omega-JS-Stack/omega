/**
 * Test: recaptcha.verify() owns the whole subscribe-verification decision
 * (cp265) — no RECAPTCHA_SECRET_KEY configured means PASS, even for a
 * missing/empty token. Unkeyed brands are a sanctioned population (cp257:
 * keys are optional and per-brand); the marketing/contact route no longer
 * pre-rejects empty tokens, so this leniency is what keeps their public
 * newsletter forms working.
 *
 * Also covers the rejection trail (#557): a failed verify prints Google's
 * verdict once, so a 403 in Cloud Logging names its own reason.
 *
 * Run: npx omega test backend:helpers/recaptcha
 */
const path = require('path');
const { verify } = require('../../dist/manager/libraries/recaptcha.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const MODULE_PATH = require.resolve('../../dist/manager/libraries/recaptcha.js');

/**
 * Run verify() against a STUBBED siteverify, with console.warn recorded.
 *
 * The library requires `wonderful-fetch` at module load, so the cache entry is
 * swapped and the library re-required — the real verify() runs, only the wire
 * is fake. Both the fetch entry and the module are restored, so every other
 * test in the process keeps the real transport.
 *
 * @param {object} options
 * @param {object} options.answer - What siteverify answers.
 * @param {string} [options.token] - The token handed to verify().
 * @returns {Promise<{result: boolean, warnings: string[], calls: object[]}>}
 */
async function verifyOnStubbedSiteverify({ answer, token }) {
  const fetchPath = require.resolve('wonderful-fetch', { paths: [path.dirname(MODULE_PATH)] });
  const realFetch = require.cache[fetchPath];
  const realWarn = console.warn;
  const savedSecret = process.env.RECAPTCHA_SECRET_KEY;
  const warnings = [];
  const calls = [];

  require.cache[fetchPath] = {
    id: fetchPath,
    filename: fetchPath,
    loaded: true,
    exports: (url, options) => {
      calls.push({ url: url, options: options });
      return Promise.resolve(answer);
    },
  };
  delete require.cache[MODULE_PATH];

  process.env.RECAPTCHA_SECRET_KEY = 'test-secret-never-sent';
  console.warn = (...args) => warnings.push(args.map((arg) => String(arg)).join(' '));

  try {
    const result = await require(MODULE_PATH).verify(token || 'test-token-never-logged');

    return { result: result, warnings: warnings, calls: calls };
  } finally {
    console.warn = realWarn;

    if (typeof savedSecret === 'undefined') {
      delete process.env.RECAPTCHA_SECRET_KEY;
    } else {
      process.env.RECAPTCHA_SECRET_KEY = savedSecret;
    }

    if (realFetch) {
      require.cache[fetchPath] = realFetch;
    } else {
      delete require.cache[fetchPath];
    }
    delete require.cache[MODULE_PATH];
    require(MODULE_PATH);
  }
}

module.exports = defineCases({
  description: 'recaptcha.verify() no-secret leniency + the rejection trail',
  type: 'group',
  tests: [
    {
      name: 'no-secret-configured-passes-any-token-shape',
      run: async ({ assert }) => {
        const original = process.env.RECAPTCHA_SECRET_KEY;
        delete process.env.RECAPTCHA_SECRET_KEY;

        try {
          assert.equal(await verify(''), true, 'empty token passes without a secret');
          assert.equal(await verify(undefined), true, 'missing token passes without a secret');
          assert.equal(await verify('anything'), true, 'any token passes without a secret');
        } finally {
          if (original !== undefined) process.env.RECAPTCHA_SECRET_KEY = original;
        }
      },
    },
    {
      name: 'secret-configured-rejects-a-missing-token-before-any-network-call',
      run: async ({ assert }) => {
        const original = process.env.RECAPTCHA_SECRET_KEY;
        process.env.RECAPTCHA_SECRET_KEY = 'test-secret-never-sent';

        try {
          assert.equal(await verify(''), false, 'empty token fails closed with a secret');
          assert.equal(await verify(undefined), false, 'missing token fails closed with a secret');
        } finally {
          if (original === undefined) {
            delete process.env.RECAPTCHA_SECRET_KEY;
          } else {
            process.env.RECAPTCHA_SECRET_KEY = original;
          }
        }
      },
    },
    {
      name: 'low-score-rejection-logs-googles-verdict-once',
      run: async ({ assert }) => {
        // The live 403 that opened #557: a real key, a real domain, an
        // automated browser — success: true, score: 0.2, and no reason in the
        // logs. The score IS the diagnosis, so the line must carry it.
        const { result, warnings } = await verifyOnStubbedSiteverify({
          answer: { success: true, score: 0.2, action: 'contact', hostname: 'omegajs.dev' },
          token: 'token-that-must-never-be-logged',
        });

        assert.equal(result, false, 'a score under the minimum still fails closed');
        assert.equal(warnings.length, 1, 'a rejection prints exactly ONE warn line');

        const line = warnings[0];

        assert.ok(line.includes('[@omega.js/backend:recaptcha]'), `the line carries the identity tag: ${line}`);
        assert.ok(line.includes('score=0.2'), `the line carries the score: ${line}`);
        assert.ok(line.includes('action=contact'), `the line carries the action: ${line}`);
        assert.ok(line.includes('hostname=omegajs.dev'), `the line carries the hostname: ${line}`);
        assert.ok(!line.includes('token-that-must-never-be-logged'), `the line never carries the token: ${line}`);
        assert.ok(!line.includes('test-secret-never-sent'), `the line never carries the secret: ${line}`);
      },
    },
    {
      name: 'error-codes-rejection-logs-the-codes',
      run: async ({ assert }) => {
        const { result, warnings } = await verifyOnStubbedSiteverify({
          answer: { success: false, 'error-codes': ['invalid-input-secret', 'timeout-or-duplicate'] },
        });

        assert.equal(result, false, 'success: false fails closed');
        assert.equal(warnings.length, 1, 'a rejection prints exactly ONE warn line');
        assert.ok(
          warnings[0].includes('error-codes=invalid-input-secret,timeout-or-duplicate'),
          `the line names every code Google returned: ${warnings[0]}`
        );
      },
    },
    {
      name: 'a-passing-verify-stays-silent',
      run: async ({ assert }) => {
        const { result, warnings } = await verifyOnStubbedSiteverify({
          answer: { success: true, score: 0.9, action: 'contact', hostname: 'omegajs.dev' },
        });

        assert.equal(result, true, 'a good token passes');
        assert.equal(warnings.length, 0, 'a pass prints nothing');
      },
    },
  ],
});
