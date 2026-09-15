/**
 * Signing-tree READER tests
 * ([#892](https://github.com/Omega-JS-Stack/omega/issues/892)).
 *
 * There is no delivery left to test
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)): nothing copies
 * signing material into a target any more, so the copy layer, its rule table
 * and the manager's disperse `certs` operation are gone. What `@omega.js/devkit/certs`
 * still answers is WHERE the tree is, in two tiers, and that is what these
 * prove. The derivation that reads it lives in signing-env.test.js.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const { signingTree, certsSourceDir } = require('../src/certs.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

/** Stage a source root holding .omega/certificates/apple/. */
function stage(t) {
  const root = path.join(TEMP_ROOT, `certs-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.rmSync(root, { recursive: true, force: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  return root;
}

test('certs: the module exports the tree readers, and no delivery (#891)', () => {
  const certs = require('../src/certs.js');

  assert.deepEqual(
    Object.keys(certs).sort(),
    ['EXPIRY_WARN_DAYS', 'certificateExpiry', 'certsSourceDir', 'signingTree'],
  );
});

test('certs: a brand of a company READS the company tree first, its own second', (t) => {
  const brandRoot = stage(t);
  const companyRoot = `${brandRoot}-company`;
  t.after(() => fs.rmSync(companyRoot, { recursive: true, force: true }));

  // The company holds the signing cert; only the API key is brand-local
  jetpack.write(path.join(certsSourceDir(companyRoot), 'certificates/DEVELOPER_ID_APPLICATION_G2.p12'), 'company-p12-bytes');
  jetpack.write(path.join(certsSourceDir(brandRoot), 'certificates/DEVELOPER_ID_APPLICATION_G2.p12'), 'brand-p12-bytes');
  jetpack.write(path.join(certsSourceDir(brandRoot), 'AuthKey_FIXKEY123.p8'), 'brand-authkey-bytes');

  const tree = signingTree({ brandRoot, companyRoot });

  const cert = tree.find('certificates/DEVELOPER_ID_APPLICATION_G2.p12');
  assert.equal(cert.source, 'company');
  assert.equal(jetpack.read(cert.path), 'company-p12-bytes');
  assert.equal(tree.find('AuthKey_FIXKEY123.p8').source, 'brand');
});

test('signingTree: writes go to the company tree when there is one, the brand tree otherwise', () => {
  const company = signingTree({ brandRoot: '/tmp/brand', companyRoot: '/tmp/parent/company' });
  assert.equal(company.writeDir, path.join('/tmp/parent/company', '.omega', 'certificates', 'apple'));
  assert.deepEqual(company.readDirs, [
    path.join('/tmp/parent/company', '.omega', 'certificates', 'apple'),
    path.join('/tmp/brand', '.omega', 'certificates', 'apple'),
  ]);

  const standalone = signingTree({ brandRoot: '/tmp/brand', companyRoot: null });
  assert.equal(standalone.writeDir, path.join('/tmp/brand', '.omega', 'certificates', 'apple'));
  assert.equal(standalone.readDirs.length, 1);
  assert.equal(standalone.find('certificates/NOPE.p12'), null);
});
