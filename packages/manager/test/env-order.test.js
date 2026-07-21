// Tests for src/lib/env-order.js (cp137) — canonical .env ordering: the
// scaffold stub and every reorder render from ONE group list; machine
// comments regenerate, hand comments travel with their key, unknown keys
// keep order in an Other section, duplicates collapse to the dotenv winner,
// and the whole thing is loss-proof (verbatim lines + value-equality guard).
// Plus the writeEnvValue integration and the workspace env-order op.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CANONICAL_ENV_GROUPS, renderCanonicalEnv, applyEnvOrder } = require('../src/lib/env-order.js');
const { writeEnvValue } = require('../src/lib/env-secret.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-env-order-'));
}

/** key → raw value string, last-wins — mirrors the lib's equality probe. */
function valuesOf(content) {
  const map = new Map();
  for (const line of content.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match) map.set(match[1], match[2]);
  }
  return map;
}

// ─── Canonical render (the scaffold shape) ───────────────────────────────────

test('env-order: render = header, every group in order, placeholders for absent keys', () => {
  const content = renderCanonicalEnv({
    header: ['# Fixture — brand secrets (gitignored; loaded before every omega-manager run).'],
    entries: new Map([['OMEGA_ADMIN_KEY', { raw: 'OMEGA_ADMIN_KEY=abc123' }]]),
  });

  const lines = content.split('\n');
  assert.equal(lines[0], '# Fixture — brand secrets (gitignored; loaded before every omega-manager run).');

  // Groups appear in canonical order, each under its boxed comment
  const groupLines = lines.filter((line) => /^# ── .* ──$/.test(line));
  assert.deepEqual(groupLines, CANONICAL_ENV_GROUPS.map((group) => `# ── ${group.comment} ──`));

  // Present key renders its verbatim line; absent keys render placeholders
  assert.match(content, /^OMEGA_ADMIN_KEY=abc123$/m);
  assert.match(content, /^# OMEGA_WEBHOOK_KEY=$/m);
  assert.match(content, /^# SENTRY_AUTH_TOKEN=$/m);
  assert.match(content, /^# MRLOGO_SERVICE_ACCOUNT=$/m);
  // No Other section when there are no unknown keys
  assert.doesNotMatch(content, /Other keys/);
});

// ─── Reordering an organic file ──────────────────────────────────────────────

const ORGANIC = [
  '# My Brand — brand secrets (gitignored; loaded before every omega-manager run).',
  '',
  '# ── Email marketing (sendgrid + beehiiv services) ──', // stale machine text
  'SENDGRID_API_KEY="sg-1"',
  '',
  'CLOUDFLARE_TOKEN="cf-1"',
  '# hand note: rotated 2026-07',
  'GH_TOKEN="gh-2"',
  '',
  'MY_CUSTOM_THING="custom"',
  '',
  '# Google OAuth (manage cycle)', // hand comment on a duplicate
  'GOOGLE_CLIENT_ID="dup-wins"',
  '',
  'GOOGLE_CLIENT_ID="loses"',
  '',
].join('\n');
// NOTE: the second GOOGLE_CLIENT_ID above is FIRST in dotenv terms? No —
// dotenv.parse takes the LAST assignment, which is "loses" here. The test
// asserts exactly that: last occurrence wins, comments merge onto it.

test('env-order: known keys regroup, stale machine comments regenerate, hand comments travel', () => {
  const { content, changed, skipped, duplicatesCollapsed } = applyEnvOrder(ORGANIC);

  assert.equal(skipped, undefined);
  assert.equal(changed, true);
  assert.equal(duplicatesCollapsed, 1);

  // Effective values survive exactly (last-wins on the duplicate)
  assert.deepEqual([...valuesOf(content)].sort(), [...valuesOf(ORGANIC)].sort());
  assert.equal(valuesOf(content).get('GOOGLE_CLIENT_ID'), '"loses"');
  assert.equal((content.match(/^GOOGLE_CLIENT_ID=/gm) || []).length, 1);

  // The stale group header is regenerated with the canonical text
  assert.doesNotMatch(content, /sendgrid \+ beehiiv services/);
  assert.match(content, /# ── Email marketing \(campaigns \+ newsletter services: SendGrid \+ Beehiiv\) ──/);

  // Hand comments sit directly above their key, wherever the key landed
  const lines = content.split('\n');
  assert.equal(lines[lines.indexOf('GH_TOKEN="gh-2"') - 1], '# hand note: rotated 2026-07');
  assert.equal(lines[lines.indexOf('GOOGLE_CLIENT_ID="loses"') - 1], '# Google OAuth (manage cycle)');

  // Keys are ordered by group: GitHub before Cloudflare before Google before Email
  const order = ['GH_TOKEN=', 'CLOUDFLARE_TOKEN=', 'GOOGLE_CLIENT_ID=', 'SENDGRID_API_KEY='].map(
    (prefix) => lines.findIndex((line) => line.startsWith(prefix)));
  assert.deepEqual([...order].sort((a, b) => a - b), order);

  // Unknown key lands in the Other section, after every canonical group
  const otherAt = lines.indexOf('# ── Other keys (not in the canonical groups) ──');
  assert.notEqual(otherAt, -1);
  assert.ok(lines.indexOf('MY_CUSTOM_THING="custom"') > otherAt);

  // Header kept verbatim at the top
  assert.equal(lines[0], '# My Brand — brand secrets (gitignored; loaded before every omega-manager run).');
});

test('env-order: idempotent — reordering the reordered file changes nothing', () => {
  const first = applyEnvOrder(ORGANIC);
  const second = applyEnvOrder(first.content);
  assert.equal(second.changed, false);
  assert.equal(second.content, first.content);
});

test('env-order: duplicate whose LAST value is empty keeps empty (the dotenv winner)', () => {
  const { content } = applyEnvOrder('GH_TOKEN="real"\nGH_TOKEN=\n');
  assert.equal(valuesOf(content).get('GH_TOKEN'), '');
  assert.equal((content.match(/^GH_TOKEN=/gm) || []).length, 1);
});

test('env-order: unrecognized structure declines untouched (multi-line value)', () => {
  const exotic = 'PRIVATE_KEY="-----BEGIN KEY-----\nabc\n-----END KEY-----"\n';
  const result = applyEnvOrder(exotic);
  assert.match(result.skipped, /not a comment, blank, or single-line/);
  assert.equal(result.changed, false);
  assert.equal(result.content, exotic);
});

test('env-order: a bare file gains the default header; an existing header wins', () => {
  const bare = applyEnvOrder('GH_TOKEN="x"\n', { defaultHeader: ['# Brand X — brand secrets.'] });
  assert.equal(bare.content.split('\n')[0], '# Brand X — brand secrets.');

  const headed = applyEnvOrder('# My own header\n\nGH_TOKEN="x"\n', { defaultHeader: ['# Brand X — brand secrets.'] });
  assert.equal(headed.content.split('\n')[0], '# My own header');
});

// ─── writeEnvValue integration ───────────────────────────────────────────────

test('env-order: writeEnvValue lands the value AND leaves the file canonically ordered', () => {
  const root = tmpdir();
  try {
    fs.writeFileSync(path.join(root, '.env'), 'SENDGRID_API_KEY="sg"\nEXISTING_KEY="keep-me"\n');
    writeEnvValue(root, 'CLOUDFLARE_TOKEN', 'cf');

    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    assert.match(env, /^CLOUDFLARE_TOKEN="cf"$/m);
    assert.match(env, /^SENDGRID_API_KEY="sg"$/m);
    assert.match(env, /^EXISTING_KEY="keep-me"$/m);
    // Ordered: Cloudflare group before Email marketing, unknown key in Other
    const lines = env.split('\n');
    assert.ok(lines.findIndex((l) => l.startsWith('CLOUDFLARE_TOKEN=')) < lines.findIndex((l) => l.startsWith('SENDGRID_API_KEY=')));
    assert.ok(lines.indexOf('EXISTING_KEY="keep-me"') > lines.indexOf('# ── Other keys (not in the canonical groups) ──'));
    // Idempotent under the reorderer
    assert.equal(applyEnvOrder(env).changed, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ─── The workspace env-order op ──────────────────────────────────────────────

const envOrderOp = require('../src/services/workspace/ensure/env-order.js');

function opContext(overrides = {}) {
  return {
    brandConfig: { brand: { name: 'Fixture Brand' } },
    options: {},
    ...overrides,
  };
}

test('workspace env-order op: reorders brand AND company .env files', async () => {
  const brandRoot = tmpdir();
  const companyRoot = tmpdir();
  try {
    fs.writeFileSync(path.join(brandRoot, '.env'), 'SENDGRID_API_KEY="sg"\nGH_TOKEN="gh"\n');
    fs.writeFileSync(path.join(companyRoot, '.env'), 'CSC_KEY_PASSWORD="pw"\nAPPLE_TEAM_ID="team"\n');

    const result = await envOrderOp(opContext({ brandRoot, companyRoot }));
    assert.deepEqual(result.output.envOrder, { brand: 'reordered', company: 'reordered' });

    const brandEnv = fs.readFileSync(path.join(brandRoot, '.env'), 'utf8');
    // The bare brand file gained the brand-named default header
    assert.equal(brandEnv.split('\n')[0], '# Fixture Brand — brand secrets (gitignored; loaded before every omega run).');
    const lines = brandEnv.split('\n');
    assert.ok(lines.findIndex((l) => l.startsWith('GH_TOKEN=')) < lines.findIndex((l) => l.startsWith('SENDGRID_API_KEY=')));

    const companyEnv = fs.readFileSync(path.join(companyRoot, '.env'), 'utf8');
    assert.ok(companyEnv.split('\n').findIndex((l) => l.startsWith('APPLE_TEAM_ID=')) <
      companyEnv.split('\n').findIndex((l) => l.startsWith('CSC_KEY_PASSWORD=')));

    // Converged rerun: both current, byte-identical files
    const rerun = await envOrderOp(opContext({ brandRoot, companyRoot }));
    assert.deepEqual(rerun.output.envOrder, { brand: 'current', company: 'current' });
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
    fs.rmSync(companyRoot, { recursive: true, force: true });
  }
});

test('workspace env-order op: dry run plans, writes nothing; missing files noted', async () => {
  const brandRoot = tmpdir();
  try {
    const before = 'SENDGRID_API_KEY="sg"\nGH_TOKEN="gh"\n';
    fs.writeFileSync(path.join(brandRoot, '.env'), before);

    const result = await envOrderOp(opContext({ brandRoot, options: { dryRun: true } }));
    assert.deepEqual(result.output.envOrder, { brand: 'planned' });
    assert.equal(fs.readFileSync(path.join(brandRoot, '.env'), 'utf8'), before);

    fs.rmSync(path.join(brandRoot, '.env'));
    const missing = await envOrderOp(opContext({ brandRoot }));
    assert.deepEqual(missing.output.envOrder, { brand: 'missing' });
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});
