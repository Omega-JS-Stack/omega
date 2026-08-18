/**
 * Directory service — the brand PUSHES its own entry into the PARENT
 * project's Firestore `brands` collection (`brands/{brand.id}`) during its
 * manage walk, so whatever the parent runs on top of that collection reads a
 * current directory instead of one that goes stale the day a brand migrates.
 *
 * GENERIC and opt-in (#246). The framework owes the fresh ENTRY and nothing
 * else: the marketplace/hub that consumes it — ITW's guest-post sponsorship
 * marketplace is the first — is brand code and never enters the framework.
 * The payload is brand identity plus the opt-in BLOCKS the brand declares
 * (lib/blocks.js); `sponsorships` is the first block. Field mapping from
 * legacy omega-manager: docs/manager/directory.md.
 *
 * Gates, in order — every one of them is a clean skip:
 *   1. `directory.enabled: true`. Absent config never pushes: the parent
 *      declares the collection world-readable in its own rules (the operator
 *      step in docs/manager/directory.md), so participation is explicit or
 *      nothing.
 *   2. `parent` names the relationship. No parent (or `parent: false`) means
 *      there is no directory to push INTO.
 *   3. Not a demo-* (emulator-only) brand — the cloud service's gate, for the
 *      same reason: an offline fixture must never reach a live project.
 *
 * Auth: DIRECTORY_SERVICE_ACCOUNT in the brand .env — a path to the PARENT
 * project's Firebase service-account JSON (absolute, or relative to the brand
 * root), the server service's mechanism exactly. The service account names the
 * target project; no config key ever holds a credential.
 */
const { isDemoProject } = require('@omega.js/config');

const { createServiceRunner } = require('../../lib/service-runner.js');
const { FirestoreREST, loadServiceAccount } = require('../../lib/firestore-rest.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const { brandConfig } = context;

    if (brandConfig.directory?.enabled !== true) {
      return { skip: true, reason: 'directory.enabled is not true (the brand does not participate in a directory)' };
    }

    if (!brandConfig.parent) {
      return { skip: true, reason: 'no parent configured — there is no parent directory to push into' };
    }

    const projectId = brandConfig.cloud?.config?.projectId;
    if (isDemoProject(projectId)) {
      return { skip: true, reason: `${projectId} is a demo-* (emulator-only) project — no live directory to push into` };
    }

    // Tests inject a fake client via context.directoryDb
    let db = context.directoryDb;
    if (!db) {
      const envPath = process.env.DIRECTORY_SERVICE_ACCOUNT;
      if (!envPath) {
        return { skip: true, reason: 'no DIRECTORY_SERVICE_ACCOUNT configured (path to the parent project\'s service-account JSON, set it in the brand .env)' };
      }
      db = new FirestoreREST(loadServiceAccount(envPath, context.brandRoot));
    }

    return { db };
  },
});
