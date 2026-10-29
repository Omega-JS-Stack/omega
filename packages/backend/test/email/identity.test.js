/**
 * Email identity test: every company identity in outbound email comes from
 * config, a missing one fails LOUDLY, and a signoff names no one the caller did not.
 *
 * The framework used to ship its author's name, headshot, personal links and the
 * parent company's wordmark/BCC addresses as hardcoded fallbacks, so any brand that
 * had not configured its own identity silently mailed its users as someone else.
 * These checks pin the replacement: config-driven, or a thrown error — never a
 * substituted identity.
 *
 * Plain-node unit test (no emulator, no network).
 */
const expect = require('../../dist/vendor/devkit/test/expect.js');
const prepare = require('../../dist/omega/libraries/email/prepare.js');

const { resolveSignoff } = prepare;
const { footer } = require('../../dist/omega/libraries/email/generators/lib/templates/base.js');
const feedbackTemplate = require('../../dist/omega/libraries/email/generators/lib/templates/feedback.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// The identity the framework used to hardcode. Nothing may ever emit these again.
const FRAMEWORK_IDENTITY = /Ian Wiedenman|ianwiedenman|ianwieds|ITW Creative Works|itwcreativeworks/i;

const BRAND = {
  name: 'Acme',
  url: 'https://acme.example',
  contact: { email: 'support@acme.example' },
  images: {},
};

// The RESOLVED company (#677): the loader fills it from `company: { id }`, and
// a brand with no company resolves to its own name, so the footer never
// carries a fallback of its own.
const COMPANY = { id: 'acme-holdings', name: 'Acme Holdings Inc', url: 'https://acmeholdings.example', images: { wordmark: 'https://acme.example/holdings-wordmark.png' } };

// The audit-BCC checks go through the REAL transactional build — a resolver-only test
// would still pass if build() stopped reading the config. Each build runs once and is
// shared by its assertions.
function buildWith(brand, settings) {
  process.env.UNSUBSCRIBE_HMAC_KEY = process.env.UNSUBSCRIBE_HMAC_KEY || 'test-key';

  const Transactional = require('../../dist/omega/libraries/email/transactional/index.js');
  const omega = {
    config: {
      brand: { id: 'acme', url: 'https://acme.example', images: {}, ...brand },
      company: structuredClone(COMPANY),
      // The account's unsubscribe group ids (#649) — every send resolves one from config
      marketing: { campaigns: { providers: { sendgrid: { groups: { orders: 900001, hello: 900002, account: 900003, marketing: 900004, security: 900005, newsletter: 900006, internal: 900007 } } } } },
    },
    project: { websiteUrl: 'https://acme.example' },
    firebase: { admin: {} },
  };
  const ctx = { omega, log: () => {}, error: () => {} };

  return new Transactional(ctx).build({
    to: 'user@acme.example',
    subject: 'Hi',
    template: 'card',
    copy: true,
    ...settings,
  });
}

let configuredBuild;
const buildConfigured = () => (configuredBuild = configuredBuild || buildWith({
  ...BRAND,
  contact: {
    ...BRAND.contact,
    carbonCopy: [
      { email: 'audit@acme.example', name: 'Acme Audit' },
      { email: 'archive@acme.example' },
    ],
  },
}));

let unconfiguredBuild;
const buildUnconfigured = () => (unconfiguredBuild = unconfiguredBuild || buildWith(BRAND));

let malformedBuild;
const buildMalformed = () => (malformedBuild = malformedBuild || buildWith({
  ...BRAND,
  contact: { ...BRAND.contact, carbonCopy: [{ name: 'No Address' }] },
}).catch((error) => error));

module.exports = defineCases({
  description: 'Email identity (signoff, company, audit BCCs come from config)',
  type: 'group',
  tests: [
    // ---------- Signoff: the caller's, or the team ----------

    {
      name: 'an explicit caller signoff passes through as given',

      run() {
        const out = resolveSignoff({ type: 'personal', name: 'Sam Smith, CTO' });

        expect(out.type).toBe('personal');
        expect(out.name).toBe('Sam Smith, CTO');
        // Nothing the caller left out is filled in from anywhere
        expect([out.image, out.url, out.urlText].every((value) => value == null), `filled a field the caller left out: ${JSON.stringify(out)}`).toBeTruthy();
      },
    },

    {
      name: 'no signoff is the team default',

      run() {
        for (const out of [resolveSignoff(), resolveSignoff({})]) {
          expect(out.type).toBe('team');
          expect(out.name).toBe(undefined);
        }
      },
    },

    {
      name: 'the team default never carries the framework identity',

      run() {
        const out = resolveSignoff();

        expect(!FRAMEWORK_IDENTITY.test(JSON.stringify(out)), `team signoff leaked an identity: ${JSON.stringify(out)}`).toBeTruthy();
      },
    },

    {
      name: 'resolvePerson is not exported: no person is resolved from config',

      run() {
        expect('resolvePerson' in prepare, 'prepare.js still exports resolvePerson').toBe(false);
      },
    },

    // ---------- Footer: company identity ----------

    {
      name: 'footer renders the resolved company name + wordmark',

      run() {
        const out = footer(BRAND, {}, COMPANY);

        expect(out.includes('Acme Holdings Inc'), `company name missing: ${out}`).toBeTruthy();
        expect(out.includes('https://acme.example/holdings-wordmark.png'), 'company wordmark missing').toBeTruthy();
        expect(!FRAMEWORK_IDENTITY.test(out), 'footer leaked the framework identity').toBeTruthy();
      },
    },

    {
      name: 'footer falls back to brand.name when the company resolved nothing',

      run() {
        const out = footer({ name: 'Acme', url: 'https://acme.example' }, {}, {});

        expect(out.includes('&copy;') && out.includes('Acme'), `copyright name missing: ${out}`).toBeTruthy();
        expect(!FRAMEWORK_IDENTITY.test(out), 'footer leaked the framework identity').toBeTruthy();
      },
    },

    {
      name: 'footer omits the wordmark entirely when unconfigured',

      run() {
        const out = footer({ name: 'Acme', url: 'https://acme.example' }, {}, {});

        expect(!out.includes('<mj-image'), `rendered a wordmark with nothing configured: ${out}`).toBeTruthy();
      },
    },

    // ---------- Feedback template: no third-party asset host ----------

    {
      name: 'feedback template fetches no image from the framework CDN',

      run() {
        const out = feedbackTemplate.build({
          data: { brand: BRAND, email: { subject: 'Hi' } },
          theme: {},
        });

        expect(!FRAMEWORK_IDENTITY.test(out), 'feedback template leaked the framework identity').toBeTruthy();
        expect(!/<img/.test(out), `feedback template still loads a hosted image: ${out}`).toBeTruthy();
      },
    },

    {
      name: 'feedback template still renders all four rating faces',

      run() {
        const out = feedbackTemplate.build({
          data: { brand: BRAND, email: { subject: 'Hi' } },
          theme: {},
        });

        // The glyphs that replaced the hosted PNGs — dislike/neutral/like/love.
        for (const face of ['&#128542;', '&#128528;', '&#128578;', '&#128525;']) {
          expect(out.includes(face), `missing rating face ${face}`).toBeTruthy();
        }

        for (const rating of ['dislike', 'neutral', 'like', 'love']) {
          expect(out.includes(`rating=${rating}`), `missing rating link for ${rating}`).toBeTruthy();
        }
      },
    },

    // ---------- Integration: audit BCCs come from config, through the real build ----------

    {
      name: 'built email: audit BCCs come from brand.contact.carbonCopy',

      async run() {
        const configured = await buildConfigured();
        const emails = configured.bcc.map((entry) => entry.email);

        expect(emails).toEqual(['audit@acme.example', 'archive@acme.example']);
        expect(configured.bcc[0].name).toBe('Acme Audit');
        // A nameless entry falls back to the company name, not a framework one.
        expect(configured.bcc[1].name).toBe('Acme Holdings Inc');
      },
    },

    {
      name: 'built email: no carbonCopy config means NO bcc — never the framework addresses',

      async run() {
        const unconfigured = await buildUnconfigured();

        expect(unconfigured.bcc, `unexpected bcc: ${JSON.stringify(unconfigured.bcc)}`).toEqual([]);
        expect(!FRAMEWORK_IDENTITY.test(JSON.stringify(unconfigured)), 'built email leaked the framework identity').toBeTruthy();
      },
    },

    {
      name: 'built email: copy: true still carbon-copies the brand itself (unchanged)',

      async run() {
        const unconfigured = await buildUnconfigured();

        expect(unconfigured.cc[0].email).toBe('support@acme.example');
      },
    },

    {
      name: 'built email: a carbonCopy entry with no email fails loudly',

      async run() {
        const malformed = await buildMalformed();

        expect(malformed instanceof Error, 'expected a throw').toBeTruthy();
        expect(malformed.code).toBe(400);
        expect(/carbonCopy/.test(malformed.message), `unhelpful message: ${malformed.message}`).toBeTruthy();
      },
    },
  ],
});
