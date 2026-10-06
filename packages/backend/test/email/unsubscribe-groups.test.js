/**
 * Unsubscribe-group resolution test — the ASM group a send attaches comes from
 * CONFIG, never from a constant.
 *
 * SendGrid unsubscribe-group ids are per ACCOUNT, so the seven ids that used to
 * sit in constants.js belonged to one company's account: every other brand sent
 * with ids that do not exist in its own. The manager's campaigns service now
 * provisions the groups by name and writes each id into
 * `marketing.campaigns.providers.sendgrid.groups.<key>`; prepare.js reads it
 * there, and a missing one is a LOUD failure (the manage walk never ran) rather
 * than a silent send under someone else's group
 * ([#649](https://github.com/Omega-JS-Stack/omega/issues/649)).
 *
 * Plain-node unit test (no emulator, no network) — the build path is pure, so
 * the assertions run against the real Transactional.build().
 */
const expect = require('../../dist/vendor/devkit/test/expect.js');
const { GROUP_KEYS, DEFAULT_GROUP_KEY } = require('../../dist/omega/libraries/email/constants.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// This brand's own account ids — deliberately nothing like the ITW ids that
// used to be compiled in.
const GROUP_IDS = {
  orders: 900001,
  hello: 900002,
  account: 900003,
  marketing: 900004,
  security: 900005,
  newsletter: 900006,
  internal: 900007,
};

function makeOmega(groups) {
  return {
    config: {
      brand: { id: 'testbrand', name: 'Test Brand', url: 'https://test.dev', contact: { email: 'hello@test.dev' }, images: {} },
      ...(groups ? { marketing: { campaigns: { providers: { sendgrid: { groups } } } } } : {}),
    },
    project: { websiteUrl: 'https://test.dev' },
    firebase: { admin: {} },
  };
}

function build(settings, { groups = GROUP_IDS } = {}) {
  process.env.UNSUBSCRIBE_HMAC_KEY = process.env.UNSUBSCRIBE_HMAC_KEY || 'test-key';

  const Transactional = require('../../dist/omega/libraries/email/transactional/index.js');
  const omega = makeOmega(groups);
  const ctx = { omega, log: () => {}, error: () => {} };

  return new Transactional(ctx).build({
    to: 'user@test.dev',
    subject: 'Group resolution',
    template: 'card',
    data: { content: { message: 'Hi' } },
    ...settings,
  });
}

module.exports = defineCases({
  description: 'Unsubscribe group ids resolve from config (#649)',
  type: 'group',
  tests: [
    {
      name: 'constants carry KEYS only — no compiled-in ASM ids',

      run() {
        const constants = require('../../dist/omega/libraries/email/constants.js');

        expect(!('GROUPS' in constants), 'the hardcoded id map is gone').toBeTruthy();
        expect(GROUP_KEYS).toEqual(['orders', 'hello', 'account', 'marketing', 'security', 'newsletter', 'internal']);
        for (const sender of Object.values(constants.SENDERS)) {
          expect(GROUP_KEYS.includes(sender.group), `sender names a group KEY, got ${sender.group}`).toBeTruthy();
        }
      },
    },

    {
      name: "a sender's group id comes from this brand's config",

      async run() {
        const email = await build({ sender: 'orders' });

        expect(email.asm.groupId).toBe(GROUP_IDS.orders);
      },
    },

    {
      name: 'every sender category resolves its own configured id',

      async run() {
        const { SENDERS } = require('../../dist/omega/libraries/email/constants.js');

        for (const [sender, config] of Object.entries(SENDERS)) {
          const email = await build({ sender });
          expect(email.asm.groupId, `${sender} attached the wrong group`).toBe(GROUP_IDS[config.group]);
        }
      },
    },

    {
      name: 'a send naming no sender falls back to the configured account group',

      async run() {
        const email = await build({});

        expect(email.asm.groupId).toBe(GROUP_IDS[DEFAULT_GROUP_KEY]);
      },
    },

    {
      name: 'an explicit group KEY resolves from config; a raw id passes through',

      async run() {
        const byKey = await build({ sender: 'orders', group: 'security' });
        expect(byKey.asm.groupId, 'the key won over the sender default').toBe(GROUP_IDS.security);

        const byId = await build({ sender: 'orders', group: 424242 });
        expect(byId.asm.groupId, 'a caller-supplied id is used as-is').toBe(424242);
      },
    },

    {
      name: 'a missing group id fails LOUDLY — it never sends under a guessed group',

      async run() {
        // The programmer error this guards: the manage walk never ran, so the
        // brand has no groups of its own. Sending anyway would attach an id
        // belonging to whichever account it was created in.
        await expect((() => build({ sender: 'orders' }, { groups: null }))()).rejects.toThrow((error) => {
            expect(error.code, 'classed as a build failure').toBe(400);
            expect(error.message, 'names the config path to set').toMatch(/marketing\.campaigns\.providers\.sendgrid\.groups\.orders/);
            return true;
          });
      },
    },

    {
      name: 'one missing key fails even when the others are configured',

      async run() {
        const { security, ...rest } = GROUP_IDS;

        await expect((() => build({ sender: 'security' }, { groups: rest }))()).rejects.toThrow(/groups\.security/);
      },
    },
  ],
});
