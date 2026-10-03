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
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'certs',
  tests: [
    {
      name: 'certs: the module exports the tree readers, and no delivery (#891)',
      run: (ctx) => {
        const certs = require('../src/certs.js');

        ctx.expect(Object.keys(certs).sort()).toEqual(['EXPIRY_WARN_DAYS', 'certificateExpiry', 'certsSourceDir', 'signingTree']);
      },
    },

    {
      name: 'certs: a brand of a company READS the company tree first, its own second',
      run: (ctx) => {
        const brandRoot = stage(ctx);
        const companyRoot = `${brandRoot}-company`;
        ctx.after(() => fs.rmSync(companyRoot, { recursive: true, force: true }));

        // The company holds the signing cert; only the API key is brand-local
        jetpack.write(path.join(certsSourceDir(companyRoot), 'certificates/DEVELOPER_ID_APPLICATION_G2.p12'), 'company-p12-bytes');
        jetpack.write(path.join(certsSourceDir(brandRoot), 'certificates/DEVELOPER_ID_APPLICATION_G2.p12'), 'brand-p12-bytes');
        jetpack.write(path.join(certsSourceDir(brandRoot), 'AuthKey_FIXKEY123.p8'), 'brand-authkey-bytes');

        const tree = signingTree({ brandRoot, companyRoot });

        const cert = tree.find('certificates/DEVELOPER_ID_APPLICATION_G2.p12');
        ctx.expect(cert.source).toBe('company');
        ctx.expect(jetpack.read(cert.path)).toBe('company-p12-bytes');
        ctx.expect(tree.find('AuthKey_FIXKEY123.p8').source).toBe('brand');
      },
    },

    {
      name: 'signingTree: writes go to the company tree when there is one, the brand tree otherwise',
      run: (ctx) => {
        const company = signingTree({ brandRoot: '/tmp/brand', companyRoot: '/tmp/parent/company' });
        ctx.expect(company.writeDir).toBe(path.join('/tmp/parent/company', '.omega', 'certificates', 'apple'));
        ctx.expect(company.readDirs).toEqual([
          path.join('/tmp/parent/company', '.omega', 'certificates', 'apple'),
          path.join('/tmp/brand', '.omega', 'certificates', 'apple'),
        ]);

        const standalone = signingTree({ brandRoot: '/tmp/brand', companyRoot: null });
        ctx.expect(standalone.writeDir).toBe(path.join('/tmp/brand', '.omega', 'certificates', 'apple'));
        ctx.expect(standalone.readDirs.length).toBe(1);
        ctx.expect(standalone.find('certificates/NOPE.p12')).toBe(null);
      },
    },
  ],
});
