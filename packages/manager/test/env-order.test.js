// Tests for src/lib/env-order.js: the brand and company .env run through the
// ONE marker engine. The template is the Default section (header, canonical
// groups, `# KEY=""` placeholders), Custom is its bare marker, and every writer
// (the scaffold stubs, writeEnvValue, the workspace env-order op) converges
// through it without losing a value.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');

const { envKeysForTarget } = require('@omega.js/config');
const { DEFAULT_MARKER, CUSTOM_MARKER } = require('@omega.js/devkit/merge-line-files');

const { renderEnvTemplate, convergeEnv } = require('../src/lib/env-order.js');
const { writeEnvValue } = require('../src/lib/env-secret.js');
const { buildScaffoldPlan } = require('../src/lib/scaffold.js');
const { buildCompanyScaffoldPlan } = require('../src/lib/company-scaffold.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-env-order-'));
}

/** The values the loader sees: dotenv's parse, empty values dropped. */
function effective(content) {
  return Object.fromEntries(Object.entries(dotenv.parse(content)).filter(([, value]) => value !== ''));
}

/** [Default section, Custom section] of a marked file. */
function sections(content) {
  const at = content.indexOf(CUSTOM_MARKER);
  assert.notEqual(at, -1, 'the file carries the Custom marker');
  return [content.slice(0, at), content.slice(at + CUSTOM_MARKER.length + 1)];
}

// ─── The template ────────────────────────────────────────────────────────────

