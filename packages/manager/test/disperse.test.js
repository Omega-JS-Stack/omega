/**
 * Disperse service tests — the two remnant operations against real temp
 * brand monorepos on disk. certs: signing artifacts copied from
 * .omega/certificates/apple/ into desktop/mobile apps (byte-compared
 * idempotency, optional-vs-required miss semantics, the self-protecting
 * certs .gitignore, dry-run zero-write). env: composition of the .env files
 * that must PHYSICALLY exist (D15 — everything else rides the runtime
 * cascade), against the REAL framework templates (packages/desktop +
 * packages/backend _.env) — backend's full deploy-artifact pass-through,
 * the per-surface stream secret, exists-gated signing paths, the
 * no-brand-values-copied pins, Default-section appends, Custom-section
 * preservation, multi-line escaping, and converged no-rewrite runs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/disperse/index.js');
const { ENV_MAP, updateEnvContent } = require('../src/services/disperse/write/env.js');

// Tests must never see real credentials from the shell environment — every
// env name the composition can read gets scrubbed, and non-skip tests set
// fixture values explicitly.
const MANAGED_ENV = [...new Set(
  Object.values(ENV_MAP).flatMap((spec) => [
    ...(spec.env || []),
    ...(spec.streamSecret ? [spec.streamSecret] : []),
    ...Object.keys(spec.certPaths || {}),
  ]),
)];

function setEnv(vars = {}) {
  for (const name of MANAGED_ENV) {
    delete process.env[name];
  }
  Object.assign(process.env, vars);
}

setEnv();

const BRAND_ID = 'fixture-brand';
const KEY_ID = 'FIXKEY123';

const DESKTOP_TEMPLATE = jetpack.read(join(__dirname, '../../desktop/src/defaults/_.env'));
const BACKEND_TEMPLATE = jetpack.read(join(__dirname, '../../backend/src/defaults/_.env'));
assert.ok(DESKTOP_TEMPLATE && BACKEND_TEMPLATE, 'framework .env templates must exist (cross-package contract)');

// Full desktop signing set under .omega/certificates/apple/
const APPLE_FIXTURES = {
  'certificates/DEVELOPER_ID_APPLICATION_G2.p12': 'dev-id-application-p12-bytes',
  'certificates/DEVELOPER_ID_INSTALLER_G2.p12': 'dev-id-installer-p12-bytes',
  [`AuthKey_${KEY_ID}.p8`]: 'authkey-p8-bytes',
  'profiles/DEVELOPER_ID_APPLICATION_G2/MACOS.mobileprovision': 'macos-profile-bytes',
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Stage a temp brand monorepo: app dirs (with optional .env seed content)
 * and .omega/certificates/apple/ artifacts.
 */
function stageBrand({ apps = { desktop: {} }, apple = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'omega-disperse-'));

  const appList = Object.entries(apps).map(([target, { envFile, name = target } ]) => {
    const appPath = join(root, 'apps', name);
    jetpack.dir(appPath);
    if (envFile !== undefined) {
      jetpack.write(join(appPath, ENV_MAP[target]?.file || '.env'), envFile);
    }
    return { name, dir: `apps/${name}`, path: appPath, target, declaredTargets: null };
  });

  if (apple) {
    for (const [rel, contents] of Object.entries(apple)) {
      jetpack.write(join(root, '.omega', 'certificates', 'apple', rel), contents);
    }
  }

  return { root, apps: appList };
}

function brandConfig({ targets = { desktop: {} }, certificates } = {}) {
  return {
    brand: { id: BRAND_ID, name: 'Fixture Brand', url: `https://${BRAND_ID}.test` },
    targets,
    certificates: certificates !== undefined ? certificates : structuredClone(DEFAULTS.certificates),
  };
}

function runService({ root, apps }, { config = brandConfig(), brandState = {}, options = {}, companyRoot = null } = {}) {
  return service.run({
    brandId: BRAND_ID,
    brandRoot: root,
    companyRoot,
    brandConfig: config,
    brand: { id: BRAND_ID, config, targets: Object.keys(config.targets || {}), apps },
    brandState,
    apps,
    operations: OPERATIONS.disperse,
    options,
    serviceData: {},
  });
}

