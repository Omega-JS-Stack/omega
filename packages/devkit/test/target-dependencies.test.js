/**
 * Unit tests for src/target-dependencies.js — the shared peer-dependency and
 * framework-freshness checks every framework's ensure-target / deploy-precheck
 * rides ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * The installer is injected, so nothing here touches npm or the network.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readProject, ensurePeerDependencies, updateManager } = require('../src/target-dependencies');

function tmpTarget(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-target-deps-'));
  if (manifest) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

function installer() {
  const calls = [];
  return { calls, safeInstall: async (command) => { calls.push(command); } };
}

module.exports = defineCases({
  type: 'group',
  description: 'target-dependencies',
  tests: [
    {
      name: 'readProject: both dependency sections are always objects',
      run: (ctx) => {
        const dir = tmpTarget({ name: 'consumer' });
        const project = readProject(dir);

        ctx.expect(project.name).toBe('consumer');
        ctx.expect(project.dependencies).toEqual({});
        ctx.expect(project.devDependencies).toEqual({});

        // A target with no manifest at all reads as an empty project, never a throw.
        ctx.expect(readProject(tmpTarget())).toEqual({ dependencies: {}, devDependencies: {} });
      },
    },

    {
      name: 'ensurePeerDependencies: a satisfied target installs nothing',
      run: async (ctx) => {
        const dir = tmpTarget({ name: 'consumer', devDependencies: { gulp: '5.0.0' } });
        const { calls, safeInstall } = installer();
        const log = [];

        await ensurePeerDependencies({
          projectDir: dir,
          package: { peerDependencies: { gulp: '^5.0.0' } },
          log: (line) => log.push(line),
          dependencyMap: { gulp: 'dev' },
          safeInstall,
        });

        ctx.expect(calls, 'a satisfied peer dep is never reinstalled — this runs on every verb').toEqual([]);
        ctx.expect(log.join('\n')).toMatch(/gulp is up to date/);
      },
    },

    {
      name: 'ensurePeerDependencies: the map decides --save-dev vs --save',
      run: async (ctx) => {
        const dir = tmpTarget({ name: 'consumer' });
        const { calls, safeInstall } = installer();

        await ensurePeerDependencies({
          projectDir: dir,
          package: { peerDependencies: { gulp: '^5.0.0', 'some-runtime-dep': '^2.0.0' } },
          log: () => {},
          dependencyMap: { gulp: 'dev' },
          safeInstall,
        });

        ctx.expect(calls).toEqual([
          'npm install gulp@5.0.0 --save-dev',
          'npm install some-runtime-dep@2.0.0 --save',
        ]);
      },
    },

    {
      name: 'ensurePeerDependencies: a behind version reinstalls, either section counts',
      run: async (ctx) => {
        const dir = tmpTarget({ name: 'consumer', dependencies: { gulp: '4.0.0' } });
        const { calls, safeInstall } = installer();

        await ensurePeerDependencies({
          projectDir: dir,
          package: { peerDependencies: { gulp: '^5.0.0' } },
          log: () => {},
          dependencyMap: {},
          safeInstall,
        });

        ctx.expect(calls).toEqual(['npm install gulp@5.0.0 --save']);
      },
    },

    {
      name: 'updateManager: an uninstalled framework is a loud error, not a silent skip',
      run: async (ctx) => {
        const dir = tmpTarget({ name: 'consumer' });
        const { calls, safeInstall } = installer();

        await ctx.expect((() => updateManager({ projectDir: dir, package: { name: '@omega.js/desktop' }, log: () => {}, error: () => {}, safeInstall }))()).rejects.toThrow(/No installed version of @omega\.js\/desktop found/);
        ctx.expect(calls, 'nothing is installed on the way out').toEqual([]);
      },
    },
  ],
});