test('env-order: the template is Default (header, groups, placeholders) then a bare Custom marker', () => {
  const content = renderEnvTemplate({ OMEGA_ADMIN_KEY: 'abc123' });
  const lines = content.split('\n');

  assert.equal(lines[0], DEFAULT_MARKER);
  assert.ok(content.endsWith(`\n\n${CUSTOM_MARKER}\n`), 'nothing under the Custom marker');

  // Groups in schema order, a set value rendered quoted, absent keys as placeholders
  const order = ['OMEGA_LICENSE_KEY', 'OMEGA_ADMIN_KEY', 'GH_TOKEN', 'CLOUDFLARE_TOKEN', 'SENDGRID_API_KEY', 'ACCOUNT_PASSWORD_SEED']
    .map((key) => lines.findIndex((line) => line.replace(/^# /, '').startsWith(`${key}=`)));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(content, /^OMEGA_ADMIN_KEY="abc123"$/m);
  assert.match(content, /^# OMEGA_WEBHOOK_KEY=""$/m);
  assert.match(content, /^# ── Cloudflare /m);
  assert.doesNotMatch(content, /Other keys/);
});

test('env-order: every key the backend composer knows has a template placeholder (#502)', () => {
  const content = renderEnvTemplate();

  const missing = envKeysForTarget('backend').filter((key) => !new RegExp(`^(# )?${key}=`, 'm').test(content));
  assert.deepEqual(missing, [], `backend composition keys with no template line: ${missing.join(', ')}`);
});

// ─── The first converge of an unmarked file ──────────────────────────────────

const EM_DASH = String.fromCharCode(0x2014);

// Fake values throughout; the shape is an organic pre-marker brand .env
const UNMARKED = [
  `# My Brand ${EM_DASH} brand secrets (gitignored; loaded before every omega-manager run).`,
  '# Uncomment and fill what this brand uses. Services without their credentials',
  '# skip cleanly, so add these as the brand adopts each service.',
  '',
  '# Keep this file out of screenshots.',
  '',
  '# ── Email marketing (sendgrid + beehiiv services) ──',
  'SENDGRID_API_KEY="sg-1"',
  '',
  'CLOUDFLARE_TOKEN=cf-raw-1',
  '# hand note: rotated last spring',
  'GH_TOKEN="gh-2"',
  "GOOGLE_CLIENT_ID='single-quoted'",
  'SENTRY_AUTH_TOKEN=',
  '# STRIPE_SECRET_KEY=',
  'OMEGA_ADMIN_KEY="admin-fake"',
  '',
  '# A standalone note between groups',
  '# spanning two lines',
  '',
  '# OLD_STRIPE_KEY=sk_live_old',
  '',
  '# ── Auto-generated and persisted on the first real run ──',
  '# The GA4 Measurement Protocol secrets are per target (the analytics service resolves',
  '# one per stream; disperse composes each target its own GOOGLE_ANALYTICS_SECRET), and the',
  '# VAPID private key is the half the Firebase console only ever shows you once.',
  '# ACCOUNT_PASSWORD_SEED=',
  '',
  '# one per stream; disperse composes each target its own GOOGLE_ANALYTICS_SECRET), and the',
  '',
  '# ── Other keys (not in the canonical groups) ──',
  '# my own note on my own key',
  'MY_CUSTOM_THING="custom"',
  'OAUTH2_GOOGLE_CLIENT_ID="legacy-oauth"',
  'STALE_EMPTY=',
  '',
  '# trailing note',
  '',
].join('\n');

test('env-order: an unmarked file converges with every value kept, known keys in Default, the rest in Custom', () => {
  const { content, changed, skipped } = convergeEnv(UNMARKED);

  assert.equal(skipped, undefined);
  assert.equal(changed, true);
  assert.deepEqual(effective(content), {
    SENDGRID_API_KEY: 'sg-1',
    CLOUDFLARE_TOKEN: 'cf-raw-1',
    GH_TOKEN: 'gh-2',
    GOOGLE_CLIENT_ID: 'single-quoted',
    OMEGA_ADMIN_KEY: 'admin-fake',
    MY_CUSTOM_THING: 'custom',
    OAUTH2_GOOGLE_CLIENT_ID: 'legacy-oauth',
  });

  const [defaults, custom] = sections(content);
  assert.equal(content.split('\n')[0], DEFAULT_MARKER);
  for (const line of ['SENDGRID_API_KEY="sg-1"', 'CLOUDFLARE_TOKEN="cf-raw-1"', 'GH_TOKEN="gh-2"', 'GOOGLE_CLIENT_ID="single-quoted"', 'OMEGA_ADMIN_KEY="admin-fake"']) {
    assert.ok(defaults.split('\n').includes(line), `${line} sits in Default`);
  }
  // Every consumer comment and every key the template does not know land under
  // Custom in file order, paragraphs kept; the framework's old header, group
  // headers and group notes (stale wordings included) stay behind
  assert.equal(custom, [
    '# Keep this file out of screenshots.',
    '',
    '# A standalone note between groups',
    '# spanning two lines',
    '',
    '# OLD_STRIPE_KEY=sk_live_old',
    '',
    '# my own note on my own key',
    'MY_CUSTOM_THING="custom"',
    'OAUTH2_GOOGLE_CLIENT_ID="legacy-oauth"',
    '',
    '# trailing note',
    '',
  ].join('\n'));

  // Default is the template's: stale group text regenerated, an empty known key back to its placeholder
  assert.doesNotMatch(content, /sendgrid \+ beehiiv services|Other keys|brand secrets|disperse composes/);
  assert.match(defaults, /^# SENTRY_AUTH_TOKEN=""$/m);
  assert.match(defaults, /^# STRIPE_SECRET_KEY=""$/m, 'a bare placeholder converges to the quoted one');
  // A hand comment over a known key and an empty unknown key hold no value, so both drop
  assert.doesNotMatch(content, /hand note|STALE_EMPTY/);
});

test('env-order: every header the company stub ever generated stays out of Custom on the first converge', () => {
  for (const header of [
    [`# Acme Co ${EM_DASH} COMPANY secrets (gitignored; loaded UNDER every managed brand's own .env).`, '# Precedence: shell env > brand .env > this file. Put here only what every brand', `# shares ${EM_DASH} anything brand-specific belongs in that brand's .env, never here.`],
    ['# Acme Co: COMPANY secrets (gitignored; loaded UNDER every brand of this company).', '# Precedence: shell env > brand .env > this file. Put here only what every brand', "# shares. Anything brand-specific belongs in that brand's .env, never here."],
    [`# Acme ${EM_DASH} brand secrets (gitignored; loaded before every omega run).`],
  ]) {
    const { content } = convergeEnv(`${header.join('\n')}\n\n# ours\nCOMPANY_OWN="c"\n`);
    assert.equal(sections(content)[1], '# ours\nCOMPANY_OWN="c"\n', header[0]);
  }
});

test('env-order: a converged file re-runs byte-identical', () => {
  const first = convergeEnv(UNMARKED).content;
  const second = convergeEnv(first);
  assert.equal(second.changed, false);
  assert.equal(second.content, first);
});

test('env-order: the Custom section of a marked file is kept verbatim', () => {
  const custom = '# my block\nMINE="x"\n\nALSO_MINE=raw-kept\n';
  const marked = `${renderEnvTemplate()}${custom}`;

  const result = convergeEnv(marked);
  assert.equal(sections(result.content)[1], custom.replace('raw-kept', '"raw-kept"'));
  assert.equal(convergeEnv(result.content).changed, false);
});

test('env-order: a multi-line value converges whole, its value kept', () => {
  const multiLine = 'PRIVATE_KEY="-----BEGIN KEY-----\nabc\n-----END KEY-----"\nGH_TOKEN="gh"\n';
  const result = convergeEnv(multiLine);
  assert.equal(result.skipped, undefined);
  assert.deepEqual(effective(result.content), effective(multiLine));
  assert.equal(convergeEnv(result.content).changed, false);
});

test('env-order: a value ending in a backslash before its quote leaves the next line its own unit', () => {
  for (const [content, neighbour] of [['MINE="x\\"\nOMEGA_ADMIN_KEY=raw\nOTHER="c"\n', 'OMEGA_ADMIN_KEY'], ['GH_TOKEN="x\\"\nOPENAI_API_KEY="y"\nMINE="1"\n', 'OPENAI_API_KEY']]) {
    const read = dotenv.parse(content);
    const result = convergeEnv(content);
    assert.equal(result.skipped, undefined);
    assert.deepEqual(dotenv.parse(result.content), read);
    assert.match(result.content, new RegExp(`^${neighbour}="${read[neighbour]}"$`, 'm'), 'the neighbour is quoted on its own line');
    assert.equal(result.content.match(new RegExp(`^#?\\s*${neighbour}=`, 'gm')).length, 1, 'no placeholder beside the set line');
  }
});

test('env-order: a converge that would change a value declines untouched (a dotenv colon line)', () => {
  const exotic = 'GH_TOKEN: colon-form\nSENDGRID_API_KEY="sg"\n';
  const result = convergeEnv(exotic);
  assert.match(result.skipped, /would change an effective value/);
  assert.equal(result.changed, false);
  assert.equal(result.content, exotic);
});

// ─── The scaffold stubs ──────────────────────────────────────────────────────

test('env-order: the brand and company stubs are the template, already converged', () => {
  const brandEnv = buildScaffoldPlan({
    id: 'acme', name: 'Acme', url: 'https://acme.dev', email: 'hi@acme.dev',
    accountAdmins: [], targets: [{ name: 'web', type: 'web' }],
  }).find((file) => file.path === '.env').contents;
  const companyEnv = buildCompanyScaffoldPlan('Acme Co').find((file) => file.path === '.env').contents;

  for (const stub of [brandEnv, companyEnv]) {
    assert.equal(stub.split('\n')[0], DEFAULT_MARKER);
    assert.equal(sections(stub)[1], '');
    assert.equal(convergeEnv(stub).changed, false);
  }
  // The brand stub's minted keys sit in Default; the company stub sets nothing
  assert.match(sections(brandEnv)[0], /^OMEGA_ADMIN_KEY="[A-Za-z0-9_-]{43}"$/m);
  assert.deepEqual(effective(companyEnv), {});
});

// ─── writeEnvValue ───────────────────────────────────────────────────────────

test('env-order: writeEnvValue lands a known key in Default with its value, Custom untouched', () => {
  const root = tmpdir();
  try {
    const envPath = path.join(root, '.env');
    fs.writeFileSync(envPath, `${renderEnvTemplate()}MINE="keep-me"\n`);

    writeEnvValue(root, 'OMEGA_WEBHOOK_KEY', 'minted-fake');
    const env = fs.readFileSync(envPath, 'utf8');
    const [defaults, custom] = sections(env);
    assert.match(defaults, /^OMEGA_WEBHOOK_KEY="minted-fake"$/m);
    assert.doesNotMatch(env, /^# OMEGA_WEBHOOK_KEY=/m);
    assert.equal(custom, 'MINE="keep-me"\n');

    // A second write replaces the value in place
    writeEnvValue(root, 'OMEGA_WEBHOOK_KEY', 'rotated-fake');
    assert.equal(fs.readFileSync(envPath, 'utf8'), env.replace('minted-fake', 'rotated-fake'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('env-order: writeEnvValue marks a fresh file and puts an unknown key under Custom', () => {
  const root = tmpdir();
  try {
    writeEnvValue(root, 'FIXTURE_SECRET', 'fresh-fake');
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    assert.equal(env.split('\n')[0], DEFAULT_MARKER);
    assert.equal(sections(env)[1], 'FIXTURE_SECRET="fresh-fake"\n');
    assert.equal(convergeEnv(env).changed, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ─── The workspace env-order op ──────────────────────────────────────────────

const envOrderOp = require('../src/services/workspace/ensure/env-order.js');

// context.companyRoot is the company TREE the walk resolved (#677): a dir
// with a `.env` like any other layer root, which is all this op needs.
test('workspace env-order op: converges brand AND company .env files onto the markers', async () => {
  const brandRoot = tmpdir();
  const companyRoot = tmpdir();
  try {
    fs.writeFileSync(path.join(brandRoot, '.env'), 'SENDGRID_API_KEY="sg"\nBRAND_OWN="b"\n');
    fs.writeFileSync(path.join(companyRoot, '.env'), 'CSC_KEY_PASSWORD="pw"\nCOMPANY_OWN="c"\n');

    const result = await envOrderOp({ brandRoot, companyRoot, options: {} });
    assert.deepEqual(result.output.envOrder, { brand: 'converged', company: 'converged' });

    const brandEnv = fs.readFileSync(path.join(brandRoot, '.env'), 'utf8');
    assert.match(sections(brandEnv)[0], /^SENDGRID_API_KEY="sg"$/m);
    assert.equal(sections(brandEnv)[1], 'BRAND_OWN="b"\n');

    const companyEnv = fs.readFileSync(path.join(companyRoot, '.env'), 'utf8');
    assert.match(sections(companyEnv)[0], /^CSC_KEY_PASSWORD="pw"$/m);
    assert.equal(sections(companyEnv)[1], 'COMPANY_OWN="c"\n');

    const rerun = await envOrderOp({ brandRoot, companyRoot, options: {} });
    assert.deepEqual(rerun.output.envOrder, { brand: 'current', company: 'current' });
    assert.equal(fs.readFileSync(path.join(brandRoot, '.env'), 'utf8'), brandEnv);
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
    fs.rmSync(companyRoot, { recursive: true, force: true });
  }
});

test('workspace env-order op: dry run plans and writes nothing; missing and declined files noted', async () => {
  const brandRoot = tmpdir();
  try {
    const before = 'SENDGRID_API_KEY="sg"\nGH_TOKEN="gh"\n';
    const envPath = path.join(brandRoot, '.env');
    fs.writeFileSync(envPath, before);

    const result = await envOrderOp({ brandRoot, options: { dryRun: true } });
    assert.deepEqual(result.output.envOrder, { brand: 'planned' });
    assert.equal(fs.readFileSync(envPath, 'utf8'), before);

    const exotic = 'GH_TOKEN: colon-form\n';
    fs.writeFileSync(envPath, exotic);
    const declined = await envOrderOp({ brandRoot, options: {} });
    assert.deepEqual(declined.output.envOrder, { brand: 'skipped' });
    assert.equal(fs.readFileSync(envPath, 'utf8'), exotic);

    fs.rmSync(envPath);
    const missing = await envOrderOp({ brandRoot, options: {} });
    assert.deepEqual(missing.output.envOrder, { brand: 'missing' });
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});