const certsPath = (brand, ...rest) => join(brand.root, 'apps', 'desktop', 'config', 'certs', ...rest);

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('disperse: skips without target-mapped apps', async () => {
  setEnv();
  const brand = stageBrand({ apps: {} });

  const result = await runService(brand);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no target-mapped apps/);
});

// ─── certs ───────────────────────────────────────────────────────────────────

test('certs: a company-managed brand disperses from the COMPANY signing tree', async () => {
  setEnv({ APPLE_API_KEY_ID: KEY_ID });
  const brand = stageBrand(); // no brand-local artifacts at all
  const companyRoot = mkdtempSync(join(tmpdir(), 'omega-disperse-company-'));
  for (const [rel, contents] of Object.entries(APPLE_FIXTURES)) {
    jetpack.write(join(companyRoot, '.omega', 'certificates', 'apple', rel), contents);
  }

  const result = await runService(brand, { companyRoot });

  assert.equal(result.status, 'success');
  assert.equal(result.output.certs.copied, 4);
  assert.equal(jetpack.read(certsPath(brand, 'developer-id-application.p12')), 'dev-id-application-p12-bytes');
});

test('certs: desktop app receives the full signing set + a self-protecting .gitignore', async () => {
  setEnv({ APPLE_API_KEY_ID: KEY_ID });
  const brand = stageBrand({ apple: APPLE_FIXTURES });

  const result = await runService(brand);

  assert.equal(result.status, 'success');
  assert.equal(result.output.certs.copied, 4);
  assert.equal(result.output.certs.warned, 0);
  assert.equal(jetpack.read(certsPath(brand, 'developer-id-application.p12')), 'dev-id-application-p12-bytes');
  assert.equal(jetpack.read(certsPath(brand, 'developer-id-installer.p12')), 'dev-id-installer-p12-bytes');
  assert.equal(jetpack.read(certsPath(brand, `AuthKey_${KEY_ID}.p8`)), 'authkey-p8-bytes');
  assert.equal(jetpack.read(certsPath(brand, `${BRAND_ID}.provisionprofile`)), 'macos-profile-bytes');
  assert.equal(jetpack.read(certsPath(brand, '.gitignore')), '*\n!.gitignore\n');
});

test('certs: a converged second run copies nothing', async () => {
  setEnv({ APPLE_API_KEY_ID: KEY_ID });
  const brand = stageBrand({ apple: APPLE_FIXTURES });

  await runService(brand);
  const before = statSync(certsPath(brand, 'developer-id-application.p12')).mtimeMs;
  const result = await runService(brand);

  assert.equal(result.output.certs.copied, 0);
  assert.equal(result.output.certs.current, 4);
  assert.equal(statSync(certsPath(brand, 'developer-id-application.p12')).mtimeMs, before);
});

test('certs: missing required source warns, missing optional skips', async () => {
  setEnv({ APPLE_API_KEY_ID: KEY_ID });
  // Only the AuthKey exists — the required .p12 is missing, both optionals too
  const brand = stageBrand({ apple: { [`AuthKey_${KEY_ID}.p8`]: 'authkey-p8-bytes' } });

  const result = await runService(brand);

  assert.equal(result.status, 'warned');
  assert.equal(result.output.certs.copied, 1);   // the AuthKey
  assert.equal(result.output.certs.warned, 1);   // developer-id-application.p12
  assert.equal(result.output.certs.skipped, 2);  // installer + provisioning profile
});

test('certs: an unset env placeholder warns instead of resolving to AuthKey_.p8', async () => {
  setEnv(); // no APPLE_API_KEY_ID
  const brand = stageBrand({
    apple: { 'certificates/DEVELOPER_ID_APPLICATION_G2.p12': 'dev-id-application-p12-bytes' },
  });

  const result = await runService(brand);

  assert.equal(result.status, 'warned');
  assert.equal(result.output.certs.copied, 1);   // the .p12
  assert.equal(result.output.certs.warned, 1);   // the AuthKey rule (placeholder unset)
  assert.equal(jetpack.exists(certsPath(brand, 'AuthKey_.p8')), false);
});

