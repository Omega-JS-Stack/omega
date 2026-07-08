/**
 * Server service — publishes the brand's registry entry to the company
 * server's Firestore at brands/{brand.id}. The company's parent backend
 * keeps a registry of every brand it serves (webhook fan-out, cross-brand
 * features read it); this service keeps that entry in sync with the brand
 * config.
 *
 * Auth: SERVER_SERVICE_ACCOUNT in the brand .env — a path to the company
 * server's Firebase service-account JSON (absolute, or relative to the
 * brand root). omega-manager hardcoded the company project
 * ('itw-creative-works') and read its secrets from the company-instance
 * .output/ tree instead; its legacy-brand `_` prefix skip was a
 * company-instance convention and is dropped.
 */
const { createServiceRunner } = require('../../lib/service-runner.js');
const { FirestoreREST, loadServiceAccount } = require('../../lib/firestore-rest.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const config = context.brandConfig.server;

    if (config === false || config?.enabled === false) {
      return { skip: true, reason: 'server.enabled = false' };
    }

    // Tests inject a fake client via context.serverDb
    let db = context.serverDb;
    if (!db) {
      const envPath = process.env.SERVER_SERVICE_ACCOUNT;
      if (!envPath) {
        return { skip: true, reason: 'no SERVER_SERVICE_ACCOUNT configured (path to the company server\'s service-account JSON, set it in the brand .env)' };
      }
      db = new FirestoreREST(loadServiceAccount(envPath, context.brandRoot));
    }

    return { db };
  },
});
