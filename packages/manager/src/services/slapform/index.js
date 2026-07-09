/**
 * Slapform service — the brand's contact form on Slapform (slapform.com):
 * keeps the form's settings in sync and sets the form-owner account to the
 * configured plan (Slapform's top tier by default) so the brand has full
 * access. Forms live in Slapform's own Firestore, so this service is for
 * the Slapform operator: it needs a service account for Slapform's Firebase
 * project.
 *
 * Auth: SLAPFORM_SERVICE_ACCOUNT in the brand .env — a path to the
 * service-account JSON (absolute, or relative to the brand root, e.g.
 * `.omega/secrets/slapform-service-account.json`). omega-manager read the
 * company-mode `.output/slapform/secrets/service-account.json` instead.
 *
 * The form id comes from config (slapform.formId) — forms are created in
 * the Slapform dashboard. Interactive runs offer the setup flow when it's
 * missing (open slapform.com, paste the form id back — comment-preserving
 * writeback into omega.json5, with a Disable option that sets
 * `slapform: false`); non-interactive and dry runs skip cleanly.
 */
const chalk = require('chalk').default;
const { createServiceRunner } = require('../../lib/service-runner.js');
const { FirestoreREST, loadServiceAccount } = require('../../lib/firestore-rest.js');
const { resolveConfigValue } = require('../../lib/config-flow.js');

const SLAPFORM_URL = 'https://slapform.com';

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const config = context.brandConfig.slapform;

    if (config === false || config?.enabled === false) {
      return { skip: true, reason: 'slapform.enabled = false' };
    }

    // The contact form lives on the brand's website
    if (!context.brandConfig.targets?.web) {
      return { skip: true, reason: 'no web target' };
    }

    let formId = config?.formId;
    if (!formId) {
      formId = await resolveConfigValue(context, {
        path: 'slapform.formId',
        label: 'Slapform contact form',
        instructions: [
          `1. Create an account at ${chalk.cyan(SLAPFORM_URL)} (if you haven't already)`,
          `2. Create a contact form for ${chalk.cyan(context.brandConfig.brand?.name || context.brandId)}`,
        ],
        entry: { url: SLAPFORM_URL, message: 'Slapform form ID:' },
        disablePath: 'slapform',
      });
    }
    if (!formId) {
      return { skip: true, reason: 'no slapform.formId configured (create a form at https://slapform.com, then set it in omega.json5 — or rerun interactively)' };
    }

    // Tests inject a fake client via context.slapformDb
    let db = context.slapformDb;
    if (!db) {
      const envPath = process.env.SLAPFORM_SERVICE_ACCOUNT;
      if (!envPath) {
        return { skip: true, reason: 'no SLAPFORM_SERVICE_ACCOUNT configured (path to Slapform\'s service-account JSON, set it in the brand .env)' };
      }
      db = new FirestoreREST(loadServiceAccount(envPath, context.brandRoot));
    }

    return { db, formId };
  },
});
