/**
 * Email identity test — every human/company identity in outbound email comes from
 * config, and a missing one fails LOUDLY.
 *
 * The framework used to ship its author's name, headshot, personal links and the
 * parent company's wordmark/BCC addresses as hardcoded fallbacks, so any brand that
 * had not configured its own identity silently mailed its users as someone else.
 * These checks pin the replacement: config-driven, or a thrown error — never a
 * substituted identity.
 *
 * Plain-node unit test (no emulator, no network).
 */
const assert = require('node:assert');
const { resolvePerson, resolveSignoff } = require('../../dist/manager/libraries/email/prepare.js');
const { footer } = require('../../dist/manager/libraries/email/generators/lib/templates/base.js');
const feedbackTemplate = require('../../dist/manager/libraries/email/generators/lib/templates/feedback.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// The identity the framework used to hardcode. Nothing may ever emit these again.
const FRAMEWORK_IDENTITY = /Ian Wiedenman|ianwiedenman|ianwieds|ITW Creative Works|itwcreativeworks/i;

const brandWithPerson = {
  name: 'Acme',
  company: 'Acme Holdings Inc',
  url: 'https://acme.example',
  contact: {
    email: 'support@acme.example',
    person: {
      name: 'Jane Doe, CEO',
      image: 'https://acme.example/jane.jpg',
      url: 'https://jane.example',
      urlText: '@janedoe',
    },
  },
  images: { companyWordmark: 'https://acme.example/holdings-wordmark.png' },
};

const brandWithoutPerson = { name: 'Acme', contact: { email: 'support@acme.example' } };

// The audit-BCC checks go through the REAL transactional build — a resolver-only test
// would still pass if build() stopped reading the config. Each build runs once and is
// shared by its assertions.
function buildWith(brand, settings) {
  process.env.UNSUBSCRIBE_HMAC_KEY = process.env.UNSUBSCRIBE_HMAC_KEY || 'test-key';

  const Transactional = require('../../dist/manager/libraries/email/transactional/index.js');
  const Manager = {
    config: {
      brand: { id: 'acme', url: 'https://acme.example', images: {}, ...brand },
      // The account's unsubscribe group ids (#649) — every send resolves one from config
      marketing: { campaigns: { providers: { sendgrid: { groups: { orders: 900001, hello: 900002, account: 900003, marketing: 900004, security: 900005, newsletter: 900006, internal: 900007 } } } } },
    },
    project: { websiteUrl: 'https://acme.example' },
    libraries: { admin: {} },
    User: () => ({ properties: {} }),
  };
  const ctx = { Manager, log: () => {}, error: () => {} };

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
  ...brandWithPerson,
  contact: {
    ...brandWithPerson.contact,
    carbonCopy: [
      { email: 'audit@acme.example', name: 'Acme Audit' },
      { email: 'archive@acme.example' },
    ],
  },
}));

let unconfiguredBuild;
const buildUnconfigured = () => (unconfiguredBuild = unconfiguredBuild || buildWith(brandWithPerson));

let malformedBuild;
const buildMalformed = () => (malformedBuild = malformedBuild || buildWith({
  ...brandWithPerson,
  contact: { ...brandWithPerson.contact, carbonCopy: [{ name: 'No Address' }] },
}).catch((error) => error));

