// deliver-certs — the Apple artifacts reach the target's certs dir on every
// verb, not only on a manager `manage` run
// ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)).
//
// The copy rules are devkit's; what is pinned here is desktop's framing: which
// root holds the signing tree (company stamp wins over the brand root) and the
// no-op when there is no tree at all.

const path = require('path');
const fs = require('fs');
const os = require('os');
const jetpack = require('fs-jetpack');

const { deliverTargetCerts, resolveSourceRoot } = require('../../../utils/deliver-certs.js');

const P12 = path.join('.omega', 'certificates', 'apple', 'certificates', 'DEVELOPER_ID_APPLICATION_G2.p12');
const quiet = { log() {}, warn() {}, error() {} };

// A brand root with a desktop target under it; `tree` seeds the signing tree.
function stageBrand({ tree = true, companyTree = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-certs-'));
  const brandRoot = path.join(root, 'brand');
  const targetDir = path.join(brandRoot, 'targets', 'desktop');

  jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { desktop: {} } }\n");
  jetpack.dir(targetDir);
  if (tree) jetpack.write(path.join(brandRoot, P12), 'brand-cert');

  if (companyTree) {
    const companyRoot = path.join(root, 'company');
    jetpack.write(path.join(companyRoot, P12), 'company-cert');
    jetpack.write(path.join(brandRoot, '.omega', 'company.json'), JSON.stringify({ root: companyRoot }));
    return { root, brandRoot, companyRoot, targetDir };
  }

  return { root, brandRoot, targetDir };
}

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'deliver-certs — signing artifacts on every verb (#678)',
  tests: [
    {
      name: 'the brand tree delivers into the target certs dir, and the rerun is current',
      run: (ctx) => {
        const { root, targetDir } = stageBrand();

        try {
          const first = deliverTargetCerts({ projectDir: targetDir, logger: quiet });
          ctx.expect(first.copied).toContain('config/certs/developer-id-application.p12');
          ctx.expect(jetpack.read(path.join(targetDir, 'config', 'certs', 'developer-id-application.p12'))).toBe('brand-cert');
          // Signing material can never be committed
          ctx.expect(jetpack.read(path.join(targetDir, 'config', 'certs', '.gitignore'))).toContain('*');

          const second = deliverTargetCerts({ projectDir: targetDir, logger: quiet });
          ctx.expect(second.copied).toEqual([]);
          ctx.expect(second.current).toContain('config/certs/developer-id-application.p12');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the COMPANY stamp wins the source root — company-managed brands share the material',
      run: (ctx) => {
        const { root, brandRoot, companyRoot, targetDir } = stageBrand({ companyTree: true });

        try {
          ctx.expect(resolveSourceRoot(targetDir)).toBe(companyRoot);
          ctx.expect(resolveSourceRoot(targetDir)).not.toBe(brandRoot);

          deliverTargetCerts({ projectDir: targetDir, logger: quiet });
          ctx.expect(jetpack.read(path.join(targetDir, 'config', 'certs', 'developer-id-application.p12'))).toBe('company-cert');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'no signing tree → a silent no-op, never a throw (the normal state of a tree-less brand)',
      run: (ctx) => {
        const { root, targetDir } = stageBrand({ tree: false });

        try {
          ctx.expect(deliverTargetCerts({ projectDir: targetDir, logger: quiet })).toBe(null);
          ctx.expect(jetpack.exists(path.join(targetDir, 'config', 'certs'))).toBe(false);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
  ],
};
