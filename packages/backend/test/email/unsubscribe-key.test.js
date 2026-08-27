/**
 * The unsubscribe signing key guard (#569) — a brand deployed without
 * UNSUBSCRIBE_HMAC_KEY used to crash inside node's crypto with
 * `The "key" argument must be of type string ... Received undefined`, and only
 * ever at a real customer's first order email. The key is the manager's to
 * mint; when it is absent anyway, the failure has to NAME it.
 *
 * Since #581 there is ONE reader of the key — libraries/env.js, the reader
 * every framework env read goes through — so the named error is its
 * MissingEnvKeyError, and the boot guard refuses long before an email does.
 *
 * Plain-node unit test (no emulator, no network).
 */
const assert = require('node:assert');
const crypto = require('crypto');

const { buildUnsubscribeUrl } = require('../../src/manager/libraries/email/prepare.js');

// The runner sets a key for the whole run, so every case here forces its own
// and puts the run's value back — a leaked delete would break every later
// email test in the process.
function withKey(value, fn) {
  const saved = process.env.UNSUBSCRIBE_HMAC_KEY;
  if (value === undefined) {
    delete process.env.UNSUBSCRIBE_HMAC_KEY;
  } else {
    process.env.UNSUBSCRIBE_HMAC_KEY = value;
  }

  try {
    return fn();
  } finally {
    if (saved === undefined) {
      delete process.env.UNSUBSCRIBE_HMAC_KEY;
    } else {
      process.env.UNSUBSCRIBE_HMAC_KEY = saved;
    }
  }
}

const LINK = {
  email: 'Customer@Example.com',
  groupId: 123,
  template: 'order',
  websiteUrl: 'https://brand.dev',
};

module.exports = {
  description: 'Email unsubscribe signing key guard (UNSUBSCRIBE_HMAC_KEY)',
  type: 'group',
  tests: [
    {
      name: 'an unset UNSUBSCRIBE_HMAC_KEY throws a named error that says the key',

      run() {
        withKey(undefined, () => {
          assert.throws(() => buildUnsubscribeUrl(LINK), (error) => {
            assert.strictEqual(error.name, 'MissingEnvKeyError');
            assert.match(error.message, /UNSUBSCRIBE_HMAC_KEY/);
            // Not node's crypto TypeError — the point of the guard
            assert.strictEqual(error instanceof TypeError, false);
            return true;
          });
        });
      },
    },

    {
      name: 'an empty UNSUBSCRIBE_HMAC_KEY is just as missing',

      run() {
        withKey('', () => {
          assert.throws(() => buildUnsubscribeUrl(LINK), /UNSUBSCRIBE_HMAC_KEY/);
        });
      },
    },

    {
      name: 'with the key set, the link carries a lowercase-email signature',

      run() {
        const url = withKey('unit-test-key', () => buildUnsubscribeUrl(LINK));

        const expected = crypto.createHmac('sha256', 'unit-test-key').update('customer@example.com').digest('hex');
        assert.ok(url.startsWith('https://brand.dev/portal/email-preferences?'));
        assert.ok(url.endsWith(`&sig=${expected}`));
      },
    },
  ],
};