module.exports = defineCases({
  description: 'Email identity (person, company, audit BCCs come from config)',
  type: 'group',
  tests: [
    // ---------- Personal signoff: config-driven ----------

    {
      name: 'personal signoff is filled from brand.contact.person',

      run() {
        const out = resolveSignoff({ type: 'personal' }, brandWithPerson);

        assert.equal(out.name, 'Jane Doe, CEO');
        assert.equal(out.image, 'https://acme.example/jane.jpg');
        assert.equal(out.url, 'https://jane.example');
        assert.equal(out.urlText, '@janedoe');
      },
    },

    {
      name: 'an explicit caller signoff still wins over config',

      run() {
        const out = resolveSignoff({ type: 'personal', name: 'Sam Smith, CTO' }, brandWithPerson);

        assert.equal(out.name, 'Sam Smith, CTO');
        // Unspecified fields still come from config.
        assert.equal(out.url, 'https://jane.example');
      },
    },

    {
      name: 'firstName is derived from the brand OWN configured name',

      run() {
        assert.equal(resolvePerson(brandWithPerson).firstName, 'Jane');
      },
    },

    {
      name: 'an explicit firstName wins over the derivation',

      run() {
        const brand = { contact: { person: { name: 'Jonathan Doe, CEO', firstName: 'Jon' } } };

        assert.equal(resolvePerson(brand).firstName, 'Jon');
      },
    },

    {
      name: 'optional person fields are omitted, not substituted',

      run() {
        const brand = { contact: { person: { name: 'Jane Doe' } } };
        const out = resolveSignoff({ type: 'personal' }, brand);

        assert.equal(out.image, null, 'a missing headshot must be null, not a stand-in face');
        assert.equal(out.url, null);
        assert.equal(out.urlText, null);
      },
    },

    // ---------- Personal signoff: loud failure ----------

    {
      name: 'personal signoff with NO configured person throws',

      run() {
        assert.throws(
          () => resolveSignoff({ type: 'personal' }, brandWithoutPerson),
          (error) => error.code === 400 && /brand\.contact\.person\.name/.test(error.message),
          'a missing person must fail loudly',
        );
      },
    },

    {
      name: 'personal signoff with no brand at all throws',

      run() {
        assert.throws(() => resolveSignoff({ type: 'personal' }, undefined), (error) => error.code === 400);
      },
    },

    {
      name: 'the loud failure never leaks the framework identity',

      run() {
        // The whole point: refuse, rather than sign the mail as someone else.
        let thrown;
        try {
          resolveSignoff({ type: 'personal' }, brandWithoutPerson);
        } catch (error) {
          thrown = error;
        }

        assert.ok(thrown, 'expected a throw');
        assert.ok(!FRAMEWORK_IDENTITY.test(thrown.message), `error message leaked an identity: ${thrown.message}`);
      },
    },

    {
      name: 'a team signoff needs no person config (unchanged default path)',

      run() {
        const out = resolveSignoff({}, brandWithoutPerson);

        assert.equal(out.type, 'team');
        assert.equal(out.name, undefined);
      },
    },

    // ---------- Footer: company identity ----------

    {
      name: 'footer renders the configured company name + wordmark',

      run() {
        const out = footer(brandWithPerson, {});

        assert.ok(out.includes('Acme Holdings Inc'), `company name missing: ${out}`);
        assert.ok(out.includes('https://acme.example/holdings-wordmark.png'), 'company wordmark missing');
        assert.ok(!FRAMEWORK_IDENTITY.test(out), 'footer leaked the framework identity');
      },
    },

    {
      name: 'footer falls back to brand.name for the company name (documented schema chain)',

      run() {
        const out = footer({ name: 'Acme', url: 'https://acme.example' }, {});

        assert.ok(out.includes('&copy;') && out.includes('Acme'), `copyright name missing: ${out}`);
        assert.ok(!FRAMEWORK_IDENTITY.test(out), 'footer leaked the framework identity');
      },
    },

    {
      name: 'footer omits the wordmark entirely when unconfigured',

      run() {
        const out = footer({ name: 'Acme', url: 'https://acme.example' }, {});

        assert.ok(!out.includes('<mj-image'), `rendered a wordmark with nothing configured: ${out}`);
      },
    },

    // ---------- Feedback template: no third-party asset host ----------

    {
      name: 'feedback template fetches no image from the framework CDN',

      run() {
        const out = feedbackTemplate.build({
          data: { brand: brandWithPerson, email: { subject: 'Hi' } },
          theme: {},
        });

        assert.ok(!FRAMEWORK_IDENTITY.test(out), 'feedback template leaked the framework identity');
        assert.ok(!/<img/.test(out), `feedback template still loads a hosted image: ${out}`);
      },
    },

    {
      name: 'feedback template still renders all four rating faces',

      run() {
        const out = feedbackTemplate.build({
          data: { brand: brandWithPerson, email: { subject: 'Hi' } },
          theme: {},
        });

        // The glyphs that replaced the hosted PNGs — dislike/neutral/like/love.
        for (const face of ['&#128542;', '&#128528;', '&#128578;', '&#128525;']) {
          assert.ok(out.includes(face), `missing rating face ${face}`);
        }

        for (const rating of ['dislike', 'neutral', 'like', 'love']) {
          assert.ok(out.includes(`rating=${rating}`), `missing rating link for ${rating}`);
        }
      },
    },

    // ---------- Integration: audit BCCs come from config, through the real build ----------

    {
      name: 'built email: audit BCCs come from brand.contact.carbonCopy',

      async run() {
        const configured = await buildConfigured();
        const emails = configured.bcc.map((entry) => entry.email);

        assert.deepEqual(emails, ['audit@acme.example', 'archive@acme.example']);
        assert.equal(configured.bcc[0].name, 'Acme Audit');
        // A nameless entry falls back to the company name, not a framework one.
        assert.equal(configured.bcc[1].name, 'Acme Holdings Inc');
      },
    },

    {
      name: 'built email: no carbonCopy config means NO bcc — never the framework addresses',

      async run() {
        const unconfigured = await buildUnconfigured();

        assert.deepEqual(unconfigured.bcc, [], `unexpected bcc: ${JSON.stringify(unconfigured.bcc)}`);
        assert.ok(!FRAMEWORK_IDENTITY.test(JSON.stringify(unconfigured)), 'built email leaked the framework identity');
      },
    },

    {
      name: 'built email: copy: true still carbon-copies the brand itself (unchanged)',

      async run() {
        const unconfigured = await buildUnconfigured();

        assert.equal(unconfigured.cc[0].email, 'support@acme.example');
      },
    },

    {
      name: 'built email: a carbonCopy entry with no email fails loudly',

      async run() {
        const malformed = await buildMalformed();

        assert.ok(malformed instanceof Error, 'expected a throw');
        assert.equal(malformed.code, 400);
        assert.ok(/carbonCopy/.test(malformed.message), `unhelpful message: ${malformed.message}`);
      },
    },
  ],
});