test('certs: no artifacts at all is a quiet note, not a warning', async () => {
  setEnv();
  const brand = stageBrand(); // no .omega/certificates/apple at all

  const result = await runService(brand);

  assert.equal(result.status, 'success');
  assert.match(result.output.certs.reason, /no signing artifacts yet/);
});

test('certs: certificates disabled in config skips the copy', async () => {
  setEnv({ APPLE_API_KEY_ID: KEY_ID });
  const brand = stageBrand({ apple: APPLE_FIXTURES });

  const result = await runService(brand, { config: brandConfig({ certificates: false }) });

  assert.equal(result.status, 'success');
  assert.match(result.output.certs.reason, /certificates\.enabled = false/);
  assert.equal(jetpack.exists(certsPath(brand, 'developer-id-application.p12')), false);
});

test('certs: mobile app uses build/certs/ paths', async () => {
  setEnv({ APPLE_API_KEY_ID: KEY_ID });
  const brand = stageBrand({
    apps: { mobile: {} },
    apple: {
      'certificates/IOS_DISTRIBUTION.p12': 'ios-distribution-p12-bytes',
      [`AuthKey_${KEY_ID}.p8`]: 'authkey-p8-bytes',
      'profiles/IOS_DISTRIBUTION/IOS.mobileprovision': 'ios-profile-bytes',
    },
  });

  const result = await runService(brand, { config: brandConfig({ targets: { mobile: {} } }) });

  assert.equal(result.status, 'success');
  assert.equal(result.output.certs.copied, 3);
  const mobileCerts = join(brand.root, 'apps', 'mobile', 'build', 'certs');
  assert.equal(jetpack.read(join(mobileCerts, 'ios-distribution.p12')), 'ios-distribution-p12-bytes');
  assert.equal(jetpack.read(join(mobileCerts, `AuthKey_${KEY_ID}.p8`)), 'authkey-p8-bytes');
  assert.equal(jetpack.read(join(mobileCerts, `${BRAND_ID}.mobileprovision`)), 'ios-profile-bytes');
});

