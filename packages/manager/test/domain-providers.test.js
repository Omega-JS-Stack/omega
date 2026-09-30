/**
 * domain-providers.test.js: the ONE registry of the domain role's providers,
 * registrars and mailbox providers alike.
 *
 * The registry's members are pinned to the names the strict config schema
 * accepts, so a provider added on one side only fails here; and each mailbox
 * provider's records are pinned as literal values, so the registry that
 * builds them cannot drift them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { SHARED_SCHEMA, undeclaredPaths } = require('@omega.js/config');
const { DOMAIN_PROVIDERS } = require('../src/services/domain/lib/providers.js');
const { buildRequiredRecords, findObsoleteMxRecords, determineComment } = require('../src/services/edge/lib/dns-records-helpers.js');

const DOMAIN = 'example.com';

// The provider names the schema declares one row each under a providers block
function schemaNames(block) {
  return SHARED_SCHEMA
    .map((rule) => rule.path)
    .filter((path) => path.startsWith(`${block}.`))
    .map((path) => path.slice(block.length + 1))
    .filter((name) => !name.includes('.'))
    .sort();
}

function withProvider(block, name) {
  const config = {};
  const keys = block.split('.');
  keys.reduce((node, key) => (node[key] = {}), config)[name] = {};
  return config;
}

for (const [role, block] of [['registrar', 'domain.providers'], ['mailbox', 'domain.email.providers']]) {
  test(`the ${role} registry is exactly the set the schema accepts at ${block}`, () => {
    assert.deepEqual(Object.keys(DOMAIN_PROVIDERS[role]).sort(), schemaNames(block));
    for (const name of Object.keys(DOMAIN_PROVIDERS[role])) {
      assert.deepEqual(undeclaredPaths(withProvider(block, name)), [], `${block}.${name} loads`);
    }
    assert.deepEqual(undeclaredPaths(withProvider(block, 'unlisted')), [`${block}.unlisted`]);
  });
}

test('each mailbox provider builds its own MX and SPF include', () => {
  const mx = (provider) => buildRequiredRecords(DOMAIN, {}, false, provider)
    .filter((r) => r.type === 'MX')
    .map((r) => [r.content, r.priority, r.comment]);
  const spf = (provider) => buildRequiredRecords(DOMAIN, {}, false, provider)
    .find((r) => r.type === 'TXT' && r.content.includes('v=spf1'))?.content;

  assert.deepEqual(mx('squarespace'), [
    ['mxa.mailgun.org', 10, 'Squarespace email forwarding'],
    ['mxb.mailgun.org', 10, 'Squarespace email forwarding'],
  ]);
  assert.deepEqual(mx('privateemail'), [
    ['mx1.privateemail.com', 10, 'Private email forwarding (Namecheap)'],
    ['mx2.privateemail.com', 10, 'Private email forwarding (Namecheap)'],
  ]);
  assert.deepEqual(mx('cloudflare'), [
    ['route1.mx.cloudflare.net', 36, 'Cloudflare Email Routing'],
    ['route2.mx.cloudflare.net', 4, 'Cloudflare Email Routing'],
    ['route3.mx.cloudflare.net', 24, 'Cloudflare Email Routing'],
  ]);
  assert.deepEqual(mx(null), []);

  assert.equal(spf('squarespace'), '"v=spf1 include:mailgun.org ~all"');
  assert.equal(spf('privateemail'), '"v=spf1 include:spf.privateemail.com ~all"');
  assert.equal(spf('cloudflare'), '"v=spf1 include:_spf.mx.cloudflare.net ~all"');
  assert.equal(spf(null), undefined);
});

test("an MX record of another mailbox provider is obsolete, the chosen one's is kept", () => {
  const existing = [
    { id: 'a', type: 'MX', name: DOMAIN, content: 'mx3.mailgun.org' },
    { id: 'b', type: 'MX', name: DOMAIN, content: 'mx1.privateemail.com' },
    { id: 'c', type: 'MX', name: DOMAIN, content: 'route9.mx.cloudflare.net' },
    { id: 'd', type: 'MX', name: DOMAIN, content: 'aspmx.l.google.com' },
  ];
  const obsolete = (provider) => findObsoleteMxRecords(existing, DOMAIN, provider).map((r) => r.id);

  assert.deepEqual(obsolete('squarespace'), ['b', 'c']);
  assert.deepEqual(obsolete('privateemail'), ['a', 'c']);
  assert.deepEqual(obsolete('cloudflare'), ['a', 'b']);
  assert.deepEqual(obsolete(null), ['a', 'b', 'c']);
});

test('an existing MX record is labelled by the mailbox provider that serves it', () => {
  const label = (content, comment = 'kept') => determineComment({ type: 'MX', name: DOMAIN, content, comment }, DOMAIN);

  assert.equal(label('mxb.mailgun.org'), 'Squarespace email forwarding');
  assert.equal(label('mx2.privateemail.com'), 'Private email forwarding (Namecheap)');
  assert.equal(label('aspmx.l.google.com'), 'kept');

  // Email Routing's own records keep the comment they carry; only a bare one is labelled
  assert.equal(label('route2.mx.cloudflare.net'), 'kept');
  assert.equal(label('route2.mx.cloudflare.net', ''), 'Cloudflare Email Routing');
  assert.equal(label('route2.mx.cloudflare.net', null), 'Cloudflare Email Routing');
});
