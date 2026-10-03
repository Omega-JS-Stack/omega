/**
 * `resolveTargetRun`: the ONE lane every brand-root fan-out (`fanout: 'each'`)
 * runs a verb through. Every target, framework and custom alike, runs
 * `npm run <verb>` in its own dir with the brand's flags after `--`; a target
 * with no such script steps aside loudly. `resolveTargetCommand`: a
 * single-target command (`fanout: 'none'`) passes through to the framework's
 * own CLI with the exact argv. Real brand monorepos on disk; nothing is spawned.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { discoverTargets } = require('../src/lib/brand.js');
const { resolveTargetRun, resolveTargetCommand, isFrameworkScript } = require('../src/lib/framework-bin.js');

const BASE = { brand: { id: 'b', name: 'B', url: 'https://b.test' } };

/**
 * A brand with a web target, a backend (in `projectType` mode) and a custom
 * `api`, each carrying the scripts given. No framework is installed: the lane
 * never needs one.
 */
function makeBrand({ web = {}, backend = {}, api = {}, projectType } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'omega-framework-bin-'));
  const targets = { web: { type: 'web' }, backend: { type: 'backend', ...(projectType ? { projectType } : {}) }, api: { type: 'custom' } };
  jetpack.write(join(root, 'config', 'omega.json5'), JSON.stringify({ ...BASE, targets }, null, 2));
  jetpack.write(join(root, 'package.json'), { name: 'b', workspaces: ['targets/*'] });
  jetpack.write(join(root, 'targets', 'web', 'package.json'), { name: 'web', dependencies: { '@omega.js/web': '*' }, scripts: web });
  jetpack.write(join(root, 'targets', 'backend', 'package.json'), { name: 'backend', dependencies: { '@omega.js/backend': '*' }, scripts: backend });
  jetpack.write(join(root, 'targets', 'api', 'package.json'), { name: 'api', scripts: api });
  return root;
}

