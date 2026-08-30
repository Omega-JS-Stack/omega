/**
 * Disperse service tests — the ONE remnant operation against real temp brand
 * monorepos on disk: signing artifacts copied from .omega/certificates/apple/
 * into desktop/mobile targets. The COPY itself is devkit's
 * (packages/devkit/test/certs.test.js pins byte-compare idempotency, the
 * self-protecting .gitignore, placeholder resolution and the mobile paths);
 * what these hold is the manage-lane framing this service owns — the signing
 * root it resolves (company tree over brand tree), the certificates config
 * gate, the optional-vs-required miss classification, and the dry run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/disperse/index.js');

const BRAND_ID = 'fixture-brand';
const KEY_ID = 'FIXKEY123';

/** The one env name the cert rules read — never inherited from the shell. */
function setEnv({ keyId = null } = {}) {
  if (keyId === null) delete process.env.APPLE_API_KEY_ID;
  else process.env.APPLE_API_KEY_ID = keyId;
}

setEnv();

// Full desktop signing set under .omega/certificates/apple/
const APPLE_FIXTURES = {
  'certificates/DEVELOPER_ID_APPLICATION_G2.p12': 'dev-id-application-p12-bytes',
  'certificates/DEVELOPER_ID_INSTALLER_G2.p12': 'dev-id-installer-p12-bytes',
  [`AuthKey_${KEY_ID}.p8`]: 'authkey-p8-bytes',
  [`profiles/${BRAND_ID}/DEVELOPER_ID_APPLICATION_G2/MACOS.mobileprovision`]: 'macos-profile-bytes',
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Stage a temp brand monorepo: target dirs and .omega/certificates/apple/ artifacts. */
function stageBrand({ targets = { desktop: {} }, apple = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'omega-disperse-'));

  const targetList = Object.entries(targets).map(([target, { name = target }]) => {
    const targetPath = join(root, 'targets', name);
    jetpack.dir(targetPath);
    return { name, dir: `targets/${name}`, path: targetPath, target, declaredTargets: null };
  });

  if (apple) {
    for (const [rel, contents] of Object.entries(apple)) {
      jetpack.write(join(root, '.omega', 'certificates', 'apple', rel), contents);
    }
  }

  return { root, targets: targetList };
}

function brandConfig({ targets = { desktop: {} }, certificates } = {}) {
  return {
    brand: { id: BRAND_ID, name: 'Fixture Brand', url: `https://${BRAND_ID}.test` },
    targets,
    certificates: certificates !== undefined ? certificates : structuredClone(DEFAULTS.certificates),
  };
}

function runService({ root, targets }, { config = brandConfig(), options = {}, companyRoot = null } = {}) {
  return service.run({
    brandId: BRAND_ID,
    brandRoot: root,
    companyRoot,
    brandConfig: config,
    brand: { id: BRAND_ID, config, enabledTargets: Object.keys(config.targets || {}), targets },
    targets,
    operations: OPERATIONS.disperse,
    options,
  });
}

const certsPath = (brand, ...rest) => join(brand.root, 'targets', 'desktop', 'config', 'certs', ...rest);

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('disperse: skips without target-mapped dirs', async () => {
  setEnv();
  const brand = stageBrand({ targets: {} });

  const result = await runService(brand);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no target-mapped dirs/);
});

// ─── certs ───────────────────────────────────────────────────────────────────

test('certs: the writer delivers the desktop signing set through devkit', async () => {
  setEnv({ keyId: KEY_ID });
  const brand = stageBrand({ apple: APPLE_FIXTURES });

  const result = await runService(brand);

  assert.equal(result.status, 'success');
  assert.equal(result.output.certs.copied, 4);
  assert.equal(result.output.certs.warned, 0);
  assert.equal(jetpack.read(certsPath(brand, 'developer-id-application.p12')), 'dev-id-application-p12-bytes');
  assert.equal(jetpack.read(certsPath(brand, `AuthKey_${KEY_ID}.p8`)), 'authkey-p8-bytes');
  assert.equal(jetpack.read(certsPath(brand, `${BRAND_ID}.provisionprofile`)), 'macos-profile-bytes');
  assert.equal(jetpack.read(certsPath(brand, '.gitignore')), '*\n!.gitignore\n');
});

test('certs: a company-managed brand disperses from the COMPANY signing tree', async () => {
  setEnv({ keyId: KEY_ID });
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

test('certs: missing required source warns, missing optional skips', async () => {
  setEnv({ keyId: KEY_ID });
  // Only the AuthKey exists — the required .p12 is missing, both optionals too
  const brand = stageBrand({ apple: { [`AuthKey_${KEY_ID}.p8`]: 'authkey-p8-bytes' } });

  const result = await runService(brand);

  assert.equal(result.status, 'warned');
  assert.equal(result.output.certs.copied, 1);   // the AuthKey
  assert.equal(result.output.certs.warned, 1);   // developer-id-application.p12
  assert.equal(result.output.certs.skipped, 2);  // installer + provisioning profile
});

test('certs: no artifacts at all is a quiet note, not a warning', async () => {
  setEnv();
  const brand = stageBrand(); // no .omega/certificates/apple at all

  const result = await runService(brand);

  assert.equal(result.status, 'success');
  assert.match(result.output.certs.reason, /no signing artifacts yet/);
});

test('certs: certificates disabled in config skips the copy', async () => {
  setEnv({ keyId: KEY_ID });
  const brand = stageBrand({ apple: APPLE_FIXTURES });

  const result = await runService(brand, { config: brandConfig({ certificates: false }) });

  assert.equal(result.status, 'success');
  assert.match(result.output.certs.reason, /certificates\.enabled = false/);
  assert.equal(jetpack.exists(certsPath(brand, 'developer-id-application.p12')), false);
});

test('certs: dry-run plans the copies without writing', async () => {
  setEnv({ keyId: KEY_ID });
  const brand = stageBrand({ apple: APPLE_FIXTURES });

  const result = await runService(brand, { options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.equal(result.output.certs.planned, 4);
  assert.equal(result.output.certs.copied, 0);
  assert.equal(jetpack.exists(join(brand.root, 'targets', 'desktop', 'config')), false);
});
