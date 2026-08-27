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
const { serviceInputSpec } = require('../../config.js');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { requestServiceInput } = require('../../lib/service-input.js');
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
      // The shared setup contract (#608): a company-server operator provides
      // the path here; every standalone brand answers Disable once and is
      // never asked again.
      const gate = await requestServiceInput(context, serviceInputSpec('server'));
      if (gate) return gate;
      db = new FirestoreREST(loadServiceAccount(process.env.SERVER_SERVICE_ACCOUNT, context.brandRoot));
    }

    return { db };
  },
});
