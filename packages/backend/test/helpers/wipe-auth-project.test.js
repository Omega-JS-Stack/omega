/**
 * Test: the wipe's auth bulk-clear names the project it is actually wiping
 * ([#292](https://github.com/Omega-JS-Stack/omega/issues/292)).
 *
 * `deleteTestUsers` clears the auth store through the emulator's bulk-clear
 * REST API, whose URL names a PROJECT — and the emulator answers 200 for a
 * project it has never heard of. The id came from `GCLOUD_PROJECT || 'demo-test'`
 * while the runner's env never set GCLOUD_PROJECT, so every run cleared the
 * empty `demo-test` store, reported "61 deleted", and left the real project's
 * accounts standing. Ordinary personas masked it (createAccount deletes before
 * creating); the import-only google personas did not.
 *
 * Run: npx omega test backend:helpers/wipe-auth-project
 *
 * Real everything: the REAL Auth emulator's own account store, read through the
 * same REST surface the wipe deletes through, and the REAL admin app the runner
 * booted. Non-destructive on purpose — the suite's personas (and the api keys
 * the runner cached from them) must survive this file.
 */
const { TEST_ACCOUNTS, resolveWipeProjectId } = require('../../dist/test/test-accounts.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// The project id the wipe fell back to before the fix — the store it cleared
// every run.
const HARDCODED_DEFAULT = 'demo-test';

/**
 * The emulator's account store FOR ONE PROJECT — the admin query surface, whose
 * project path is the same one the bulk clear deletes through
 * (`DELETE /emulator/v1/projects/<id>/accounts`; that path serves no GET).
 * The emulator keeps a separate store per project id, which is the whole point:
 * the wipe's URL decides WHICH store it empties.
 * @param {string} projectId - The project whose store to read.
 * @returns {Promise<string[]>} The uids it holds.
 */
async function listEmulatorAccounts(projectId) {
  const url = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:query`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: '{}',
  });

  if (!response.ok) {
    return [];
  }

  const body = await response.json();
  return (body.userInfo || []).map((account) => account.localId);
}

/**
 * The message a call throws, '' when it returns — a thrown-message matcher
 * keeps these red-capable (a renamed export would throw a TypeError and still
 * "throw", but not with this message).
 * @param {Function} fn - The call under test.
 * @returns {string} The error message, or '' when nothing threw.
 */
function messageOf(fn) {
  try {
    fn();
    return '';
  } catch (error) {
    return error.message;
  }
}

module.exports = defineCases({
  description: 'the auth bulk-clear targets THIS project, and fails loudly when it cannot tell',
  type: 'group',
  auth: 'none',
  timeout: 30000,

  tests: [
    {
      name: 'the-runner-env-carries-this-projects-id',
      async run({ assert, config }) {
        // The root cause: the runner's child env (buildTestCommand) shipped the
        // emulator hosts but never the project they belong to.
        assert.equal(
          process.env.GCLOUD_PROJECT,
          config.cloud.config.projectId,
          'the test runner env must name the project the emulator booted with',
        );
      },
    },

    {
      name: 'the-wiped-store-is-the-one-holding-the-personas',
      async run({ assert, Manager, config }) {
        const admin = Manager.libraries.admin;
        const projectId = resolveWipeProjectId(admin);

        assert.equal(projectId, config.cloud.config.projectId);

        // The store the wipe's URL names holds the accounts the wipe exists to
        // remove. This is the assertion the old id failed.
        const targeted = await listEmulatorAccounts(projectId);
        assert.equal(
          targeted.includes(TEST_ACCOUNTS.basic.uid),
          true,
          `project "${projectId}" should hold the seeded personas the wipe clears`,
        );

        // ...and the id it used to fall back to names a store none of them live
        // in, which is why clearing it returned 200 and removed nothing.
        const fallback = await listEmulatorAccounts(HARDCODED_DEFAULT);
        assert.equal(
          fallback.includes(TEST_ACCOUNTS.basic.uid),
          false,
          `project "${HARDCODED_DEFAULT}" is not where this run's accounts live`,
        );
      },
    },

    {
      name: 'a-project-id-disagreement-throws-instead-of-clearing-a-stranger',
      async run({ assert, Manager, config }) {
        const admin = Manager.libraries.admin;

        // A stale GCLOUD_PROJECT from another brand's shell would send the wipe
        // at a store this process never reads or writes — success there is the
        // #292 failure wearing a different hat, so it throws.
        assert.match(
          messageOf(() => resolveWipeProjectId(admin, { GCLOUD_PROJECT: 'demo-somebody-else' })),
          /demo-somebody-else/,
          'a project id that disagrees with the admin app must abort the wipe',
        );

        // Agreement is the normal case, from either source alone.
        assert.equal(resolveWipeProjectId(admin, {}), config.cloud.config.projectId);
        assert.equal(
          resolveWipeProjectId(undefined, { GCLOUD_PROJECT: config.cloud.config.projectId }),
          config.cloud.config.projectId,
        );

        // Nothing to resolve is never a silent default — the old `|| 'demo-test'`
        // is exactly how a wipe with no identity reported success.
        assert.match(messageOf(() => resolveWipeProjectId(undefined, {})), /project id/);
      },
    },
  ],
});
