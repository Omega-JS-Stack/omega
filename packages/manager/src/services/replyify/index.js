/**
 * Replyify service — the brand's customer-service email agent on Replyify
 * (replyify.app): keeps the agent's Gmail filter + knowledge in sync
 * (baseline templates with brand values + the brand repo's
 * config/replyify.md merged in) and sets the agent-owner account to the
 * configured plan (Replyify's top tier by default). Agents live in
 * Replyify's own Firestore, so this service is for the Replyify operator:
 * it needs a service account for Replyify's Firebase project.
 *
 * Auth: REPLYIFY_SERVICE_ACCOUNT in the brand .env — a path to the
 * service-account JSON (absolute, or relative to the brand root, e.g.
 * `.omega/secrets/replyify-service-account.json`). omega-manager read the
 * company-mode `.output/replyify/secrets/service-account.json` instead.
 *
 * The agent id comes from config (replyify.agentId) — agents are created
 * in the Replyify dashboard. omega-manager's interactive setup flow rides
 * the onboarding-flows port (the writeback itself is live —
 * lib/config-write.js); until then a missing id is a clean skip.
 */
const { createServiceRunner } = require('../../lib/service-runner.js');
const { FirestoreREST, loadServiceAccount } = require('../../lib/firestore-rest.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const config = context.brandConfig.replyify;

    if (config === false || config?.enabled === false) {
      return { skip: true, reason: 'replyify.enabled = false' };
    }

    // A shared agent managed by another brand must not be rewritten here
    if (config?.updateAgentInfo === false) {
      return { skip: true, reason: 'agent managed by another brand (replyify.updateAgentInfo = false)' };
    }

    // The agent answers the brand's support email, which the backend serves
    if (!context.brandConfig.targets?.backend) {
      return { skip: true, reason: 'no backend target' };
    }

    const agentId = config?.agentId;
    if (!agentId) {
      return { skip: true, reason: 'no replyify.agentId configured (create an agent at https://replyify.app, then set it in omega.json5)' };
    }

    // Tests inject a fake client via context.replyifyDb
    let db = context.replyifyDb;
    if (!db) {
      const envPath = process.env.REPLYIFY_SERVICE_ACCOUNT;
      if (!envPath) {
        return { skip: true, reason: 'no REPLYIFY_SERVICE_ACCOUNT configured (path to Replyify\'s service-account JSON, set it in the brand .env)' };
      }
      db = new FirestoreREST(loadServiceAccount(envPath, context.brandRoot));
    }

    return { db, agentId };
  },
});
