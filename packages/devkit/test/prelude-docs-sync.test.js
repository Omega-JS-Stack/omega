/**
 * Unit tests for src/preludes/docs-sync.js: before every verb, a brand whose
 * @omega.js/manager is a local checkout gets that manager's docs/ synced from
 * the monorepo's docs/, writing only what changed. A published manager, and an
 * invocation outside a brand, are left alone.
 *
 * Fixtures are a miniature monorepo whose packages/devkit links to the REAL
 * devkit, so the prelude runs the real docs lane.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const docsSync = require('../src/preludes/docs-sync.js');
const { PRELUDES } = require('../src/preludes/index.js');

const DEVKIT = path.join(__dirname, '..');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-docs-sync-'));
}

// A monorepo (docs/ + a manager package + the real devkit) and a brand whose
// node_modules/@omega.js/manager links into it.
function linkedBrand() {
  const root = tmpdir();
  const monorepo = path.join(root, 'omega');
  const manager = path.join(monorepo, 'packages', 'manager');
  fs.mkdirSync(path.join(monorepo, 'docs', 'shared'), { recursive: true });
  fs.mkdirSync(manager, { recursive: true });
  fs.writeFileSync(path.join(monorepo, 'package.json'), JSON.stringify({ name: 'omega' }));
  fs.writeFileSync(path.join(manager, 'package.json'), JSON.stringify({ name: '@omega.js/manager' }));
  fs.symlinkSync(DEVKIT, path.join(monorepo, 'packages', 'devkit'));
  fs.writeFileSync(path.join(monorepo, 'docs', 'omega.md'), '# the map\n');
  fs.writeFileSync(path.join(monorepo, 'docs', 'shared', 'config.md'), '# config\n');

  const brand = path.join(root, 'brand');
  fs.mkdirSync(path.join(brand, 'node_modules', '@omega.js'), { recursive: true });
  fs.symlinkSync(manager, path.join(brand, 'node_modules', '@omega.js', 'manager'));
  return { monorepo, manager, brand };
}

module.exports = defineCases({
  type: 'group',
  description: 'prelude-docs-sync',
  tests: [
    {
      name: 'docs-sync: it is on the boot list for every verb',
      run: (ctx) => {
        ctx.expect(PRELUDES.includes(docsSync)).toBeTruthy();
        ctx.expect(docsSync.verbs).toBe('all');
      },
    },

    {
      name: 'docs-sync: a linked manager is synced, and a re-run writes only what changed',
      run: (ctx) => {
        const { monorepo, manager, brand } = linkedBrand();
        const lines = [];
        const log = (line) => lines.push(line);

        ctx.expect(docsSync.run({ brandRoot: brand, log }).written.sort()).toEqual(['omega.md', 'shared/config.md']);
        ctx.expect(fs.readFileSync(path.join(manager, 'docs', 'omega.md'), 'utf8')).toBe('# the map\n');
        ctx.expect(lines.length, 'a sync that wrote something says so in one line').toBe(1);

        const untouched = path.join(manager, 'docs', 'shared', 'config.md');
        const past = new Date('2020-01-01T00:00:00Z');
        fs.utimesSync(untouched, past, past);
        ctx.expect(docsSync.run({ brandRoot: brand, log })).toEqual({ synced: true, written: [], removed: [] });
        ctx.expect(lines.length, 'a sync with nothing to do is silent').toBe(1);

        fs.writeFileSync(path.join(monorepo, 'docs', 'omega.md'), '# the map v2\n');
        ctx.expect(docsSync.run({ brandRoot: brand, log }).written).toEqual(['omega.md']);
        ctx.expect(fs.statSync(untouched).mtime.getTime(), 'the unchanged file is untouched').toBe(past.getTime());
      },
    },

    {
      name: 'docs-sync: with no injected log, the sync line goes to stderr, never stdout',
      run: (ctx) => {
        const { brand } = linkedBrand();
        const out = [];
        const err = [];
        const original = { log: console.log, error: console.error };
        console.log = (line) => out.push(line);
        console.error = (line) => err.push(line);

        try {
          docsSync.run({ brandRoot: brand });
        } finally {
          console.log = original.log;
          console.error = original.error;
        }

        ctx.expect(out, 'a verb\'s stdout carries none of the prelude').toEqual([]);
        ctx.expect(err.length).toBe(1);
        ctx.expect(err[0]).toMatch(/synced the linked manager's docs/);
      },
    },

    {
      name: 'docs-sync: a published manager and a run outside a brand are left alone',
      run: (ctx) => {
        const brand = tmpdir();
        const manager = path.join(brand, 'node_modules', '@omega.js', 'manager');
        fs.mkdirSync(path.join(manager, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(manager, 'package.json'), JSON.stringify({ name: '@omega.js/manager' }));
        fs.writeFileSync(path.join(manager, 'docs', 'omega.md'), '# shipped\n');

        ctx.expect(docsSync.run({ brandRoot: brand })).toEqual({ synced: false, reason: 'published' });
        ctx.expect(fs.readFileSync(path.join(manager, 'docs', 'omega.md'), 'utf8')).toBe('# shipped\n');
        ctx.expect(docsSync.run({ brandRoot: null })).toEqual({ synced: false, reason: 'no-brand' });
        ctx.expect(docsSync.run({ brandRoot: tmpdir() })).toEqual({ synced: false, reason: 'no-manager' });
      },
    },
  ],
});
