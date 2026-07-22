/**
 * Test: Security primitives (wave-2 B6/B10) — pure functions, called directly.
 *
 * - safeCompare: constant-time secret comparison (admin key, webhook keys)
 * - loadProcessor: processor-name confinement for dynamic require()
 * - loadTemplate: email-template-id confinement (colon-joined ids, nested + flat layouts)
 */
const path = require('path');
const safeCompare = require('../../src/manager/helpers/safe-compare.js');
const loadProcessor = require('../../src/manager/libraries/load-processor.js');
const { loadTemplate } = loadProcessor;

const PROCESSORS_DIR = path.join(__dirname, '../../src/manager/routes/payments/webhook/processors');
const TEMPLATES_DIR = path.join(__dirname, '../../src/manager/routes/general/email/templates');
const EMAILS_DIR = path.join(__dirname, '../../src/manager/functions/core/actions/api/general/emails');

module.exports = {
  description: 'safeCompare + loadProcessor security primitives',
  type: 'group',
  timeout: 10000,

  tests: [
    {
      name: 'safe-compare-equality',
      auth: 'none',

      async run({ assert }) {
        if (!((safeCompare('secret-key', 'secret-key')) === true)) { assert.fail('equal strings compare true'); }
        if (!((safeCompare('secret-key', 'secret-kez')) === false)) { assert.fail('different strings compare false'); }
        if (!((safeCompare('short', 'a-much-longer-value')) === false)) { assert.fail('length mismatch compares false'); }
      },
    },

    {
      name: 'safe-compare-rejects-empty-and-non-strings',
      auth: 'none',

      async run({ assert }) {
        // An unset OMEGA_ADMIN_KEY/OMEGA_WEBHOOK_KEY must never match anything
        if (!((safeCompare('', '')) === false)) { assert.fail('empty vs empty is false'); }
        if (!((safeCompare('x', '')) === false)) { assert.fail('value vs empty is false'); }
        if (!((safeCompare(undefined, 'x')) === false)) { assert.fail('undefined is false'); }
        if (!((safeCompare(null, null)) === false)) { assert.fail('null is false'); }
      },
    },

    {
      name: 'load-processor-allows-valid-names',
      auth: 'none',

      async run({ assert }) {
        const stripe = loadProcessor(PROCESSORS_DIR, 'stripe');
        if (!(typeof stripe === 'object' || typeof stripe === 'function')) { assert.fail('stripe processor loads'); }
      },
    },

    {
      name: 'load-processor-rejects-traversal-names',
      auth: 'none',

      async run({ assert }) {
        const invalid = ['../post', '..', 'stripe/../../post', 'Stripe', 'a.b', '', null, 'a b'];

        for (const name of invalid) {
          let threw = false;
          try {
            loadProcessor(PROCESSORS_DIR, name);
          } catch (e) {
            threw = true;
          }
          if (!threw) { assert.fail(`"${name}" must be rejected`); }
        }
      },
    },

    {
      name: 'load-template-allows-valid-ids',
      auth: 'none',

      async run({ assert }) {
        const nested = loadTemplate(TEMPLATES_DIR, 'general:download-app-link');
        if (!(typeof nested === 'function')) { assert.fail('nested template loads by colon-joined id'); }

        const flat = loadTemplate(EMAILS_DIR, 'general:download-app-link', { flat: true });
        if (!(typeof flat === 'function')) { assert.fail('flat email loads by literal colon-joined filename'); }
      },
    },

    {
      name: 'load-template-rejects-traversal-ids',
      auth: 'none',

      async run({ assert }) {
        const invalid = ['..:..:..:etc:passwd', '../general', '..', 'general:../..', 'General:Download', 'a.b', '', null, 'a b:c'];

        for (const id of invalid) {
          let threw = false;
          try {
            loadTemplate(TEMPLATES_DIR, id);
          } catch (e) {
            threw = true;
          }
          if (!threw) { assert.fail(`"${id}" must be rejected`); }
        }
      },
    },
  ],
};