/** Run fn over the brand's discovered targets by name, then remove the brand. */
function withTargets(options, fn) {
  const root = makeBrand(options);
  try {
    fn(Object.fromEntries(discoverTargets(root).map((entry) => [entry.name, entry])));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

module.exports = defineCases({
  type: 'group',
  description: 'framework-bin',
  tests: [
    {
      name: 'a framework target runs its own `npm run <verb>`, the brand flags after --',
      run: (ctx) => {
        withTargets({ web: { build: 'omega build' } }, (targets) => {
          const run = resolveTargetRun(targets.web, 'build', ['--quick']);
          ctx.expect(run.kind).toBe('framework');
          ctx.expect(run.framework).toBe('@omega.js/web');
          ctx.expect(run.command).toBe('npm');
          ctx.expect(run.args).toEqual(['run', 'build', '--', '--quick']);
          ctx.expect(run.label).toBe('npm run build -- --quick');

          const bare = resolveTargetRun(targets.web, 'build', []);
          ctx.expect(bare.args, 'no flags, no separator').toEqual(['run', 'build']);
          ctx.expect(bare.label).toBe('npm run build');
        });
      },
    },

    {
      name: 'a custom target takes the SAME lane, and its own script runs bare',
      run: (ctx) => {
        withTargets({ api: { deploy: 'render deploy' } }, (targets) => {
          const run = resolveTargetRun(targets.api, 'deploy', ['--snapshot=abc']);
          ctx.expect(run.kind).toBe('custom');
          ctx.expect(run.framework).toBe(undefined);
          ctx.expect(run.frameworkScript).toBe(false);
          ctx.expect(run.args, 'a brand-owned script has no contract for the brand flags').toEqual(['run', 'deploy']);
          ctx.expect(run.label).toBe('npm run deploy');
        });
      },
    },

    {
      name: 'the one predicate: only a script that is exactly `omega <verb>` is the framework\'s own and hears the flags',
      run: (ctx) => {
        ctx.expect(isFrameworkScript('omega deploy', 'deploy')).toBe(true);
        for (const command of ['render deploy', 'omega deploy --direct', 'npx omega deploy', 'gulp build']) {
          ctx.expect(isFrameworkScript(command, 'deploy'), command).toBe(false);
        }

        withTargets({ web: { build: 'gulp build', deploy: 'omega deploy' }, backend: { test: 'node --test' }, projectType: 'custom' }, (targets) => {
          ctx.expect(resolveTargetRun(targets.web, 'deploy', ['--direct']).args).toEqual(['run', 'deploy', '--', '--direct']);
          ctx.expect(resolveTargetRun(targets.web, 'deploy', ['--direct']).frameworkScript).toBe(true);
          ctx.expect(resolveTargetRun(targets.web, 'build', ['--quick']).args, 'a framework target\'s own edit of a script runs bare too').toEqual(['run', 'build']);
          ctx.expect(resolveTargetRun(targets.backend, 'test', ['--extended', 'framework:']).args, 'a custom-mode backend\'s test is the brand\'s').toEqual(['run', 'test']);
        });
      },
    },

    {
      name: 'a target with no such script steps aside loudly, framework or custom',
      run: (ctx) => {
        withTargets({}, (targets) => {
          for (const name of ['web', 'api']) {
            const run = resolveTargetRun(targets[name], 'clean', []);
            ctx.expect(run.kind).toBe('skip');
            ctx.expect(run.detail).toMatch(new RegExp(`no "clean" script in targets/${name}/package.json`));
          }
        });
      },
    },

    {
      name: 'every spelling of a fan-out verb runs the script its row names',
      run: (ctx) => {
        withTargets({ web: { build: 'omega build' }, backend: { clean: 'omega clean' } }, (targets) => {
          ctx.expect(resolveTargetRun(targets.web, '--build', []).args).toEqual(['run', 'build']);
          ctx.expect(resolveTargetRun(targets.backend, 'clean:npm', []).args).toEqual(['run', 'clean']);
        });
      },
    },

    {
      name: 'a single-target command is never a fan-out lane: resolveTargetRun refuses it as a caller\'s bug',
      run: (ctx) => {
        withTargets({ backend: { emulator: 'omega emulator' } }, (targets) => {
          ctx.expect(() => resolveTargetRun(targets.backend, 'emulator', [])).toThrow(/"emulator" is a single-target command/);
        });
      },
    },

    {
      name: 'a single-target command passes through to the framework\'s own CLI, the argv exactly as typed',
      run: (ctx) => {
        withTargets({}, (targets) => {
          const root = join(targets.web.path, '..', '..');
          jetpack.write(join(root, 'node_modules', '@omega.js', 'backend', 'package.json'), { name: '@omega.js/backend', bin: { omega: 'bin/omega' } });
          const bin = join(root, 'node_modules', '@omega.js', 'backend', 'bin', 'omega');

          const run = resolveTargetCommand(targets.backend, 'firestore:set', ['firestore:set', 'users/abc', '{"a":1}']);
          ctx.expect(run.kind).toBe('framework');
          ctx.expect(run.framework).toBe('@omega.js/backend');
          ctx.expect(run.command).toBe(process.execPath);
          ctx.expect(run.args, 'the alias reaches the CLI as typed').toEqual([bin, 'firestore:set', 'users/abc', '{"a":1}']);
          ctx.expect(run.label).toBe('omega firestore:set users/abc {"a":1}');
        });
      },
    },

    {
      name: 'a single-target command on a custom target steps aside, naming the framework and the target',
      run: (ctx) => {
        withTargets({}, (targets) => {
          const run = resolveTargetCommand(targets.api, 'emulators', ['emulators']);
          ctx.expect(run.kind).toBe('skip');
          ctx.expect(run.detail).toBe('emulators is a @omega.js/backend command; api is custom');
        });
      },
    },

    {
      name: 'a single-target command whose framework is not installed is an error, never a silent pass',
      run: (ctx) => {
        withTargets({}, (targets) => {
          const run = resolveTargetCommand(targets.backend, 'emulator', ['emulator']);
          ctx.expect(run.kind).toBe('error');
          ctx.expect(run.detail).toMatch(/@omega\.js\/backend is not installed/);
        });
      },
    },

    {
      name: 'a dry run stops at the plan unless the script is the framework\'s own verb, which honors the flag',
      run: (ctx) => {
        withTargets({
          web: { build: 'omega build', deploy: 'omega deploy' },
          backend: { deploy: 'render deploys create' },
          api: { deploy: 'render deploy' },
          projectType: 'custom',
        }, (targets) => {
          // A verb whose row says the root answers --dry-run itself plans on every target
          const build = resolveTargetRun(targets.web, 'build', [], { dryRun: true });
          ctx.expect(build.kind).toBe('plan');
          ctx.expect(build.detail).toBe('would run npm run build in targets/web');

          // The framework's own `omega deploy` takes the flag and plans itself
          const deploy = resolveTargetRun(targets.web, 'deploy', ['--dry-run'], { dryRun: true });
          ctx.expect(deploy.kind).toBe('framework');
          ctx.expect(deploy.args).toEqual(['run', 'deploy', '--', '--dry-run']);

          // A brand's own script has no such contract: a custom-mode backend and a custom target plan
          for (const name of ['backend', 'api']) {
            const run = resolveTargetRun(targets[name], 'deploy', ['--dry-run'], { dryRun: true });
            ctx.expect(run.kind, name).toBe('plan');
            ctx.expect(run.detail).toBe(`would run npm run deploy in targets/${name}`);
          }
        });
      },
    },

    {
      name: 'a verb the table does not know is a caller\'s bug',
      run: (ctx) => {
        withTargets({}, (targets) => {
          ctx.expect(() => resolveTargetRun(targets.web, 'notaverb', [])).toThrow(/"notaverb" has no row/);
        });
      },
    },
  ],
});