test('certs: dry-run plans the copies without writing', async () => {
  setEnv({ APPLE_API_KEY_ID: KEY_ID });
  const brand = stageBrand({ apple: APPLE_FIXTURES });

  const result = await runService(brand, { options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.equal(result.output.certs.planned, 4);
  assert.equal(result.output.certs.copied, 0);
  assert.equal(jetpack.exists(join(brand.root, 'apps', 'desktop', 'config')), false);
});

// ─── env ─────────────────────────────────────────────────────────────────────

test('env: desktop .env composes only app-owned values against the real framework template', async () => {
  setEnv({
    APPLE_API_KEY_ID: KEY_ID,
    GH_TOKEN: 'fixture-gh-token',
    OMEGA_ADMIN_KEY: 'fixture-bm-key',
    CSC_KEY_PASSWORD: 'fixture-csc-password',
    APPLE_API_ISSUER: 'fixture-issuer',
    APPLE_TEAM_ID: 'FIXTEAM99',
  });
  const brand = stageBrand({
    apps: { desktop: { envFile: DESKTOP_TEMPLATE } },
    apple: APPLE_FIXTURES,
  });

  const result = await runService(brand, {
    brandState: { analytics: { streams: { desktop: { apiSecret: 'ga-desktop-secret' } } } },
  });

  assert.equal(result.status, 'success');
  assert.equal(result.output.env.updated, 1);

  const env = jetpack.read(join(brand.root, 'apps', 'desktop', '.env'));
  assert.match(env, /^CSC_LINK="config\/certs\/developer-id-application\.p12"$/m);
  assert.match(env, new RegExp(`^APPLE_API_KEY="config/certs/AuthKey_${KEY_ID}\\.p8"$`, 'm'));
  assert.match(env, /^GOOGLE_ANALYTICS_SECRET="ga-desktop-secret"$/m);
  // Brand-level values are NOT copied (the runtime cascade serves them) —
  // template placeholders stay commented even though GH_TOKEN is set above
  assert.match(env, /^# GH_TOKEN=$/m);
  assert.match(env, /^# WIN_EV_TOKEN_PATH=$/m);
  // Unmanaged template keys and the Custom section survive verbatim
  assert.match(env, /^OMEGA_TEST_USER_UID="em-test-user"$/m);
  assert.match(env, /Custom Values/);
});

test('env: signing paths are not stamped when the cert files are absent', async () => {
  setEnv({ APPLE_API_KEY_ID: KEY_ID, GH_TOKEN: 'fixture-gh-token' });
  const brand = stageBrand({ apps: { desktop: { envFile: DESKTOP_TEMPLATE } } }); // no apple artifacts

  await runService(brand);

  const env = jetpack.read(join(brand.root, 'apps', 'desktop', '.env'));
  assert.match(env, /^# CSC_LINK=$/m);
  assert.match(env, /^# APPLE_API_KEY=$/m);
});

test('env: a missing .env is created with the section markers', async () => {
  setEnv();
  const brand = stageBrand(); // desktop app without any .env

  const result = await runService(brand, {
    brandState: { analytics: { streams: { desktop: { apiSecret: 'ga-desktop-secret' } } } },
  });

  assert.equal(result.status, 'success');
  const env = jetpack.read(join(brand.root, 'apps', 'desktop', '.env'));
  const defaultAt = env.indexOf('Default Values');
  const keyAt = env.indexOf('GOOGLE_ANALYTICS_SECRET="ga-desktop-secret"');
  const customAt = env.indexOf('Custom Values');
  assert.ok(defaultAt >= 0 && keyAt > defaultAt && customAt > keyAt, 'keys sit between the section markers');
});

test('env: appended keys land in the Default section, above the Custom marker', async () => {
  setEnv({ GH_TOKEN: 'fixture-gh-token' });
  const seed = [
    '# ========== Default Values ==========',
    'UNRELATED="stays"',
    '',
    '# ========== Custom Values ==========',
    'MY_CUSTOM="keep"',
    '',
  ].join('\n');
  const brand = stageBrand({ apps: { desktop: { envFile: seed } } });

  await runService(brand, {
    brandState: { analytics: { streams: { desktop: { apiSecret: 'ga-desktop-secret' } } } },
  });

  const env = jetpack.read(join(brand.root, 'apps', 'desktop', '.env'));
  const customAt = env.indexOf('Custom Values');
  const gaAt = env.indexOf('GOOGLE_ANALYTICS_SECRET="ga-desktop-secret"');
  assert.ok(gaAt >= 0 && gaAt < customAt, 'appended key sits above the Custom marker');
  assert.ok(!env.includes('GH_TOKEN'), 'brand-level values are not appended (the cascade serves them)');
  assert.match(env, /^UNRELATED="stays"$/m);
  assert.match(env, /^MY_CUSTOM="keep"$/m);
});

test('env: backend app composes its app-root .env with its own stream secret', async () => {
  setEnv({ GH_TOKEN: 'fixture-gh-token', STRIPE_SECRET_KEY: 'sk_fixture', SENDGRID_API_KEY: 'SG.fixture' });
  const brand = stageBrand({
    apps: { backend: { envFile: BACKEND_TEMPLATE } },
  });

  const result = await runService(brand, {
    config: brandConfig({ targets: { backend: {} } }),
    brandState: { analytics: { streams: { backend: { apiSecret: 'ga-backend-secret' } } } },
  });

  assert.equal(result.status, 'success');
  // App-root .env (src/dist pillar) — `omega build` stages it into functions/
  const env = jetpack.read(join(brand.root, 'apps', 'backend', '.env'));
  assert.match(env, /^GOOGLE_ANALYTICS_SECRET="ga-backend-secret"$/m);
  // Backend keeps the FULL pass-through — its .env rides the deploy artifact
  assert.match(env, /^GH_TOKEN="fixture-gh-token"$/m);
  assert.match(env, /^STRIPE_SECRET_KEY="sk_fixture"$/m);
  assert.match(env, /^SENDGRID_API_KEY="SG\.fixture"$/m);
  // Developer tooling credentials are deliberately not composed
  assert.match(env, /^# CLAUDE_CODE_OAUTH_TOKEN=$/m);
  // Composed values UNCOMMENT their placeholder in place — no duplicate lines
  assert.doesNotMatch(env, /^# GH_TOKEN=$/m);
});

test('env: a converged second run rewrites nothing', async () => {
  setEnv({ APPLE_API_KEY_ID: KEY_ID });
  const brand = stageBrand({ apps: { desktop: { envFile: DESKTOP_TEMPLATE } }, apple: APPLE_FIXTURES });
  const brandState = { analytics: { streams: { desktop: { apiSecret: 'ga-desktop-secret' } } } };

  await runService(brand, { brandState });
  const envPath = join(brand.root, 'apps', 'desktop', '.env');
  assert.match(jetpack.read(envPath), /^GOOGLE_ANALYTICS_SECRET="ga-desktop-secret"$/m);

  const before = statSync(envPath).mtimeMs;
  const result = await runService(brand, { brandState });

  assert.equal(result.output.env.updated, 0);
  assert.equal(result.output.env.current, 1);
  assert.equal(statSync(envPath).mtimeMs, before);
});

test('env: dry-run reports the plan without touching the file', async () => {
  setEnv();
  const brand = stageBrand({ apps: { desktop: { envFile: DESKTOP_TEMPLATE } } });

  const result = await runService(brand, {
    brandState: { analytics: { streams: { desktop: { apiSecret: 'ga-desktop-secret' } } } },
    options: { dryRun: true },
  });

  assert.equal(result.output.env.updated, 0);
  assert.deepEqual(result.output.env.files['apps/desktop/.env'].planned, ['GOOGLE_ANALYTICS_SECRET']);
  assert.equal(jetpack.read(join(brand.root, 'apps', 'desktop', '.env')), DESKTOP_TEMPLATE);
});

// ─── updateEnvContent unit — the multi-line replacement hazard ───────────────

test('updateEnvContent: replacing a multi-line quoted value leaves no orphan tail', () => {
  const content = [
    'BEFORE="ok"',
    'SNAPCRAFT_STORE_CREDENTIALS="old line one',
    'old line two"',
    'AFTER="also ok"',
  ].join('\n');

  const result = updateEnvContent(content, { SNAPCRAFT_STORE_CREDENTIALS: 'new blob' });

  assert.deepEqual(result.written, ['SNAPCRAFT_STORE_CREDENTIALS']);
  assert.equal(result.content, [
    'BEFORE="ok"',
    'SNAPCRAFT_STORE_CREDENTIALS="new blob"',
    'AFTER="also ok"',
  ].join('\n'));
});

test('updateEnvContent: multi-line values serialize to one \\n-escaped line', () => {
  const result = updateEnvContent('EXISTING="ok"', { SNAPCRAFT_STORE_CREDENTIALS: 'line one\nline two' });

  assert.deepEqual(result.appended, ['SNAPCRAFT_STORE_CREDENTIALS']);
  assert.match(result.content, /^SNAPCRAFT_STORE_CREDENTIALS="line one\\nline two"$/m);
});

test('updateEnvContent: every duplicate occurrence is replaced (dotenv lets the last win)', () => {
  const content = ['GH_TOKEN="stale-one"', 'COMMENT_GAP=""', 'GH_TOKEN="stale-two"'].join('\n');

  const result = updateEnvContent(content, { GH_TOKEN: 'fresh' });

  assert.deepEqual(result.written, ['GH_TOKEN']);
  assert.equal(result.content, ['GH_TOKEN="fresh"', 'COMMENT_GAP=""', 'GH_TOKEN="fresh"'].join('\n'));
});
