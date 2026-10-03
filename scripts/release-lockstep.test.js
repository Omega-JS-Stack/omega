/**
 * release-lockstep tests: the family releases on ONE version. The root
 * package.json, every publishable and the Claude plugin's manifest carry the
 * same number, set by hand in the `chore(release): <x.y.z>` commit: the plugin
 * moves only when its version does. The list of publishables is
 * release-check's `PUBLISHABLES`, never a second copy here.
 *
 * Run: node --test scripts/release-lockstep.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PUBLISHABLES, checkLockstepVersions } = require('./release-check.js');

const PLUGIN_MANIFEST = path.join('agent-plugins', 'claude', '.claude-plugin', 'plugin.json');

// A throwaway tree with the root, every publishable and the plugin on `version`.
function familyTree(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-lockstep-'));
  const write = (dir, name) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
  };
  write(root, 'omega');
  for (const name of PUBLISHABLES) {
    write(path.join(root, 'packages', name), `@omega.js/${name}`);
  }
  writePlugin(root, version);
  return root;
}

function writePlugin(root, version) {
  fs.mkdirSync(path.dirname(path.join(root, PLUGIN_MANIFEST)), { recursive: true });
  fs.writeFileSync(path.join(root, PLUGIN_MANIFEST), JSON.stringify({ name: 'omega', description: 'OMEGA', version }));
}

module.exports = defineCases({
  type: 'group',
  description: 'release-lockstep',
  tests: [
    {
      name: 'lockstep: passes when the root and every publishable share one version',
      run: (ctx) => {
        const root = familyTree('1.2.3');
        ctx.expect(checkLockstepVersions(root)).toEqual({ ok: true, detail: '1.2.3' });
        fs.rmSync(root, { recursive: true });
      },
    },

    {
      name: 'lockstep: fails when one publishable is off the root version',
      run: (ctx) => {
        const root = familyTree('1.2.3');
        const file = path.join(root, 'packages', 'web', 'package.json');
        fs.writeFileSync(file, JSON.stringify({ name: '@omega.js/web', version: '1.2.2' }));

        const verdict = checkLockstepVersions(root);
        ctx.expect(verdict.ok).toBe(false);
        ctx.expect(verdict.detail).toMatch(/web 1\.2\.2/);
        fs.rmSync(root, { recursive: true });
      },
    },

    {
      name: 'lockstep: fails when only the root was bumped',
      run: (ctx) => {
        const root = familyTree('1.2.3');
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'omega', version: '1.3.0' }));

        ctx.expect(checkLockstepVersions(root).ok).toBe(false);
        fs.rmSync(root, { recursive: true });
      },
    },

    {
      name: 'case 14: fails when the plugin manifest is off the family version, naming both',
      run: (ctx) => {
        const root = familyTree('1.2.3');
        writePlugin(root, '0.1.0');

        const verdict = checkLockstepVersions(root);
        ctx.expect(verdict.ok).toBe(false);
        ctx.expect(verdict.detail, 'names the plugin version').toMatch(/0\.1\.0/);
        ctx.expect(verdict.detail, 'names the family version').toMatch(/1\.2\.3/);
        ctx.expect(verdict.detail, 'says which file is off').toMatch(/plugin/i);
        fs.rmSync(root, { recursive: true });
      },
    },

    {
      name: 'lockstep: the real tree is on one version',
      run: (ctx) => {
        const verdict = checkLockstepVersions();
        ctx.expect(verdict.ok, `the family is not on one version: ${verdict.detail}`).toBe(true);
      },
    },
  ],
});
