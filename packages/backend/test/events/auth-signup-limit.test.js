/**
 * Test: events/auth resolveSignupLimit(), the per-IP daily signup cap (#133)
 *
 * Run: npx omega test backend:events/auth-signup-limit
 *
 * before-create.js rate-limits signups per client IP. The cap used to be a
 * hardcoded 2, which shared egress (NAT/CGNAT/VPN) crosses with legitimate
 * users. It now comes from config: targets.backend.auth.signup.maxPerIpPerDay,
 * overlaid at the top level by the config loader like every other target key.
 *
 * Pure function (zero I/O), called directly per the test-framework contract.
 */
const path = require('path');
const { loadConfig } = require('@omega.js/config');
const { resolveSignupLimit, DEFAULT_MAX_SIGNUPS_PER_DAY } = require('../../src/manager/events/auth/utils.js');

// The framework-defaults layer the Manager resolves at boot
const TEMPLATES_DIR = path.join(__dirname, '../../templates');

module.exports = {
  description: 'resolveSignupLimit(): per-IP daily signup cap from config',
  type: 'group',

  tests: [
    {
      name: 'framework-default-is-the-shipped-template-value',
      auth: 'none',

      async run({ assert }) {
        const { config } = loadConfig(TEMPLATES_DIR, 'backend');

        assert.equal(config.auth?.signup?.maxPerIpPerDay, 2, 'templates/config/omega.json5 ships the default cap');
        assert.equal(resolveSignupLimit(config), 2, 'the shipped default resolves through the guard');
        assert.equal(DEFAULT_MAX_SIGNUPS_PER_DAY, 2, 'the in-code fallback matches the shipped default');
      },
    },

    {
      name: 'configured-value-wins',
      auth: 'none',

      async run({ assert }) {
        assert.equal(resolveSignupLimit({ auth: { signup: { maxPerIpPerDay: 25 } } }), 25);
        assert.equal(resolveSignupLimit({ auth: { signup: { maxPerIpPerDay: 1 } } }), 1);
      },
    },

    {
      name: 'unconfigured-and-invalid-values-keep-the-default',
      auth: 'none',

      async run({ assert }) {
        // Nothing configured: a config with no auth block at all
        assert.equal(resolveSignupLimit({}), DEFAULT_MAX_SIGNUPS_PER_DAY);
        assert.equal(resolveSignupLimit(undefined), DEFAULT_MAX_SIGNUPS_PER_DAY);

        // Garbage is a validation error (@omega.js/config hard-fails it); the
        // guard keeps the default rather than running the IP check unprotected
        for (const value of [0, -1, 2.5, '25', null]) {
          assert.equal(resolveSignupLimit({ auth: { signup: { maxPerIpPerDay: value } } }), DEFAULT_MAX_SIGNUPS_PER_DAY, `${value} falls back to the default`);
        }
      },
    },
  ],
};
