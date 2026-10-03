/**
 * Pin-writer tests (#794) — the scaffold writes EXACT `@omega.js/*` pins into
 * a brand: the manager's own version at the brand root, each target's
 * framework at the same number. A caret would let one target float ahead
 * alone; exact means only `omega update` moves anything, and it moves every
 * target together. The local era's `file:` specs are never touched, and a
 * rerun over an already-pinned brand changes nothing.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildScaffoldPlan, applyScaffoldPlan } = require('../src/lib/scaffold.js');

const MANAGER_VERSION = require('../package.json').version;

const ANSWERS = {
  id: 'pinbrand',
  name: 'Pin Brand',
  url: 'https://pinbrand.test',
  email: 'hi@pinbrand.test',
  targets: [{ name: 'web', type: 'web' }, { name: 'backend', type: 'backend' }, { name: 'desktop', type: 'desktop' }],
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-pins-'));
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

module.exports = defineCases({
  type: 'group',
  description: 'workspace-pins',
  tests: [
    {
      name: 'pin writer: the brand root pins @omega.js/manager at the manager\'s own version, exactly',
      run: (ctx) => {
        const root = tempDir();
        applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

        const pkg = readJson(path.join(root, 'package.json'));
        ctx.expect(pkg.devDependencies).toEqual({ '@omega.js/manager': MANAGER_VERSION });
        ctx.expect(pkg.devDependencies['@omega.js/manager'], 'a version, never a range').toMatch(/^\d+\.\d+\.\d+/);
      },
    },

    {
      name: 'pin writer: every target pins its framework at the same version — no caret, no star',
      run: (ctx) => {
        const root = tempDir();
        applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

        // The backend's framework is a RUNTIME dep (the stage derives dist/package.json
        // from it); every other target declares its framework as a devDependency
        ctx.expect(readJson(path.join(root, 'targets', 'web', 'package.json')).devDependencies).toEqual({ '@omega.js/web': MANAGER_VERSION });
        ctx.expect(readJson(path.join(root, 'targets', 'desktop', 'package.json')).devDependencies).toEqual({ '@omega.js/desktop': MANAGER_VERSION });
        ctx.expect(readJson(path.join(root, 'targets', 'backend', 'package.json')).dependencies).toEqual({ '@omega.js/backend': MANAGER_VERSION });

        for (const file of ['package.json', 'targets/web/package.json', 'targets/backend/package.json', 'targets/desktop/package.json']) {
          const raw = fs.readFileSync(path.join(root, file), 'utf8');
          ctx.expect(!/"@omega\.js\/[^"]+": "[\^~*]/.test(raw), `${file} carries a range instead of a pin`).toBeTruthy();
        }
      },
    },

    {
      name: 'pin writer: a `file:` spec already present is left untouched (the local era)',
      run: (ctx) => {
        const root = tempDir();
        const linkedRoot = '{\n  "name": "pinbrand",\n  "private": true,\n  "workspaces": ["targets/*"],\n  "devDependencies": { "@omega.js/manager": "file:../omega/packages/manager" }\n}\n';
        const linkedTarget = '{\n  "name": "pinbrand-web",\n  "devDependencies": { "@omega.js/web": "file:../../../omega/packages/web" }\n}\n';
        fs.writeFileSync(path.join(root, 'package.json'), linkedRoot);
        fs.mkdirSync(path.join(root, 'targets', 'web'), { recursive: true });
        fs.writeFileSync(path.join(root, 'targets', 'web', 'package.json'), linkedTarget);

        applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

        ctx.expect(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).toBe(linkedRoot);
        ctx.expect(fs.readFileSync(path.join(root, 'targets', 'web', 'package.json'), 'utf8')).toBe(linkedTarget);
      },
    },

    {
      name: 'pin writer: idempotent — a rerun over an already-pinned brand writes nothing',
      run: (ctx) => {
        const root = tempDir();
        applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

        const files = ['package.json', 'targets/web/package.json', 'targets/backend/package.json', 'targets/desktop/package.json'];
        const before = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8'));

        const rerun = applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

        ctx.expect(rerun.created.length, 'nothing is rewritten on a converged brand').toBe(0);
        files.forEach((file, i) => {
          ctx.expect(fs.readFileSync(path.join(root, file), 'utf8'), `${file} changed on a rerun`).toBe(before[i]);
        });
      },
    },
  ],
});
