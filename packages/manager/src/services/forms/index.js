/**
 * Forms service (`forms.providers.slapform`) — the brand's contact form on
 * Slapform (slapform.com): keeps the form's settings in sync and sets the
 * form-owner account to the configured plan (Slapform's top tier by default)
 * so the brand has full access. Forms live in Slapform's own Firestore, so this service is for
 * the Slapform operator: it needs a service account for Slapform's Firebase
 * project.
 *
 * Auth tiers (2b, Ian 2026-07-13):
 *   1. Operator SA — SLAPFORM_SERVICE_ACCOUNT in the brand .env (path to
 *      the service-account JSON, absolute or brand-root-relative). Full
 *      create + manage: a missing formId with `forms.providers.slapform.templateFormId`
 *      configured (the company layer's shape donor) MINTS the brand's own
 *      form — product user (email = brand contact email, password via the
 *      account service's owner channels) + doc shape-templated from the
 *      donor — and writes the new id back into omega.json5. The ensures
 *      then converge name/settings/plan in the same run.
 *   2. User API key — SLAPFORM_API_KEY (the product accepts
 *      user.api.privateKey): recognized, management via the product's
 *      public API lands when those routes are verified.
 *   3. Dashboard — interactive runs offer the setup flow (open
 *      slapform.com, paste the form id back — comment-preserving
 *      writeback, with a Disable option that sets `slapform: false`).
 *      Non-interactive and dry runs skip cleanly.
 */
const chalk = require('chalk').default;
const { serviceInputSpec } = require('../../config.js');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { requestServiceInput } = require('../../lib/service-input.js');
const { FirestoreREST, loadServiceAccount } = require('../../lib/firestore-rest.js');
const { createAuthAdmin } = require('../../lib/auth-admin.js');
const { resolveConfigValue, landValue } = require('../../lib/config-flow.js');
const { createProductAsset } = require('../../lib/product-create.js');
const { createPasswordResolver } = require('../account/lib/resolve-password.js');

const SLAPFORM_URL = 'https://slapform.com';

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const config = context.brandConfig.forms?.providers?.slapform;

    if (config === false || config?.enabled === false) {
      return { skip: true, reason: 'forms.providers.slapform.enabled = false' };
    }

    // Shared form: another brand owns its branding (the chatsy/replyify
    // updateAgentInfo pattern) — never rename or re-enable it from here
    if (config?.updateFormInfo === false) {
      return { skip: true, reason: 'form managed by another brand (forms.providers.slapform.updateFormInfo = false)' };
    }

    // The contact form lives on the brand's website
    if (!context.brandConfig.targets?.web) {
      return { skip: true, reason: 'no web target' };
    }

    // Operator credentials first — create-on-missing needs them before the
    // id resolution. Tests inject fakes via context.slapformDb/-AuthAdmin.
    let db = context.slapformDb;
    let authAdmin = context.slapformAuthAdmin;
    if (!db) {
      const envPath = process.env.SLAPFORM_SERVICE_ACCOUNT;
      if (envPath) {
        const serviceAccount = loadServiceAccount(envPath, context.brandRoot);
        db = new FirestoreREST(serviceAccount);
        authAdmin = createAuthAdmin(serviceAccount);
      }
    }

    const brand = context.brandConfig.brand || {};
    const dryRun = context.options?.dryRun || false;
    let formId = config?.formId;

    // 2b create-on-missing: operator SA + a template donor → a missing form
    // means MINT the brand's own (product user + doc), write the id back,
    // and let the ensures below converge it in this same run.
    if (!formId && db && authAdmin && config?.templateFormId && brand.contact?.email) {
      const created = await createProductAsset({
        db,
        authAdmin,
        collection: 'forms',
        templateId: config.templateFormId,
        email: brand.contact.email,
        resolvePassword: createPasswordResolver({
          brandRoot: context.brandRoot,
          domain: new URL(brand.url || 'https://invalid.test').hostname,
          brand,
          dryRun,
        }),
        dryRun,
        log: (line) => console.log(`      ${line}`),
      });

      if (!created) {
        return { skip: true, reason: 'dry run — form creation planned (from forms.providers.slapform.templateFormId)' };
      }

      landValue(context, 'forms.providers.slapform.formId', created.id);
      console.log(`      ${chalk.green('✓')} forms.providers.slapform.formId = ${chalk.cyan(created.id)} written to omega.json5`);
      formId = created.id;
    }

    if (!formId) {
      formId = await resolveConfigValue(context, {
        path: 'forms.providers.slapform.formId',
        label: 'Slapform contact form',
        instructions: [
          `1. Create an account at ${chalk.cyan(SLAPFORM_URL)} (if you haven't already)`,
          `2. Create a contact form for ${chalk.cyan(brand.name || context.brandId)}`,
        ],
        entry: { url: SLAPFORM_URL, message: 'Slapform form ID:' },
        disablePath: 'forms.providers.slapform',
      });
    }
    if (!formId) {
      return { skip: true, reason: 'no forms.providers.slapform.formId configured — set forms.providers.slapform.templateFormId + the operator SA to mint one automatically, create one at https://slapform.com (paste back interactively), or set it in omega.json5' };
    }

    if (!db) {
      if (process.env.SLAPFORM_API_KEY) {
        return {
          skip: true,
          reason: 'SLAPFORM_API_KEY recognized, but product-API management is not wired yet — use the operator SA (SLAPFORM_SERVICE_ACCOUNT) or the dashboard',
        };
      }

      // The shared setup contract (#608): the operator SA is asked for right
      // here — most brands are not the Slapform operator and answer Disable,
      // which retires the ask for good.
      const gate = await requestServiceInput(context, serviceInputSpec('forms'));
      if (gate) return gate;
      db = new FirestoreREST(loadServiceAccount(process.env.SLAPFORM_SERVICE_ACCOUNT, context.brandRoot));
    }

    return { db, formId };
  },
});
