/**
 * copy-legacy-env tests — parsing (incl. quoted multi-line values), key
 * selection, the idempotent copy plan, and the no-value-leak guarantee.
 * Run: node --test scripts/copy-legacy-env.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { KEY_GROUPS, parseEnvEntries, selectKeys, planCopy, parseArgs } = require('./copy-legacy-env.js');

const SOURCE = [
  '# legacy secrets',
  'CLOUDFLARE_TOKEN=cf-secret-123',
  'SENDGRID_API_KEY="sg-secret"',
  'MULTILINE_KEY="line one',
  'line two"',
  '',
  'NAMECHEAP_API_KEY=nc-secret',
  'NAMECHEAP_USERNAME=ian',
].join('\n');

test('parseEnvEntries: keys, quoted values, multi-line blocks verbatim', () => {
  const entries = parseEnvEntries(SOURCE);
  assert.equal(entries.get('CLOUDFLARE_TOKEN'), 'CLOUDFLARE_TOKEN=cf-secret-123');
  assert.equal(entries.get('SENDGRID_API_KEY'), 'SENDGRID_API_KEY="sg-secret"');
  assert.equal(entries.get('MULTILINE_KEY'), 'MULTILINE_KEY="line one\nline two"');
  assert.equal(entries.has('#'), false);
});

test('selectKeys: core by default, groups add, --only wins', () => {
  assert.deepEqual(selectKeys({}), KEY_GROUPS.core);
  assert.ok(selectKeys({ include: 'signing' }).includes('APPLE_TEAM_ID'));
  assert.ok(selectKeys({ include: 'signing,stores' }).includes('CHROME_CLIENT_ID'));
  assert.deepEqual(selectKeys({ only: 'CLOUDFLARE_TOKEN, GH_TOKEN' }), ['CLOUDFLARE_TOKEN', 'GH_TOKEN']);
  assert.throws(() => selectKeys({ include: 'payment' }), /Unknown group/);
});

test('planCopy: copies missing, keeps existing, reports absent-in-source', () => {
  const dest = 'GOOGLE_CLIENT_ID=existing\nCLOUDFLARE_TOKEN=old-token\n';
  const plan = planCopy(SOURCE, dest, ['CLOUDFLARE_TOKEN', 'SENDGRID_API_KEY', 'BEEHIIV_API_KEY']);

  const byKey = Object.fromEntries(plan.actions.map((a) => [a.key, a.action]));
  assert.equal(byKey.CLOUDFLARE_TOKEN, 'kept');
  assert.equal(byKey.SENDGRID_API_KEY, 'copied');
  assert.equal(byKey.BEEHIIV_API_KEY, 'missing');

  assert.ok(plan.changed);
  assert.ok(plan.content.includes('CLOUDFLARE_TOKEN=old-token')); // untouched
  assert.ok(plan.content.includes('SENDGRID_API_KEY="sg-secret"'));
  assert.ok(plan.content.includes('copied from legacy omega-manager/.env'));
});

test('planCopy: --force replaces in place, no duplicate key lines', () => {
  const dest = 'CLOUDFLARE_TOKEN=old-token\nOTHER=x\n';
  const plan = planCopy(SOURCE, dest, ['CLOUDFLARE_TOKEN'], { force: true });

  assert.equal(plan.actions[0].action, 'replaced');
  assert.ok(plan.content.includes('CLOUDFLARE_TOKEN=cf-secret-123'));
  assert.ok(!plan.content.includes('old-token'));
  assert.equal(plan.content.match(/CLOUDFLARE_TOKEN=/g).length, 1);
});

test('planCopy: fully-satisfied destination is a no-op (idempotent)', () => {
  const dest = 'CLOUDFLARE_TOKEN=already\n';
  const plan = planCopy(SOURCE, dest, ['CLOUDFLARE_TOKEN']);
  assert.equal(plan.changed, false);
  assert.equal(plan.content, dest);
});

test('multi-line values copy as one intact block', () => {
  const plan = planCopy(SOURCE, '', ['MULTILINE_KEY']);
  assert.ok(plan.content.includes('MULTILINE_KEY="line one\nline two"'));
});

test('parseArgs: defaults + every flag form', () => {
  const args = parseArgs(['--brand=brands/x', '--force', '--dry-run', '--include=signing', '--source=/tmp/e']);
  assert.equal(args.brand, 'brands/x');
  assert.equal(args.force, true);
  assert.equal(args.dryRun, true);
  assert.equal(args.include, 'signing');
  assert.equal(args.source, '/tmp/e');
  assert.throws(() => parseArgs(['--nope']), /Unknown argument/);

  const defaults = parseArgs([]);
  assert.equal(defaults.brand, 'brands/playground-omega');
  assert.match(defaults.source, /omega-manager\/\.env$/);
});

test('action labels never include values — only key names reach stdout', () => {
  // The printing path only ever interpolates ACTION_LABELS[action] and key;
  // this guards the plan structure that feeds it: actions carry key+action
  // ONLY, no value field to leak.
  const plan = planCopy(SOURCE, '', ['CLOUDFLARE_TOKEN']);
  assert.deepEqual(Object.keys(plan.actions[0]).sort(), ['action', 'key']);
});
