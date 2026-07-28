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
 * Run:   node src/manager/libraries/email/identity.test.js
 */
const assert = require('node:assert');
const { resolvePerson, resolveSignoff } = require('./prepare.js');
const { footer } = require('./generators/lib/templates/base.js');

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${label}\n    ${error.message}`);
  }
}

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

// ---------- Personal signoff: config-driven ----------

check('personal signoff is filled from brand.contact.person', () => {
  const out = resolveSignoff({ type: 'personal' }, brandWithPerson);

  assert.equal(out.name, 'Jane Doe, CEO');
  assert.equal(out.image, 'https://acme.example/jane.jpg');
  assert.equal(out.url, 'https://jane.example');
  assert.equal(out.urlText, '@janedoe');
});

check('an explicit caller signoff still wins over config', () => {
  const out = resolveSignoff({ type: 'personal', name: 'Sam Smith, CTO' }, brandWithPerson);

  assert.equal(out.name, 'Sam Smith, CTO');
  // Unspecified fields still come from config.
  assert.equal(out.url, 'https://jane.example');
});

check('firstName is derived from the brand OWN configured name', () => {
  assert.equal(resolvePerson(brandWithPerson).firstName, 'Jane');
});

check('an explicit firstName wins over the derivation', () => {
  const brand = { contact: { person: { name: 'Jonathan Doe, CEO', firstName: 'Jon' } } };

  assert.equal(resolvePerson(brand).firstName, 'Jon');
});

check('optional person fields are omitted, not substituted', () => {
  const brand = { contact: { person: { name: 'Jane Doe' } } };
  const out = resolveSignoff({ type: 'personal' }, brand);

  assert.equal(out.image, null, 'a missing headshot must be null, not a stand-in face');
  assert.equal(out.url, null);
  assert.equal(out.urlText, null);
});

// ---------- Personal signoff: loud failure ----------

check('personal signoff with NO configured person throws', () => {
  assert.throws(
    () => resolveSignoff({ type: 'personal' }, brandWithoutPerson),
    (error) => error.code === 400 && /brand\.contact\.person\.name/.test(error.message),
    'a missing person must fail loudly',
  );
});

check('personal signoff with no brand at all throws', () => {
  assert.throws(() => resolveSignoff({ type: 'personal' }, undefined), (error) => error.code === 400);
});

check('the loud failure never leaks the framework identity', () => {
  // The whole point: refuse, rather than sign the mail as someone else.
  let thrown;
  try {
    resolveSignoff({ type: 'personal' }, brandWithoutPerson);
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, 'expected a throw');
  assert.ok(!FRAMEWORK_IDENTITY.test(thrown.message), `error message leaked an identity: ${thrown.message}`);
});

check('a team signoff needs no person config (unchanged default path)', () => {
  const out = resolveSignoff({}, brandWithoutPerson);

  assert.equal(out.type, 'team');
  assert.equal(out.name, undefined);
});

// ---------- Footer: company identity ----------

check('footer renders the configured company name + wordmark', () => {
  const out = footer(brandWithPerson, {});

  assert.ok(out.includes('Acme Holdings Inc'), `company name missing: ${out}`);
  assert.ok(out.includes('https://acme.example/holdings-wordmark.png'), 'company wordmark missing');
  assert.ok(!FRAMEWORK_IDENTITY.test(out), 'footer leaked the framework identity');
});

check('footer falls back to brand.name for the company name (documented schema chain)', () => {
  const out = footer({ name: 'Acme', url: 'https://acme.example' }, {});

  assert.ok(out.includes('&copy;') && out.includes('Acme'), `copyright name missing: ${out}`);
  assert.ok(!FRAMEWORK_IDENTITY.test(out), 'footer leaked the framework identity');
});

check('footer omits the wordmark entirely when unconfigured', () => {
  const out = footer({ name: 'Acme', url: 'https://acme.example' }, {});

  assert.ok(!out.includes('<mj-image'), `rendered a wordmark with nothing configured: ${out}`);
});

// ---------- Integration: audit BCCs come from config, through the real build ----------

async function integrationChecks() {
  process.env.UNSUBSCRIBE_HMAC_KEY = process.env.UNSUBSCRIBE_HMAC_KEY || 'test-key';

  const Transactional = require('./transactional/index.js');

  const buildWith = (brand, settings) => {
    const Manager = {
      config: { brand: { id: 'acme', url: 'https://acme.example', images: {}, ...brand } },
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
  };

  const configured = await buildWith({
    ...brandWithPerson,
    contact: {
      ...brandWithPerson.contact,
      carbonCopy: [
        { email: 'audit@acme.example', name: 'Acme Audit' },
        { email: 'archive@acme.example' },
      ],
    },
  });

  check('built email: audit BCCs come from brand.contact.carbonCopy', () => {
    const emails = configured.bcc.map((entry) => entry.email);

    assert.deepEqual(emails, ['audit@acme.example', 'archive@acme.example']);
    assert.equal(configured.bcc[0].name, 'Acme Audit');
    // A nameless entry falls back to the company name, not a framework one.
    assert.equal(configured.bcc[1].name, 'Acme Holdings Inc');
  });

  const unconfigured = await buildWith(brandWithPerson);

  check('built email: no carbonCopy config means NO bcc — never the framework addresses', () => {
    assert.deepEqual(unconfigured.bcc, [], `unexpected bcc: ${JSON.stringify(unconfigured.bcc)}`);
    assert.ok(!FRAMEWORK_IDENTITY.test(JSON.stringify(unconfigured)), 'built email leaked the framework identity');
  });

  check('built email: copy: true still carbon-copies the brand itself (unchanged)', () => {
    assert.equal(unconfigured.cc[0].email, 'support@acme.example');
  });

  const malformed = await buildWith({
    ...brandWithPerson,
    contact: { ...brandWithPerson.contact, carbonCopy: [{ name: 'No Address' }] },
  }).catch((error) => error);

  check('built email: a carbonCopy entry with no email fails loudly', () => {
    assert.ok(malformed instanceof Error, 'expected a throw');
    assert.equal(malformed.code, 400);
    assert.ok(/carbonCopy/.test(malformed.message), `unhelpful message: ${malformed.message}`);
  });
}

integrationChecks()
  .catch((error) => {
    failures++;
    console.error(`  ✗ integration checks threw\n    ${error.message}`);
  })
  .then(() => {
    if (failures > 0) {
      console.error(`\n${failures} failure(s)`);
      process.exit(1);
    }
    console.log('\nAll identity checks passed');
  });
