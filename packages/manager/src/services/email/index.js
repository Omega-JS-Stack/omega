/**
 * Email service (`inbound.email.providers.replyify`) — the brand's
 * customer-service email agent on Replyify (replyify.app): keeps the agent's
 * Gmail filter + knowledge in sync (baseline templates with brand values +
 * the brand repo's config/replyify.md merged in) and sets the agent-owner
 * account to the configured plan (Replyify's top tier by default). Agents live in
 * Replyify's own Firestore, so this service is for the Replyify operator:
 * it needs a service account for Replyify's Firebase project.
 *
 * Auth tiers (2b, Ian 2026-07-13):
 *   1. Operator SA — REPLYIFY_SERVICE_ACCOUNT in the brand .env (path to
 *      the service-account JSON, absolute or brand-root-relative). Full
 *      create + manage: a missing agentId with `inbound.email.providers.replyify.templateAgentId`
 *      configured (the company layer's shape donor) MINTS the brand's own
 *      agent — product user (email = brand contact email, password via the
 *      account service's owner channels) + doc shape-templated from the
 *      donor — and writes the new id back into omega.json5. The ensures
 *      then converge filter/knowledge/plan in the same run.
 *   2. User API key — REPLYIFY_API_KEY (the product accepts
 *      user.api.privateKey): recognized, management via the product's
 *      public API lands when those routes are verified.
 *   3. Dashboard — interactive runs offer the setup flow (open
 *      replyify.app, paste the agent id back — comment-preserving
 *      writeback, with a Disable option that sets `replyify: false`).
 *      Non-interactive and dry runs skip cleanly.
 */
const chalk = require('chalk').default;
const { createServiceRunner } = require('../../lib/service-runner.js');
const { FirestoreREST, loadServiceAccount } = require('../../lib/firestore-rest.js');
const { createAuthAdmin } = require('../../lib/auth-admin.js');
const { resolveConfigValue, landValue } = require('../../lib/config-flow.js');
const { createProductAsset } = require('../../lib/product-create.js');
const { createPasswordResolver } = require('../account/lib/resolve-password.js');

const REPLYIFY_URL = 'https://replyify.app';

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const config = context.brandConfig.inbound?.email?.providers?.replyify;

    if (config === false || config?.enabled === false) {
      return { skip: true, reason: 'inbound.email.providers.replyify.enabled = false' };
    }

    // A shared agent managed by another brand must not be rewritten here
    if (config?.updateAgentInfo === false) {
      return { skip: true, reason: 'agent managed by another brand (inbound.email.providers.replyify.updateAgentInfo = false)' };
    }

    // The agent answers the brand's support email, which the backend serves
    if (!context.brandConfig.targets?.backend) {
      return { skip: true, reason: 'no backend target' };
    }

    // Operator credentials first — create-on-missing needs them before the
    // id resolution. Tests inject fakes via context.replyifyDb/-AuthAdmin.
    let db = context.replyifyDb;
    let authAdmin = context.replyifyAuthAdmin;
    if (!db) {
      const envPath = process.env.REPLYIFY_SERVICE_ACCOUNT;
      if (envPath) {
        const serviceAccount = loadServiceAccount(envPath, context.brandRoot);
        db = new FirestoreREST(serviceAccount);
        authAdmin = createAuthAdmin(serviceAccount);
      }
    }

    const brand = context.brandConfig.brand || {};
    const dryRun = context.options?.dryRun || false;
    let agentId = config?.agentId;

    // 2b create-on-missing: operator SA + a template donor → a missing agent
    // means MINT the brand's own (product user + doc), write the id back,
    // and let the ensures below converge it in this same run.
    if (!agentId && db && authAdmin && config?.templateAgentId && brand.contact?.email) {
      const created = await createProductAsset({
        db,
        authAdmin,
        collection: 'agents',
        templateId: config.templateAgentId,
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
        return { skip: true, reason: 'dry run — agent creation planned (from inbound.email.providers.replyify.templateAgentId)' };
      }

      landValue(context, 'inbound.email.providers.replyify.agentId', created.id);
      console.log(`      ${chalk.green('✓')} inbound.email.providers.replyify.agentId = ${chalk.cyan(created.id)} written to omega.json5`);
      agentId = created.id;
    }

    if (!agentId) {
      agentId = await resolveConfigValue(context, {
        path: 'inbound.email.providers.replyify.agentId',
        label: 'Replyify email agent',
        instructions: [
          `1. Create an account at ${chalk.cyan(REPLYIFY_URL)} (if you haven't already)`,
          `2. Create an email agent for ${chalk.cyan(brand.name || context.brandId)}`,
        ],
        entry: { url: REPLYIFY_URL, message: 'Replyify agent ID:' },
        disablePath: 'inbound.email.providers.replyify',
      });
    }
    if (!agentId) {
      return { skip: true, reason: 'no inbound.email.providers.replyify.agentId configured — set inbound.email.providers.replyify.templateAgentId + the operator SA to mint one automatically, create one at https://replyify.app (paste back interactively), or set it in omega.json5' };
    }

    if (!db) {
      return {
        skip: true,
        reason: process.env.REPLYIFY_API_KEY
          ? 'REPLYIFY_API_KEY recognized, but product-API management is not wired yet — use the operator SA (REPLYIFY_SERVICE_ACCOUNT) or the dashboard'
          : 'no REPLYIFY_SERVICE_ACCOUNT configured (path to Replyify\'s service-account JSON, set it in the brand .env)',
      };
    }

    return { db, agentId };
  },
});
