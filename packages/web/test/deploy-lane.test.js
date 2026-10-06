/**
 * `omega deploy` takes ONE lane, and a LINKED brand no longer takes a
 * different one ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
 *
 * The mirrored rule (2026-07-20) had every verb auto-switch to its local
 * artifact lane the moment the brand tree carried a `file:` @omega.js spec, so
 * the brands that most needed CI (the linked ones, the nested ones) were the
 * only ones that never reached it. The lane is the executor's now: a linked or
 * nested brand PACKS its local frameworks and pushes a snapshot, and CI builds
 * from that. `--direct` is how a human asks for the local lane instead.
 *
 * Offline by construction: a dry run builds the plan and sends nothing, so no
 * lane step runs at all (the temp brand's repo has no remote to push to either).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { execFileSync } = require('node:child_process');

const deploy = require('../src/commands/deploy.js');

/**
 * A brand root with a web target whose framework dep is LINKED, or REGISTRY
 * clean (`linked: false`), which since #915 takes the very same lane.
 *
 * @param {object} [options] - `{ version }` for the brand root; the target
 *   stays at 1.0.0, so a different number here is a DRIFTED brand (#869).
 * @returns {{ brandRoot: string, target: string }} The staged tree.
 */
function linkedBrand({ version = '1.0.0', linked = true } = {}) {
  const brandRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-lane-')));
  const target = path.join(brandRoot, 'targets', 'web');

  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
    repo: { provider: 'github', owner: 'Fixture-Org' },
    targets: { web: { type: 'web' } },
  }));
  // The brand root's version is the one every target follows (#869): a deploy
  // reads it before anything else, so the fixture carries one like a real brand.
  fs.writeFileSync(path.join(brandRoot, 'package.json'), JSON.stringify({
    name: 'fixture-brand',
    version,
    private: true,
    workspaces: ['targets/*'],
  }, null, 2));

  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
    name: 'fixture-web',
    version: '1.0.0',
    private: true,
    devDependencies: { '@omega.js/web': linked ? 'file:../../../../packages/web' : '^1.0.0' },
  }, null, 2));

  // A registry brand ships its OWN lockfile, and the lane refuses one that is
  // missing or disagrees with the manifests before anything is pushed (#938),
  // so the plain fixture carries a registry entry satisfying its spec.
  if (!linked) {
    fs.writeFileSync(path.join(brandRoot, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/@omega.js/web': { version: '1.0.0', resolved: 'https://registry.npmjs.org/@omega.js/web/-/web-1.0.0.tgz' },
      },
    }));
  }

  // A real (empty) repo: a linked brand SNAPSHOTS, and a snapshot is built out
  // of a git index, so the lane refuses a tree with no repo by name
  // ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)). Nothing here
  // ever pushes: a dry run resolves the lane and stops.
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: brandRoot });

  return { brandRoot, target };
}

/** Run the verb in a target dir with console output captured. */
async function runDeploy(dir, options) {
  const lines = [];
  const originalLog = console.log;
  const previous = process.cwd();

  console.log = (...args) => lines.push(args.map(String).join(' '));
  process.chdir(dir);

  try {
    await deploy(options);
    return lines.join('\n');
  } finally {
    process.chdir(previous);
    console.log = originalLog;
  }
}

module.exports = defineCases({
  type: 'group',
  description: 'deploy-lane',
  tests: [
    {
      name: '#872: a LINKED brand dispatches CI; the auto-switch to the direct lane is gone',
      run: async (ctx) => {
        const { brandRoot, target } = linkedBrand();

        try {
          const output = await runDeploy(target, { dryRun: true });

          ctx.expect(output, 'the plan is a workflow_dispatch, not a local build').toMatch(/would send:/);
          ctx.expect(output, 'a linked brand that owns its repo snapshots to its own branch').toMatch(/\(snapshot lane, ref omega-deploy\)/);
          ctx.expect(output, 'the composed workflow name (#265) is what a brand dispatches').toMatch(/actions\/workflows\/web-build\.yml\/dispatches/);
          ctx.expect(!output.includes('direct deploy would'), 'a linked tree no longer switches itself to the direct lane').toBeTruthy();
          ctx.expect(!output.includes('Linked local packages detected'), 'and no longer announces that it did').toBeTruthy();
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#915: a PLAIN brand takes the SAME lane, on the same branch: there is no push lane left',
      run: async (ctx) => {
        const { brandRoot, target } = linkedBrand({ linked: false });

        try {
          const output = await runDeploy(target, { dryRun: true });

          // It used to commit the developer's branch with `git add -A` and dispatch
          // that branch. CI only ever builds omega-deploy now, whoever started the
          // deploy, and main receives the composed workflow files alone.
          ctx.expect(output, 'the one lane, named in the header every verb prints').toMatch(/DRY RUN \(snapshot lane, ref omega-deploy\)/);
          ctx.expect(output, 'and the dispatch body names that branch').toMatch(/"ref":"omega-deploy"/);
          ctx.expect(output, 'the workflow half of the plan says where those files would go').toMatch(/default branch/);
          ctx.expect(!output.includes('push lane'), 'nothing still calls it a push lane').toBeTruthy();
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#872: --direct is how a human asks for the local lane',
      run: async (ctx) => {
        const { brandRoot, target } = linkedBrand();

        try {
          const output = await runDeploy(target, { dryRun: true, direct: true });

          ctx.expect(output, 'the direct plan is printed on request').toMatch(/direct deploy would/);
          ctx.expect(output, 'and it is the gh-pages push, built here').toMatch(/gh-pages/);
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#869: a target whose version drifted from the brand root is refused before the precheck',
      run: async (ctx) => {
        const { brandRoot, target } = linkedBrand({ version: '1.0.1' });

        try {
          // Every lane is refused, the dry run included: the check is a READ, and a
          // drifted target must not push its secrets or dispatch the wrong number.
          await ctx.expect((() => runDeploy(target, { dryRun: true }))()).rejects.toThrow((error) => {
              ctx.expect(error.refusal, 'a refusal prints its message alone').toBe(true);
              ctx.expect(error.message, 'names the target and both numbers').toMatch(/targets\/web is 1\.0\.0 but the brand is 1\.0\.1/);
              ctx.expect(error.message, 'and the fix').toMatch(/omega bump/);
              return true;
            });
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
  ],
});
