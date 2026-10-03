// Tests for src/lib/node-version.js + runCommand's per-target Node spawning
// (friction #15: the manager drives each app's commands under that app's
// own .nvmrc Node). A fake $NVM_DIR with a shim "node" makes the tests
// machine-independent — no real nvm installs are touched.

const defineCases = require('@omega.js/devkit/test/define-cases');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');
const { parseNvmrcMajor, findInstalledNode, resolveTargetNode, nodeEnvFor } = require('../src/lib/node-version.js');
const { runCommand } = require('../src/lib/run-command.js');

/** Build a fake $NVM_DIR holding an executable shim for the given version. */
function makeFakeNvm(base, version, shimScript) {
  const binDir = path.join(base, 'versions', 'node', version, 'bin');
  const shim = path.join(binDir, 'node');
  jetpack.write(shim, shimScript);
  jetpack.file(shim, { mode: '755' });
  return binDir;
}

function withEnv(overrides, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const result = fn();
  if (result && typeof result.finally === 'function') return result.finally(restore);
  restore();
  return result;
}

module.exports = defineCases({
  type: 'group',
  description: 'node-version',
  tests: [
    {
      name: 'node-version: parseNvmrcMajor accepts every spec form',
      run: (ctx) => {
        ctx.expect(parseNvmrcMajor('v24/*')).toBe(24);
        ctx.expect(parseNvmrcMajor('v22')).toBe(22);
        ctx.expect(parseNvmrcMajor('20')).toBe(20);
        ctx.expect(parseNvmrcMajor('24.1.0')).toBe(24);
        ctx.expect(parseNvmrcMajor('lts/iron')).toBe(null);
        ctx.expect(parseNvmrcMajor('')).toBe(null);
      },
    },

    {
      name: 'node-version: findInstalledNode picks the highest patch of the major',
      run: (ctx) => {
        const base = path.join(os.tmpdir(), `omega-nvm-${process.pid}-a`);
        jetpack.remove(base);
        makeFakeNvm(base, 'v99.1.0', '#!/bin/sh\nexit 0\n');
        makeFakeNvm(base, 'v99.4.2', '#!/bin/sh\nexit 0\n');
        makeFakeNvm(base, 'v98.9.9', '#!/bin/sh\nexit 0\n');

        withEnv({ NVM_DIR: base }, () => {
          const found = findInstalledNode(99);
          ctx.expect(found.version).toBe('v99.4.2');
          ctx.expect(found.binDir.endsWith(path.join('v99.4.2', 'bin'))).toBeTruthy();
          ctx.expect(findInstalledNode(97)).toBe(null);
        });
        jetpack.remove(base);
      },
    },

    {
      name: 'node-version: resolveTargetNode — no .nvmrc, current-major match, pinned major, missing install',
      run: (ctx) => {
        const base = path.join(os.tmpdir(), `omega-nvm-${process.pid}-b`);
        const targetDir = path.join(os.tmpdir(), `omega-app-${process.pid}-b`);
        jetpack.remove(base);
        jetpack.remove(targetDir);
        jetpack.dir(targetDir);
        makeFakeNvm(base, 'v99.0.1', '#!/bin/sh\nexit 0\n');

        withEnv({ NVM_DIR: base }, () => {
          // no .nvmrc → inherited PATH
          ctx.expect(resolveTargetNode(targetDir)).toBe(null);

          // current major → resolved but binDir null (no PATH override needed)
          const currentMajor = process.versions.node.split('.')[0];
          jetpack.write(path.join(targetDir, '.nvmrc'), `v${currentMajor}/*`);
          const same = resolveTargetNode(targetDir);
          ctx.expect(same.binDir).toBe(null);
          ctx.expect(same.major).toBe(Number(currentMajor));
          ctx.expect(nodeEnvFor(same)).toEqual({});

          // pinned different major → resolved from the nvm install (the target root
          // is the ONE .nvmrc home — src/dist pillar; dist/.nvmrc is a staged copy)
          jetpack.write(path.join(targetDir, '.nvmrc'), 'v99/*');
          const pinned = resolveTargetNode(targetDir);
          ctx.expect(pinned.major).toBe(99);
          ctx.expect(pinned.binDir.includes('v99.0.1')).toBeTruthy();
          ctx.expect(nodeEnvFor(pinned).PATH.startsWith(pinned.binDir)).toBeTruthy();

          // pinned major with no install → hard error naming nvm install
          jetpack.write(path.join(targetDir, '.nvmrc'), 'v97/*');
          const missing = resolveTargetNode(targetDir);
          ctx.expect(missing.error).toMatch(/nvm install 97/);
        });
        jetpack.remove(base);
        jetpack.remove(targetDir);
      },
    },

    {
      name: 'runCommand: spawns under the target\'s pinned Node (shim proves the PATH override)',
      run: async (ctx) => {
        const base = path.join(os.tmpdir(), `omega-nvm-${process.pid}-c`);
        const targetDir = path.join(os.tmpdir(), `omega-app-${process.pid}-c`);
        jetpack.remove(base);
        jetpack.remove(targetDir);
        const marker = path.join(targetDir, 'shim-ran.txt');
        // The shim writes a marker file so the test can prove IT ran (stdio is inherited).
        makeFakeNvm(base, 'v99.0.0', `#!/bin/sh\necho "shim" > "${marker}"\nexit 0\n`);
        jetpack.write(path.join(targetDir, '.nvmrc'), 'v99/*');

        await withEnv({ NVM_DIR: base }, async () => {
          const result = await runCommand('node', ['-v'], targetDir);
          ctx.expect(result.success).toBe(true);
          ctx.expect((jetpack.read(marker) || '').trim()).toBe('shim');
        });

        jetpack.remove(base);
        jetpack.remove(targetDir);
      },
    },

    {
      name: 'runCommand: pinned-but-missing major fails fast with the nvm install hint',
      run: async (ctx) => {
        const base = path.join(os.tmpdir(), `omega-nvm-${process.pid}-d`);
        const targetDir = path.join(os.tmpdir(), `omega-app-${process.pid}-d`);
        jetpack.remove(base);
        jetpack.remove(targetDir);
        jetpack.dir(path.join(base, 'versions', 'node'));
        jetpack.write(path.join(targetDir, '.nvmrc'), 'v97/*');

        await withEnv({ NVM_DIR: base }, async () => {
          const result = await runCommand('node', ['-v'], targetDir);
          ctx.expect(result.success).toBe(false);
          ctx.expect(result.error).toMatch(/nvm install 97/);
        });

        jetpack.remove(base);
        jetpack.remove(targetDir);
      },
    },

    {
      name: 'runCommand: a command that rewrites .nvmrc and fails is retried once under the new Node',
      run: async (ctx) => {
        const base = path.join(os.tmpdir(), `omega-nvm-${process.pid}-e`);
        const targetDir = path.join(os.tmpdir(), `omega-app-${process.pid}-e`);
        jetpack.remove(base);
        jetpack.remove(targetDir);
        const marker = path.join(targetDir, 'attempts.txt');
        const nvmrc = path.join(targetDir, '.nvmrc');
        // v99's shim simulates EM setup: rewrites the pin to v98 and FAILS.
        makeFakeNvm(base, 'v99.0.0', `#!/bin/sh\necho "v99" >> "${marker}"\necho "v98/*" > "${nvmrc}"\nexit 1\n`);
        // v98's shim succeeds — the retry must land here.
        makeFakeNvm(base, 'v98.0.0', `#!/bin/sh\necho "v98" >> "${marker}"\nexit 0\n`);
        jetpack.write(nvmrc, 'v99/*');

        await withEnv({ NVM_DIR: base }, async () => {
          const result = await runCommand('node', ['setup'], targetDir);
          ctx.expect(result.success).toBe(true);
          ctx.expect((jetpack.read(marker) || '').trim().split('\n')).toEqual(['v99', 'v98']);
        });

        jetpack.remove(base);
        jetpack.remove(targetDir);
      },
    },
  ],
});
