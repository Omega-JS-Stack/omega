/**
 * scaffold-guard — the refusal every framework's ensure-target runs before it
 * writes ([#699](https://github.com/Omega-JS-Stack/omega/issues/699)). Real
 * directories in an os.tmpdir() scratch, no mocks.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { assertScaffoldable, nearestManifest } = require('../src/scaffold-guard.js');

/**
 * A scratch repo: `.git` at the root to bound the walk, plus whatever manifests
 * the case needs.
 * @param {Object<string, object>} manifests - Repo-relative dir → package.json contents
 * @returns {string} The repo root
 */
function stageRepo(manifests) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-guard-'));
  fs.mkdirSync(path.join(root, '.git'));
  for (const [dir, manifest] of Object.entries(manifests)) {
    const full = path.join(root, dir);
    fs.mkdirSync(full, { recursive: true });
    fs.writeFileSync(path.join(full, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return root;
}

module.exports = defineCases({
  type: 'group',
  description: 'scaffold-guard',
  tests: [
    {
      name: 'assertScaffoldable: a workspace root is refused by name and reason',
      run: (ctx) => {
        const root = stageRepo({ '.': { name: 'omega', private: true, workspaces: ['packages/*'] } });

        ctx.expect(() => assertScaffoldable(root)).toThrow((error) => {
          ctx.expect(error.message).toMatch(/refusing to scaffold into/);
          ctx.expect(error.message.includes(root), `names the directory: ${error.message}`).toBeTruthy();
          ctx.expect(error.message).toMatch(/declares "workspaces"/);
          ctx.expect(error.message).toMatch(/Nothing was scaffolded/);
          return true;
        });
      },
    },

    {
      name: 'assertScaffoldable: the refusal is FLAGGED, so every CLI prints it as a refusal (#706)',
      run: (ctx) => {
        const root = stageRepo({ '.': { name: 'omega', workspaces: ['packages/*'] } });

        ctx.expect(() => assertScaffoldable(root)).toThrow((error) => {
          ctx.expect(error.refusal, 'the flag the router and the bins print by, instead of a stack').toBe(true);
          return true;
        });
      },
    },

    {
      name: 'assertScaffoldable: an UNPARSEABLE manifest up the walk refuses too, crafted (#706)',
      run: (ctx) => {
        // A corrupt package.json used to throw a raw SyntaxError out of the guard —
        // loud, but naming neither the file nor the refusal. And it must never READ as
        // "not a workspace root": scaffolding on a guess is the accident this stops.
        const root = stageRepo({});
        fs.writeFileSync(path.join(root, 'package.json'), '{ "name": "broken", ');

        ctx.expect(() => assertScaffoldable(root)).toThrow((error) => {
          ctx.expect(error.refusal).toBe(true);
          ctx.expect(error.message).toMatch(/refusing to scaffold into/);
          ctx.expect(error.message.includes(path.join(root, 'package.json')), `names the unreadable file: ${error.message}`).toBeTruthy();
          ctx.expect(error.message).toMatch(/Nothing was scaffolded/);
          return true;
        });
      },
    },

    {
      name: 'assertScaffoldable: a directory INSIDE a workspace root is refused too (nearest manifest)',
      run: (ctx) => {
        const root = stageRepo({ '.': { name: 'omega', workspaces: ['packages/*'] } });
        const scratchDir = path.join(root, 'scratch', 'deep');
        fs.mkdirSync(scratchDir, { recursive: true });

        ctx.expect(() => assertScaffoldable(scratchDir)).toThrow(/refusing to scaffold into/);
      },
    },

    {
      name: 'assertScaffoldable: a workspace MEMBER scaffolds — it carries its own manifest',
      run: (ctx) => {
        const root = stageRepo({
          '.': { name: 'acme', workspaces: ['targets/*'] },
          'targets/app': { name: 'acme-app', devDependencies: { '@omega.js/desktop': '*' } },
        });

        ctx.expect(() => assertScaffoldable(path.join(root, 'targets', 'app'))).not.toThrow();
      },
    },

    {
      name: 'assertScaffoldable: a fresh directory with no manifest above it still scaffolds (bootstrap)',
      run: (ctx) => {
        const root = stageRepo({});
        const fresh = path.join(root, 'my-app');
        fs.mkdirSync(fresh);

        ctx.expect(() => assertScaffoldable(fresh)).not.toThrow();
      },
    },

    {
      name: 'nearestManifest: the walk stops at the nearest .git — a manifest outside the repo is never adopted',
      run: (ctx) => {
        const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-guard-outer-'));
        fs.writeFileSync(path.join(outer, 'package.json'), JSON.stringify({ name: 'outer', workspaces: ['*'] }));
        const repo = path.join(outer, 'repo');
        fs.mkdirSync(path.join(repo, '.git'), { recursive: true });

        ctx.expect(nearestManifest(repo)).toBe(null);
        ctx.expect(() => assertScaffoldable(repo)).not.toThrow();
      },
    },
  ],
});
