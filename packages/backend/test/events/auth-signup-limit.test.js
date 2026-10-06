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
const { loadConfig } = require('../../dist/vendor/config/index.js');
const { resolveSignupLimit, DEFAULT_MAX_SIGNUPS_PER_DAY } = require('../../dist/omega/events/auth/utils.js');
const beforeCreate = require('../../dist/omega/events/auth/before-create.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// A signup event driven straight through the REAL before-create, with ONE seam:
// what the usage counter does when the gate calls it. That is the whole subject
// — whether a failure that is not a rate limit is still SOLD as one.
class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HttpsError';
    this.code = code;
  }
}

function runBeforeCreate(consume) {
  const lines = [];
  const record = (...args) => lines.push(args.join(' '));

  const counter = {
    configure: () => counter,
    forKey: () => counter,
    consume: consume,
  };

  const omega = { config: {}, firebase: { functions: { auth: { HttpsError } } } };

  const ctx = {
    usage: counter,
    log: record,
    debug: record,
    warn: record,
    error: record,
    report: (e, options) => {
      const error = e instanceof Error ? e : new Error(e);
      error.code = (options || {}).code || 500;
      return error;
    },
  };

  return beforeCreate({
    ctx,
    omega,
    user: { uid: 'user-647', email: 'someone@example.com' },
    context: { ipAddress: '203.0.113.7' },
  });
}

// The framework-defaults layer the Omega instance resolves at boot
const TEMPLATES_DIR = path.join(__dirname, '../../templates');

module.exports = defineCases({
  description: 'resolveSignupLimit(): per-IP daily signup cap from config',
  type: 'group',

  tests: [
    {
      name: 'framework-default-is-the-shipped-template-value',
      auth: 'none',

      async run({ expect }) {
        const { config } = loadConfig(TEMPLATES_DIR, 'backend');

        expect(config.auth?.signup?.maxPerIpPerDay, 'templates/config/omega.json5 ships the default cap').toBe(2);
        expect(resolveSignupLimit(config), 'the shipped default resolves through the guard').toBe(2);
        expect(DEFAULT_MAX_SIGNUPS_PER_DAY, 'the in-code fallback matches the shipped default').toBe(2);
      },
    },

    {
      name: 'configured-value-wins',
      auth: 'none',

      async run({ expect }) {
        expect(resolveSignupLimit({ auth: { signup: { maxPerIpPerDay: 25 } } })).toBe(25);
        expect(resolveSignupLimit({ auth: { signup: { maxPerIpPerDay: 1 } } })).toBe(1);
      },
    },

    {
      name: 'unconfigured-and-invalid-values-keep-the-default',
      auth: 'none',

      async run({ expect }) {
        // Nothing configured: a config with no auth block at all
        expect(resolveSignupLimit({})).toBe(DEFAULT_MAX_SIGNUPS_PER_DAY);
        expect(resolveSignupLimit(undefined)).toBe(DEFAULT_MAX_SIGNUPS_PER_DAY);

        // Garbage is a validation error (@omega.js/config hard-fails it); the
        // guard keeps the default rather than running the IP check unprotected
        for (const value of [0, -1, 2.5, '25', null]) {
          expect(resolveSignupLimit({ auth: { signup: { maxPerIpPerDay: value } } }), `${value} falls back to the default`).toBe(DEFAULT_MAX_SIGNUPS_PER_DAY);
        }
      },
    },
    // The gate's catch used to swallow EVERYTHING consume() could throw. A
    // Firestore outage, a programmer error, a 500 of any kind came back to the
    // caller as "too many signups from this IP" — a diagnosis nobody could act
    // on, and one that quietly told a legitimate user to wait a day.
    {
      name: 'a failure that is not a rate limit is never sold as one',
      auth: 'none',

      async run({ expect, ctx }) {
        const boom = Object.assign(new Error('Firestore unavailable'), { code: 500 });

        const thrown = await runBeforeCreate(async () => { throw boom; }).catch((e) => e);

        expect(thrown, 'the original error propagates untouched').toBe(boom);
        expect(thrown.name, 'not converted into an auth HttpsError').toBe('Error');
      },
    },

    {
      name: 'a real 429 still blocks the signup as resource-exhausted',
      auth: 'none',

      async run({ expect }) {
        const refusal = Object.assign(new Error('You have used all 2 of your signups'), { code: 429 });

        const thrown = await runBeforeCreate(async () => { throw refusal; }).catch((e) => e);

        expect(thrown.name, 'a rate limit is the one thing this catch is for').toBe('HttpsError');
        expect(thrown.code).toBe('resource-exhausted');
      },
    },
  ],
});
