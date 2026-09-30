/**
 * copy-legacy-env tests: key selection, the idempotent copy plan written in
 * the one KEY="value" form (quoted multi-line values included), and the
 * no-value-leak guarantee.
 * Run: node --test scripts/copy-legacy-env.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const dotenv = require('dotenv');

const { KEY_GROUPS, selectKeys, planCopy, parseArgs } = require('./copy-legacy-env.js');

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
});

test('planCopy: --force replaces in place, no duplicate key lines', () => {
  const dest = 'CLOUDFLARE_TOKEN=old-token\nOTHER=x\n';
  const plan = planCopy(SOURCE, dest, ['CLOUDFLARE_TOKEN'], { force: true });

  assert.equal(plan.actions[0].action, 'replaced');
  assert.equal(plan.content, 'CLOUDFLARE_TOKEN="cf-secret-123"\nOTHER=x\n');
  assert.equal(plan.content.match(/CLOUDFLARE_TOKEN=/g).length, 1);
});

test('planCopy: fully-satisfied destination is a no-op (idempotent)', () => {
  const dest = 'CLOUDFLARE_TOKEN=already\n';
  const plan = planCopy(SOURCE, dest, ['CLOUDFLARE_TOKEN']);
  assert.equal(plan.changed, false);
  assert.equal(plan.content, dest);
});

test('multi-line values copy as one line that reads back whole', () => {
  const plan = planCopy(SOURCE, '', ['MULTILINE_KEY']);
  assert.equal(plan.content, 'MULTILINE_KEY="line one\\nline two"\n');
  assert.equal(dotenv.parse(plan.content).MULTILINE_KEY, 'line one\nline two');
});

test('planCopy: an empty source value is not there to copy', () => {
  const plan = planCopy('CLOUDFLARE_TOKEN=""\n', 'CLOUDFLARE_TOKEN="real"\n', ['CLOUDFLARE_TOKEN'], { force: true });
  assert.equal(plan.actions[0].action, 'missing');
  assert.equal(plan.changed, false);
});

test('planCopy: --force copies $ patterns in a secret literally', () => {
  const source = 'CLOUDFLARE_TOKEN="a$$b"\nSENDGRID_API_KEY="c$&d"\n';
  const dest = 'CLOUDFLARE_TOKEN="old-token"\nSENDGRID_API_KEY="old-key"\n';
  const plan = planCopy(source, dest, ['CLOUDFLARE_TOKEN', 'SENDGRID_API_KEY'], { force: true });

  const read = dotenv.parse(plan.content);
  assert.equal(read.CLOUDFLARE_TOKEN, 'a$$b');
  assert.equal(read.SENDGRID_API_KEY, 'c$&d');
});

test('planCopy: a # KEY="" placeholder takes the value on its own line', () => {
  const dest = '# CLOUDFLARE_TOKEN=""\nOTHER="x"\n';
  const plan = planCopy(SOURCE, dest, ['CLOUDFLARE_TOKEN']);

  assert.equal(plan.actions[0].action, 'copied');
  assert.equal(plan.content, 'CLOUDFLARE_TOKEN="cf-secret-123"\nOTHER="x"\n');
});

test('planCopy: an empty destination value never claims the key', () => {
  const plan = planCopy(SOURCE, 'CLOUDFLARE_TOKEN=""\n', ['CLOUDFLARE_TOKEN']);

  assert.equal(plan.actions[0].action, 'copied');
  assert.equal(plan.content, 'CLOUDFLARE_TOKEN="cf-secret-123"\n');
});

test('planCopy: a source value envLine refuses throws naming the key', () => {
  const source = "CLOUDFLARE_TOKEN='a\\nb'\n";
  assert.throws(() => planCopy(source, '', ['CLOUDFLARE_TOKEN']), /CLOUDFLARE_TOKEN/);
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
