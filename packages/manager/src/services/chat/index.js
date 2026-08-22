/**
 * Chat service (`inbound.chat.providers.chatsy`) — the brand's support chat
 * agent on Chatsy (chatsy.ai): keeps the agent's settings + knowledge in sync
 * (baseline knowledge with brand values filled in + generated pricing + the
 * brand repo's config/chatsy.md appended) and sets the agent-owner account to
 * the configured plan (Chatsy's top tier by default) so the brand has full
 * access. Agents live in Chatsy's own Firestore, so this service is for
 * the Chatsy operator: it needs a service account for Chatsy's Firebase
 * project.
 *
 * Auth tiers (2b, Ian 2026-07-13):
 *   1. Operator SA — CHATSY_SERVICE_ACCOUNT in the brand .env (path to the
 *      service-account JSON, absolute or brand-root-relative). Full create
 *      + manage: a missing agentId with `inbound.chat.providers.chatsy.templateAgentId` configured
 *      (the company layer's shape donor) MINTS the brand's own agent —
 *      product user (email = brand contact email, password via the account
 *      service's owner channels) + doc shape-templated from the donor —
 *      and writes the new id back into omega.json5. The ensures then
 *      converge name/knowledge/plan in the same run.
 *   2. User API key — CHATSY_API_KEY (the product accepts
 *      user.api.privateKey): recognized, management via the product's
 *      public API lands when those routes are verified.
 *   3. Dashboard — interactive runs offer the setup flow (open chatsy.ai,
 *      paste the agent id back — comment-preserving writeback, with a
 *      Disable option that sets `chatsy: false`). Non-interactive and dry
 *      runs skip cleanly.
 */
const chalk = require('chalk').default;
const { createServiceRunner } = require('../../lib/service-runner.js');
const { FirestoreREST, loadServiceAccount } = require('../../lib/firestore-rest.js');
const { createAuthAdmin } = require('../../lib/auth-admin.js');
const { resolveConfigValue, landValue } = require('../../lib/config-flow.js');
const { createProductAsset } = require('../../lib/product-create.js');
const { createPasswordResolver } = require('../account/lib/resolve-password.js');

const CHATSY_URL = 'https://chatsy.ai';

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const config = context.brandConfig.inbound?.chat?.providers?.chatsy;

    if (config === false || config?.enabled === false) {
      return { skip: true, reason: 'inbound.chat.providers.chatsy.enabled = false' };
    }

    // A shared agent managed by another brand must not be rewritten here
    if (config?.updateAgentInfo === false) {
      return { skip: true, reason: 'agent managed by another brand (inbound.chat.providers.chatsy.updateAgentInfo = false)' };
    }

    // The chat widget lives on the brand's website
    if (!context.brandConfig.targets?.web) {
      return { skip: true, reason: 'no web target' };
    }

    // Operator credentials first — create-on-missing needs them before the
    // id resolution. Tests inject fakes via context.chatsyDb/-AuthAdmin.
    let db = context.chatsyDb;
    let authAdmin = context.chatsyAuthAdmin;
    if (!db) {
      const envPath = process.env.CHATSY_SERVICE_ACCOUNT;
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
        return { skip: true, reason: 'dry run — agent creation planned (from inbound.chat.providers.chatsy.templateAgentId)' };
      }

      landValue(context, 'inbound.chat.providers.chatsy.agentId', created.id);
      console.log(`      ${chalk.green('✓')} inbound.chat.providers.chatsy.agentId = ${chalk.cyan(created.id)} written to omega.json5`);
      agentId = created.id;
    }

    if (!agentId) {
      agentId = await resolveConfigValue(context, {
        path: 'inbound.chat.providers.chatsy.agentId',
        label: 'Chatsy chat agent',
        instructions: [
          `1. Create an account at ${chalk.cyan(CHATSY_URL)} (if you haven't already)`,
          `2. Create a chat agent for ${chalk.cyan(brand.name || context.brandId)}`,
        ],
        entry: { url: CHATSY_URL, message: 'Chatsy agent ID:' },
        disablePath: 'inbound.chat.providers.chatsy',
      });
    }
    if (!agentId) {
      return { skip: true, reason: 'no inbound.chat.providers.chatsy.agentId configured — set inbound.chat.providers.chatsy.templateAgentId + the operator SA to mint one automatically, create one at https://chatsy.ai (paste back interactively), or set it in omega.json5' };
    }

    if (!db) {
      return {
        skip: true,
        reason: process.env.CHATSY_API_KEY
          ? 'CHATSY_API_KEY recognized, but product-API management is not wired yet — use the operator SA (CHATSY_SERVICE_ACCOUNT) or the dashboard'
          : 'no CHATSY_SERVICE_ACCOUNT configured (path to Chatsy\'s service-account JSON, set it in the brand .env)',
      };
    }

    return { db, agentId };
  },
});
