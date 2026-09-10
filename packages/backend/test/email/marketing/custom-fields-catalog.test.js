/**
 * Marketing custom-field catalog test — what a provider PROVISIONS and what its
 * contact sync WRITES are one list
 * ([#695](https://github.com/Omega-JS-Stack/omega/issues/695)).
 *
 * The bug this pins: `user_personal_name_first` / `user_personal_name_last` are
 * `skip: ['sendgrid']` (SendGrid stores first/last name in its RESERVED contact
 * columns, which `addContact()` writes natively), but the sync's `buildFields()`
 * looped over EVERY resolved field, so every live signup logged 'SendGrid
 * buildFields: 2 field(s) have no SendGrid ID (skipped)'. The names always
 * reached the contact; the warn was noise pointing at a field nobody meant to
 * provision.
 *
 * The catalog (FIELDS in constants.js) is the ONE home of the field list, and
 * `fieldsForProvider()` is the ONE derivation of a provider's view of it — the
 * manager's custom-fields ensure provisions exactly that set, and each
 * provider's `buildFields()` writes exactly that set. A field the catalog skips
 * is therefore never provisioned AND never written, so the two lists cannot
 * drift in either direction — that agreement is the invariant under test.
 *
 * Plain-node control-flow test (no emulator, no network): the real catalog and
 * the real `resolveFieldValues()` run over a user doc that populates EVERY
 * field in the dictionary, and the real `buildFields()` of both providers runs
 * with SendGrid's field_definitions call stubbed in the require cache (the same
 * idiom as helpers/webhook-forward.test.js).
 */
