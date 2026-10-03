/**
 * domain-providers.test.js: the ONE registry of the domain role's providers,
 * registrars and mailbox providers alike.
 *
 * The registry's members are pinned to the names the strict config schema
 * accepts, so a provider added on one side only fails here; and each mailbox
 * provider's records are pinned as literal values, so the registry that
 * builds them cannot drift them.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

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

// An apex MX of each registry provider, plus one no provider serves
const EXISTING_MX = [
  { id: 'a', type: 'MX', name: DOMAIN, content: 'mx3.mailgun.org' },
  { id: 'b', type: 'MX', name: DOMAIN, content: 'mx1.privateemail.com' },
  { id: 'c', type: 'MX', name: DOMAIN, content: 'route9.mx.cloudflare.net' },
  { id: 'd', type: 'MX', name: DOMAIN, content: 'aspmx.l.google.com' },
];

module.exports = defineCases({
  type: 'group',
  description: 'domain-providers',
  tests: [
    ...(() => {
      const cases = [];
      for (const [role, block] of [['registrar', 'domain.providers'], ['mailbox', 'domain.email.providers']]) {
        cases.push({
          name: `the ${role} registry is exactly the set the schema accepts at ${block}`,
          run: (ctx) => {
            ctx.expect(Object.keys(DOMAIN_PROVIDERS[role]).sort()).toEqual(schemaNames(block));
            for (const name of Object.keys(DOMAIN_PROVIDERS[role])) {
              ctx.expect(undeclaredPaths(withProvider(block, name)), `${block}.${name} loads`).toEqual([]);
            }
            ctx.expect(undeclaredPaths(withProvider(block, 'unlisted'))).toEqual([`${block}.unlisted`]);
          },
        });
      }
      return cases;
    })(),

    {
      name: 'each mailbox provider builds its own MX and SPF include',
      run: (ctx) => {
        const mx = (provider) => buildRequiredRecords(DOMAIN, {}, false, provider)
          .filter((r) => r.type === 'MX')
          .map((r) => [r.content, r.priority, r.comment]);
        const spf = (provider) => buildRequiredRecords(DOMAIN, {}, false, provider)
          .find((r) => r.type === 'TXT' && r.content.includes('v=spf1'))?.content;

        ctx.expect(mx('squarespace')).toEqual([
          ['mxa.mailgun.org', 10, 'Squarespace email forwarding'],
          ['mxb.mailgun.org', 10, 'Squarespace email forwarding'],
        ]);
        ctx.expect(mx('privateemail')).toEqual([
          ['mx1.privateemail.com', 10, 'Private email forwarding (Namecheap)'],
          ['mx2.privateemail.com', 10, 'Private email forwarding (Namecheap)'],
        ]);
        ctx.expect(mx('cloudflare')).toEqual([
          ['route1.mx.cloudflare.net', 36, 'Cloudflare Email Routing'],
          ['route2.mx.cloudflare.net', 4, 'Cloudflare Email Routing'],
          ['route3.mx.cloudflare.net', 24, 'Cloudflare Email Routing'],
        ]);
        ctx.expect(mx(null)).toEqual([]);

        ctx.expect(spf('squarespace')).toBe('"v=spf1 include:mailgun.org ~all"');
        ctx.expect(spf('privateemail')).toBe('"v=spf1 include:spf.privateemail.com ~all"');
        ctx.expect(spf('cloudflare')).toBe('"v=spf1 include:_spf.mx.cloudflare.net ~all"');
        ctx.expect(spf(null)).toBe(undefined);
      },
    },

    {
      name: 'with no mailbox provider picked, no MX record is obsolete',
      run: (ctx) => {
        ctx.expect(findObsoleteMxRecords(EXISTING_MX, DOMAIN, null)).toEqual([]);
      },
    },

    {
      name: "an MX record of another mailbox provider is obsolete, the chosen one's is kept",
      run: (ctx) => {
        const obsolete = (provider) => findObsoleteMxRecords(EXISTING_MX, DOMAIN, provider).map((r) => r.id);

        ctx.expect(obsolete('squarespace')).toEqual(['b', 'c']);
        ctx.expect(obsolete('privateemail')).toEqual(['a', 'c']);
        ctx.expect(obsolete('cloudflare')).toEqual(['a', 'b']);
      },
    },

    {
      name: 'an existing MX record is labelled by the mailbox provider that serves it',
      run: (ctx) => {
        const label = (content, comment = 'kept') => determineComment({ type: 'MX', name: DOMAIN, content, comment }, DOMAIN);

        ctx.expect(label('mxb.mailgun.org')).toBe('Squarespace email forwarding');
        ctx.expect(label('mx2.privateemail.com')).toBe('Private email forwarding (Namecheap)');
        ctx.expect(label('aspmx.l.google.com')).toBe('kept');

        // Email Routing's own records keep the comment they carry; only a bare one is labelled
        ctx.expect(label('route2.mx.cloudflare.net')).toBe('kept');
        ctx.expect(label('route2.mx.cloudflare.net', '')).toBe('Cloudflare Email Routing');
        ctx.expect(label('route2.mx.cloudflare.net', null)).toBe('Cloudflare Email Routing');
      },
    },
  ],
});
