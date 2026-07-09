/**
 * Chatsy service — the brand's support chat agent on Chatsy (chatsy.ai):
 * keeps the agent's settings + knowledge in sync (baseline knowledge with
 * brand values filled in + generated pricing + the brand repo's
 * config/chatsy.md appended) and sets the agent-owner account to the
 * configured plan (Chatsy's top tier by default) so the brand has full
 * access. Agents live in Chatsy's own Firestore, so this service is for
 * the Chatsy operator: it needs a service account for Chatsy's Firebase
 * project.
 *
 * Auth: CHATSY_SERVICE_ACCOUNT in the brand .env — a path to the
 * service-account JSON (absolute, or relative to the brand root, e.g.
 * `.omega/secrets/chatsy-service-account.json`). omega-manager read the
 * company-mode `.output/chatsy/secrets/service-account.json` instead.
 *
 * The agent id comes from config (chatsy.agentId) — agents are created in
 * the Chatsy dashboard. Interactive runs offer the setup flow when it's
 * missing (open chatsy.ai, paste the agent id back — comment-preserving
 * writeback into omega.json5, with a Disable option that sets
 * `chatsy: false`); non-interactive and dry runs skip cleanly.
 */
const chalk = require('chalk').default;
const { createServiceRunner } = require('../../lib/service-runner.js');
const { FirestoreREST, loadServiceAccount } = require('../../lib/firestore-rest.js');
const { resolveConfigValue } = require('../../lib/config-flow.js');

const CHATSY_URL = 'https://chatsy.ai';

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const config = context.brandConfig.chatsy;

    if (config === false || config?.enabled === false) {
      return { skip: true, reason: 'chatsy.enabled = false' };
    }

    // A shared agent managed by another brand must not be rewritten here
    if (config?.updateAgentInfo === false) {
      return { skip: true, reason: 'agent managed by another brand (chatsy.updateAgentInfo = false)' };
    }

    // The chat widget lives on the brand's website
    if (!context.brandConfig.targets?.web) {
      return { skip: true, reason: 'no web target' };
    }

    let agentId = config?.agentId;
    if (!agentId) {
      agentId = await resolveConfigValue(context, {
        path: 'chatsy.agentId',
        label: 'Chatsy chat agent',
        instructions: [
          `1. Create an account at ${chalk.cyan(CHATSY_URL)} (if you haven't already)`,
          `2. Create a chat agent for ${chalk.cyan(context.brandConfig.brand?.name || context.brandId)}`,
        ],
        entry: { url: CHATSY_URL, message: 'Chatsy agent ID:' },
        disablePath: 'chatsy',
      });
    }
    if (!agentId) {
      return { skip: true, reason: 'no chatsy.agentId configured (create a chat agent at https://chatsy.ai, then set it in omega.json5 — or rerun interactively)' };
    }

    // Tests inject a fake client via context.chatsyDb
    let db = context.chatsyDb;
    if (!db) {
      const envPath = process.env.CHATSY_SERVICE_ACCOUNT;
      if (!envPath) {
        return { skip: true, reason: 'no CHATSY_SERVICE_ACCOUNT configured (path to Chatsy\'s service-account JSON, set it in the brand .env)' };
      }
      db = new FirestoreREST(loadServiceAccount(envPath, context.brandRoot));
    }

    return { db, agentId };
  },
});
