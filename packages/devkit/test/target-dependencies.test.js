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
  const configs = [];
  return { calls, configs, safeInstall: async (command, config) => { calls.push(command); configs.push(config); } };
}

// An install command as its words, so a case reads its flags in any order.
const words = (command) => command.split(/\s+/);

// Everything a call printed, through its injected sinks and the console alike.
async function printed(run) {
  const lines = [];
  const sink = (...parts) => lines.push(parts.join(' '));
  const originals = { log: console.log, warn: console.warn, error: console.error };
  Object.assign(console, { log: sink, warn: sink, error: sink });
  try {
    await run(sink);
  } finally {
    Object.assign(console, originals);
  }
  return lines.join('\n');
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

        ctx.expect(calls.map((command) => words(command).slice(0, 3))).toEqual([
          ['npm', 'install', 'gulp@5.0.0'],
          ['npm', 'install', 'some-runtime-dep@2.0.0'],
        ]);
        ctx.expect(words(calls[0]), 'a dev-mapped peer saves as a devDependency').toContain('--save-dev');
        ctx.expect(words(calls[1]), 'an unmapped peer saves as a dependency').toContain('--save');
        ctx.expect(words(calls[1])).not.toContain('--save-dev');
      },
    },

    {
      name: 'a peer one minor behind installs with --ignore-scripts; the framework update never does',
      run: async (ctx) => {
        const dir = tmpTarget({ name: 'consumer', dependencies: { gulp: '5.0.0' } });
        const { calls, configs, safeInstall } = installer();

        await ensurePeerDependencies({
          projectDir: dir,
          package: { peerDependencies: { gulp: '^5.1.0' } },
          log: () => {},
          dependencyMap: {},
          safeInstall,
        });

        ctx.expect(calls.length, 'the minor gap aligns, from either section').toBe(1);
        ctx.expect(words(calls[0])).toContain('gulp@5.1.0');
        ctx.expect(words(calls[0]), 'peer alignment runs no lifecycle scripts').toContain('--ignore-scripts');
        // The install lands in the target, never in whatever folder the verb was typed from.
        ctx.expect(configs.map((config) => config?.config?.cwd), 'every install runs in the target').toEqual([dir]);

        // The framework's own update keeps its scripts: electron's postinstall fetches the binary.
        const framework = tmpTarget({ name: 'consumer', dependencies: { '@omega.js/desktop': '1.0.0' } });
        fs.mkdirSync(path.join(framework, 'node_modules', '@omega.js', 'desktop'), { recursive: true });
        fs.writeFileSync(path.join(framework, 'node_modules', '@omega.js', 'desktop', 'package.json'), JSON.stringify({ name: '@omega.js/desktop', version: '1.0.0' }));
        const update = installer();
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response(JSON.stringify({ name: '@omega.js/desktop', version: '1.1.0' }), { status: 200, headers: { 'content-type': 'application/json' } });
        ctx.after(() => { globalThis.fetch = realFetch; });

        await updateManager({ projectDir: framework, package: { name: '@omega.js/desktop' }, log: () => {}, error: () => {}, safeInstall: update.safeInstall });

        ctx.expect(update.calls.length, 'a minor framework release installs').toBe(1);
        ctx.expect(words(update.calls[0])).toContain('@omega.js/desktop@1.1.0');
        ctx.expect(words(update.calls[0])).not.toContain('--ignore-scripts');
      },
    },

    {
      name: 'a peer one MAJOR behind installs nothing and prints the by-hand install line',
      run: async (ctx) => {
        const dir = tmpTarget({ name: 'consumer', devDependencies: { gulp: '4.0.0', 'some-dep': '2.0.0' } });
        const { calls, safeInstall } = installer();

        const said = await printed((sink) => ensurePeerDependencies({
          projectDir: dir,
          package: { peerDependencies: { gulp: '^5.0.0', 'some-dep': '^2.1.0' } },
          log: sink,
          warn: sink,
          error: sink,
          dependencyMap: { gulp: 'dev', 'some-dep': 'dev' },
          safeInstall,
        }));

        // A deploy never bumps a brand across a major on its own; the minor peer beside it still aligns.
        ctx.expect(calls.filter((command) => words(command).some((word) => word.startsWith('gulp@'))), 'the major gap installs nothing').toEqual([]);
        ctx.expect(calls.length, 'the refusal is for that peer only').toBe(1);
        ctx.expect(words(calls[0])).toContain('some-dep@2.1.0');
        ctx.expect(said).toContain('npm install gulp@5.0.0');
      },
    },

    {
      name: 'a target declaring the peer as latest or file: aligns it; no version is not a 0.0.0 major gap',
      run: async (ctx) => {
        for (const declared of ['latest', 'file:../x']) {
          const dir = tmpTarget({ name: 'consumer', devDependencies: { gulp: declared } });
          const { calls, safeInstall } = installer();

          const said = await printed((sink) => ensurePeerDependencies({
            projectDir: dir,
            package: { peerDependencies: { gulp: '^5.0.0' } },
            log: sink,
            warn: sink,
            error: sink,
            dependencyMap: { gulp: 'dev' },
            safeInstall,
          }));

          ctx.expect(calls.length, `${declared}: refused instead of installed`).toBe(1);
          ctx.expect(words(calls[0]), declared).toContain('gulp@5.0.0');
          ctx.expect(words(calls[0]), declared).toContain('--ignore-scripts');
          ctx.expect(said, `${declared}: a major-gap refusal was printed`).not.toMatch(/major/i);
        }
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