const assert = require('node:assert');
const {
  FIELDS,
  fieldsForProvider,
  resolveFieldValues,
} = require('../../../dist/manager/libraries/email/constants.js');
const Manager = require('../../../dist/manager/index.js');
const beehiivProvider = require('../../../dist/manager/libraries/email/providers/beehiiv.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const CONFIG = { brand: { id: 'acme' } };

// SendGrid holds these two in its reserved contact columns (addContact writes
// them natively), so the catalog skips them for SendGrid alone.
const SENDGRID_RESERVED = ['user_personal_name_first', 'user_personal_name_last'];

// A user doc that fills every 'user' and 'resolved' path in FIELDS — anything
// left null drops out of resolveFieldValues() and would hide a real gap.
const USER_DOC = {
  auth: { uid: 'uid_1', email: 'buyer@gmail.com' },
  personal: {
    name: { first: 'Ada', last: 'Lovelace' },
    company: { name: 'Analytical Engines' },
    location: { country: 'US' },
  },
  metadata: {
    created: { timestamp: '2026-01-02T03:04:05.000Z' },
    updated: { timestamp: '2026-08-30T03:04:05.000Z' },
  },
  subscription: {
    status: 'active',
    plan: { id: 'pro' },
    trial: { claimed: true },
    payment: {
      provider: 'stripe',
      frequency: 'monthly',
      price: 19,
      updatedBy: { date: { timestamp: '2026-08-01T00:00:00.000Z' } },
    },
  },
  attribution: { last: { tags: { utm_source: 'newsletter' } } },
};

const FIELD_DEFINITIONS_URL = 'https://api.sendgrid.com/v3/marketing/field_definitions';
const FETCH_PATH = require.resolve('wonderful-fetch');
const SENDGRID_PATH = require.resolve('../../../dist/manager/libraries/email/providers/sendgrid.js');

/**
 * A SendGrid field_definitions response for the catalog's SendGrid view — every
 * field OMEGA provisions has an ID, so anything buildFields() reports unmapped
 * can only be a field the catalog skipped.
 */
function fieldDefinitions() {
  return {
    custom_fields: fieldsForProvider('sendgrid').map((name, index) => ({ id: `e${index + 1}_T`, name })),
  };
}

/**
 * Run against a FRESH sendgrid.js whose network call is stubbed in the require
 * cache (the provider captures `wonderful-fetch` at module load, so the module
 * has to be re-required behind the stub). Both cache entries and the captured
 * `console.warn` are restored afterwards — the runner shares one process, so a
 * leaked stub would poison every later file.
 */
async function withSendgrid(run) {
  const originalFetchEntry = require.cache[FETCH_PATH];
  const originalSendgridEntry = require.cache[SENDGRID_PATH];
  const originalConfig = Manager.config;
  const originalWarn = console.warn;
  const warns = [];

  require.cache[FETCH_PATH] = {
    id: FETCH_PATH,
    filename: FETCH_PATH,
    loaded: true,
    exports: async (url) => {
      assert.strictEqual(url, FIELD_DEFINITIONS_URL, `buildFields only reads field definitions, got ${url}`);

      return fieldDefinitions();
    },
  };

  delete require.cache[SENDGRID_PATH];
  Manager.config = CONFIG;
  console.warn = (...args) => warns.push(args.join(' '));

  try {
    return await run(require(SENDGRID_PATH), warns);
  } finally {
    console.warn = originalWarn;
    Manager.config = originalConfig;

    if (originalSendgridEntry) {
      require.cache[SENDGRID_PATH] = originalSendgridEntry;
    } else {
      delete require.cache[SENDGRID_PATH];
    }

    if (originalFetchEntry) {
      require.cache[FETCH_PATH] = originalFetchEntry;
    } else {
      delete require.cache[FETCH_PATH];
    }
  }
}

/** Run with Manager.config pinned — buildFields resolves 'config' fields off it. */
function withConfig(run) {
  const originalConfig = Manager.config;

  Manager.config = CONFIG;

  try {
    return run();
  } finally {
    Manager.config = originalConfig;
  }
}

module.exports = defineCases({
  description: 'Marketing custom-field catalog ↔ provider sync agreement (#695)',
  type: 'group',
  tests: [
    {
      name: 'the SendGrid catalog covers every synced field except the two SendGrid holds natively',

      run() {
        const provisioned = fieldsForProvider('sendgrid');
        const synced = Object.keys(resolveFieldValues(USER_DOC, CONFIG));

        const unprovisioned = synced.filter((name) => !provisioned.includes(name));

        assert.deepStrictEqual(
          unprovisioned,
          SENDGRID_RESERVED,
          `Only SendGrid's reserved name columns may sit outside the custom-field catalog, got ${unprovisioned.join(', ')}`,
        );
        assert.strictEqual(
          synced.length,
          Object.keys(FIELDS).length,
          `The doc populates the whole catalog, got ${synced.length} of ${Object.keys(FIELDS).length}`,
        );
      },
    },

    {
      name: 'the name fields skip SendGrid\'s custom-field lane and still resolve for the providers that need them',

      run() {
        const provisioned = fieldsForProvider('sendgrid');
        const values = resolveFieldValues(USER_DOC, CONFIG);

        for (const name of SENDGRID_RESERVED) {
          assert.ok(!provisioned.includes(name), `${name} is not provisioned as a SendGrid custom field`);
          assert.ok(name in values, `${name} still resolves — Beehiiv provisions it, and addContact reads it`);
        }

        assert.strictEqual(values.user_personal_name_first, 'Ada');
        assert.strictEqual(values.user_personal_name_last, 'Lovelace');
      },
    },

    {
      name: 'a provider skip is honored — Beehiiv keeps its own view of the same catalog',

      run() {
        const beehiiv = fieldsForProvider('beehiiv');

        assert.ok(!beehiiv.includes('user_personal_country'), 'Beehiiv skips country');
        assert.ok(!beehiiv.includes('user_attribution_utm_source'), 'Beehiiv skips utm_source');
        assert.ok(beehiiv.includes('user_personal_name_first'), 'Beehiiv still needs the name fields');
      },
    },

    {
      name: 'SendGrid buildFields writes only the catalog\'s SendGrid view — a skipped field is never written and never warns',

      async run() {
        await withSendgrid(async (sendgrid, warns) => {
          const definitions = fieldDefinitions().custom_fields;
          const idByName = Object.fromEntries(definitions.map((field) => [field.name, field.id]));
          const fields = await sendgrid.buildFields(USER_DOC);

          for (const name of SENDGRID_RESERVED) {
            assert.ok(!(name in idByName), `${name} has no SendGrid custom field to write to`);
          }

          const writtenNames = Object.keys(fields).map((id) => definitions.find((field) => field.id === id).name);

          assert.deepStrictEqual(
            writtenNames.filter((name) => SENDGRID_RESERVED.includes(name)),
            [],
            `A catalog-skipped field must never be written, got ${writtenNames.join(', ')}`,
          );
          assert.deepStrictEqual(
            writtenNames.sort(),
            Object.keys(resolveFieldValues(USER_DOC, CONFIG)).filter((name) => name in idByName).sort(),
            'Every field the catalog provisions for SendGrid is written',
          );
          assert.deepStrictEqual(warns, [], `No unmapped-field warn may fire, got: ${warns.join(' | ')}`);
        });
      },
    },

    {
      name: 'Beehiiv buildFields writes only the catalog\'s Beehiiv view — country and utm_source are never sent',

      run() {
        withConfig(() => {
          const fields = beehiivProvider.buildFields(USER_DOC);
          const displays = fields.map((field) => field.name);

          for (const name of ['user_personal_country', 'user_attribution_utm_source']) {
            assert.ok(
              !displays.includes(FIELDS[name].display),
              `${name} is skipped for Beehiiv and must never be written, got ${displays.join(', ')}`,
            );
          }

          assert.deepStrictEqual(
            displays.sort(),
            fieldsForProvider('beehiiv')
              .filter((name) => name in resolveFieldValues(USER_DOC, CONFIG))
              .map((name) => FIELDS[name].display)
              .sort(),
            'Every field the catalog provisions for Beehiiv is written',
          );
        });
      },
    },
  ],
});
