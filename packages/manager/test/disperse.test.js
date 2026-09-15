/**
 * Disperse service tests: the service is REGISTERED and has nothing to do
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)).
 *
 * Its last operation copied signing artifacts into each desktop target's certs
 * dir. Signing material is read IN PLACE from the signing tree now (the paths
 * into it are derived once at the desktop env load,
 * packages/devkit/test/signing-env.test.js), so the copy, its rule table and
 * the two homes for one fact are gone. Ian kept the SERVICE: it is the
 * registered home for the next thing that genuinely cannot ride the config
 * hierarchy, so what these prove is that it stays registered, owns no
 * operation, and writes nothing when a walk passes through it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { OPERATIONS, BOOT_SERVICES, SERVICE_ORDER } = require('../src/config.js');
const { runService: runManageService } = require('../src/manage.js');
const service = require('../src/services/disperse/index.js');

const BRAND_ID = 'fixture-brand';

/** A temp brand monorepo with one desktop target and a signing tree in place. */
function stageBrand() {
  const root = mkdtempSync(join(tmpdir(), 'omega-disperse-'));
  const targetPath = join(root, 'targets', 'desktop');
  jetpack.dir(targetPath);

  // Real material in the tree: the service must leave it exactly there.
  jetpack.write(join(root, '.omega', 'certificates', 'apple', 'certificates', 'DEVELOPER_ID_APPLICATION_G2.p12'), 'p12-bytes');

  return { root, targets: [{ name: 'desktop', dir: 'targets/desktop', path: targetPath, target: 'desktop', declaredTargets: null }] };
}

function brandConfig() {
  return {
    brand: { id: BRAND_ID, name: 'Fixture Brand', url: `https://${BRAND_ID}.test` },
    targets: { desktop: { type: 'desktop' } },
  };
}

function runService({ root, targets }) {
  const config = brandConfig();

  return service.run({
    brandId: BRAND_ID,
    brandRoot: root,
    companyRoot: null,
    brandConfig: config,
    brand: { id: BRAND_ID, config, enabledTargets: Object.keys(config.targets), targets },
    targets,
    operations: OPERATIONS.disperse,
    options: {},
  });
}

test('disperse: the service is still registered, on both lanes', () => {
  assert.ok(SERVICE_ORDER.includes('disperse'), 'the manage walk still runs it');
  assert.ok(BOOT_SERVICES.includes('disperse'), 'and so does the delivery lane');
});

test('disperse: it owns NO operations (#891)', () => {
  assert.deepEqual(OPERATIONS.disperse, []);
});

test('disperse: the manage walk reports it skipped, by NAME (#891)', async () => {
  // The rule's one home is manage.js's runService: a registered service with
  // an empty operation list is reported skipped with its reason, never
  // silently passed as a service that ran and found nothing.
  const brand = stageBrand();

  const result = await runManageService('disperse', {
    id: BRAND_ID,
    root: brand.root,
    config: brandConfig(),
    targets: brand.targets,
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no operations');

  jetpack.remove(brand.root);
});

test('disperse: a run through it succeeds and writes nothing into the target', async () => {
  const brand = stageBrand();

  const result = await runService(brand);

  assert.equal(result.status, 'success');
  assert.equal(result.output, null, 'an op-less service produces no output');
  assert.equal(jetpack.exists(join(brand.root, 'targets', 'desktop', 'config')), false, 'nothing is copied into the target');
  assert.equal(
    jetpack.read(join(brand.root, '.omega', 'certificates', 'apple', 'certificates', 'DEVELOPER_ID_APPLICATION_G2.p12')),
    'p12-bytes',
    'and the tree is left exactly where it is, to be read in place',
  );

  jetpack.remove(brand.root);
});
