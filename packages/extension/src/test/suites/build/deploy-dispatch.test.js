// Build-layer test for commands/deploy.js's dispatch address (#799): the repo a
// CI dispatch targets comes from the brand's config, never the git remote of
// whatever repo the target sits in. Inside a brand nested in another repo (a
// brand inside the framework monorepo) the remote is the ENCLOSING repo, so the
// dispatch went to a workflow that was never there.

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const defineCases = require('@omega.js/devkit/test/define-cases');

const deployPath = path.join(__dirname, '..', '..', '..', 'commands', 'deploy.js');

// A brand monorepo with one extension target: config/omega.json5 at the root,
// the target under targets/, which is what the config walk looks for.
function stageBrand(config) {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-brand-'));
  const targetDir = path.join(brandRoot, 'targets', 'extension');
  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), JSON.stringify(config));
  return { brandRoot, targetDir };
}

function inTarget(targetDir, run) {
  const previous = process.cwd();
  process.chdir(targetDir);
  try {
    return run();
  } finally {
    process.chdir(previous);
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'deploy — the CI dispatch address comes from config',
  tests: [
    {
      name: 'dispatch address: the CONFIG names the repo, never the enclosing checkout (#799)',
      run: (ctx) => {
        const { dispatchAddress } = require(deployPath);
        const { brandRoot, targetDir } = stageBrand({
          brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
          repo: { providers: { github: { org: 'Acme-Org' } } },
          targets: { extension: {} },
        });

        try {
          // The name is the derived `<brand.id>-omega` default (#809): the config
          // declares an org and no repo of its own.
          ctx.expect(inTarget(targetDir, dispatchAddress)).toEqual({ owner: 'Acme-Org', repo: 'acme-omega' });
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'dispatch address: a config that names no repo REFUSES instead of dispatching somewhere (#799)',
      run: (ctx) => {
        const { dispatchAddress } = require(deployPath);
        const { brandRoot, targetDir } = stageBrand({
          brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
          targets: { extension: {} },
        });

        try {
          ctx.expect(() => inTarget(targetDir, dispatchAddress)).toThrow(/brand repo to dispatch on/);
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
  ],
});
