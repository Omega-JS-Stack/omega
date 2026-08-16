/**
 * Test: the Google picker personas re-seed onto a warm emulator
 * ([#241](https://github.com/Omega-JS-Stack/omega/issues/241)).
 *
 * The two google.com-provider personas are IMPORT-ONLY (`importUsers` is the
 * one server-side surface that writes providerData), and the Auth emulator
 * refuses an import over an existing localId. A back-to-back suite run against
 * a warm emulator therefore died at seed time with
 * `localId belongs to an existing account`, which reads as a red suite while
 * nothing is broken. The import is idempotent now: seeding twice lands the same
 * record twice.
 *
 * Run: npx omega test backend:helpers/seed-google-personas
 *
 * Real everything: the REAL Auth emulator, the REAL seeder function. The
 * personas already exist when this runs (the suite's own seed just made them),
 * so the first call here is already the second seed the bug fired on.
 */
const { GOOGLE_ACCOUNTS, importGoogleAccount } = require('../../src/test/test-accounts.js');

// The domain the seeder resolves persona emails against — same derivation the
// emulator's boot seed and the runner both use.
function seedDomain(config) {
  const email = config?.brand?.contact?.email || '';

  return email.includes('@') ? email.split('@')[1] : '';
}

module.exports = {
  description: 'Google picker personas import idempotently onto a warm emulator',
  type: 'group',
  auth: 'none',
  timeout: 30000,

  tests: [
    {
      name: 'a-second-seed-of-an-existing-persona-succeeds',
      async run({ assert, Manager, config, skip }) {
        const domain = seedDomain(config);

        if (!domain) {
          skip('No brand.contact.email configured — persona emails have no domain');
        }

        const admin = Manager.libraries.admin;

        for (const account of Object.values(GOOGLE_ACCOUNTS)) {
          const email = account.email.replace('{domain}', domain);

          // Precondition: the suite's seed already created this persona, so
          // this IS the re-seed the bug fired on.
          const existing = await admin.auth().getUser(account.uid).catch(() => null);
          assert.ok(existing, `precondition: ${account.uid} should already be seeded`);

          await importGoogleAccount(admin, { ...account, email: email });

          // ...and a third time, because idempotent means repeatable, not "once more".
          await importGoogleAccount(admin, { ...account, email: email });
        }
      },
    },

    {
      name: 'the-re-seeded-persona-still-carries-its-google-provider',
      async run({ assert, Manager, config, skip }) {
        const domain = seedDomain(config);

        if (!domain) {
          skip('No brand.contact.email configured — persona emails have no domain');
        }

        const admin = Manager.libraries.admin;

        for (const account of Object.values(GOOGLE_ACCOUNTS)) {
          const email = account.email.replace('{domain}', domain);

          await importGoogleAccount(admin, { ...account, email: email });

          const record = await admin.auth().getUser(account.uid);

          // The whole point of these personas: the emulator's Google sign-in
          // picker lists an account only while its record carries the provider.
          assert.equal(record.email, email);
          assert.equal(record.providerData.some((provider) => provider.providerId === 'google.com'), true, `${account.uid} lost its google.com provider`);
        }
      },
    },

    {
      name: 'a-persona-absent-from-the-emulator-still-imports',
      async run({ assert, Manager, config, skip }) {
        // The cold path must keep working — idempotency cannot depend on the
        // record already being there.
        const domain = seedDomain(config);

        if (!domain) {
          skip('No brand.contact.email configured — persona emails have no domain');
        }

        const admin = Manager.libraries.admin;
        const account = Object.values(GOOGLE_ACCOUNTS)[0];
        const email = account.email.replace('{domain}', domain);

        await admin.auth().deleteUser(account.uid).catch(() => {});

        await importGoogleAccount(admin, { ...account, email: email });

        const record = await admin.auth().getUser(account.uid);
        assert.equal(record.uid, account.uid);
      },
    },
  ],
};
