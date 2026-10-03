/**
 * Shipped-docs structure test: @omega.js/manager, the package every brand
 * installs, carries the whole docs tree and the one-line AGENTS.md that imports
 * its map, and no copy of the Claude plugin: a machine gets that from GitHub.
 * No other publishable ships docs.
 *
 * Each package is REALLY packed (`npm pack` into a temp dir, running its own
 * prepare and so the devkit vendor lane) and the tarball listing is asserted.
 *
 * Run: node --test scripts/vendor-docs.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { HOST_PACKAGE, MAP_FILE } = require(path.join(ROOT, 'packages', 'devkit', 'tools', 'vendor-docs.js'));
const { PUBLISHABLES } = require('./release-check.js');

// One pack per package is the expensive part: pack once, share the listing.
const listings = new Map();

/**
 * Pack a package for real and return its tarball's file list (package/-relative).
 * @param {Function} expect - The calling case's `ctx.expect`
 * @param {string} short - Package short name ('web', 'manager', ...)
 * @returns {string[]}
 */
function packedFiles(expect, short) {
  if (listings.has(short)) {
    return listings.get(short);
  }

  const cwd = path.join(ROOT, 'packages', short);
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), `omega-pack-${short}-`));
  const pack = spawnSync('npm', ['pack', '--pack-destination', destination], { cwd, encoding: 'utf8' });
  expect(pack.status, `npm pack failed for ${short}:\n${pack.stdout}${pack.stderr}`).toBe(0);

  const tarball = fs.readdirSync(destination).find((file) => file.endsWith('.tgz'));
  expect(tarball, `npm pack produced no tarball for ${short}`).toBeTruthy();

  const list = spawnSync('tar', ['-tzf', path.join(destination, tarball)], { encoding: 'utf8' });
  expect(list.status, `tar listing failed for ${short}: ${list.stderr}`).toBe(0);

  const files = list.stdout.split('\n').filter(Boolean).map((entry) => entry.replace(/^package\//, ''));
  fs.rmSync(destination, { recursive: true, force: true });
  listings.set(short, files);
  return files;
}

module.exports = defineCases({
  type: 'group',
  description: 'vendor-docs',
  tests: [
    {
      name: 'vendor-docs: the manager ships AGENTS.md and the map it imports, inside the whole docs tree',
      run: (ctx) => {
        const files = packedFiles(ctx.expect, HOST_PACKAGE);
        const agents = fs.readFileSync(path.join(ROOT, 'packages', HOST_PACKAGE, 'AGENTS.md'), 'utf8').trim();

        ctx.expect(files.includes('AGENTS.md'), 'the one-line AGENTS.md ships').toBeTruthy();
        ctx.expect(files.includes(agents.slice(1)), `the file it imports (${agents}) ships beside it`).toBeTruthy();
        ctx.expect(agents.slice(1)).toBe(MAP_FILE.split(path.sep).join('/'));

        const sourceDocs = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'docs'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
        const missing = sourceDocs.filter((file) => !files.includes(file));
        ctx.expect(missing, 'every doc ships at the same path').toEqual([]);
      },
    },

    {
      name: 'case 13: the packed manager holds no claude-plugin/ and no .claude-plugin/, and still holds docs/',
      run: (ctx) => {
        const files = packedFiles(ctx.expect, HOST_PACKAGE);

        ctx.expect(files.filter((file) => file.startsWith('claude-plugin/')), 'no vendored plugin').toEqual([]);
        ctx.expect(files.filter((file) => file.startsWith('.claude-plugin/')), 'no package-root marketplace').toEqual([]);
        ctx.expect(files.includes('docs/omega.md'), 'the docs tree still ships').toBeTruthy();
        ctx.expect(files.filter((file) => file.startsWith('docs/')).length > 10, 'the whole docs tree, not a stub').toBeTruthy();
      },
    },

    ...(() => {
      const cases = [];
      for (const short of PUBLISHABLES.filter((name) => name !== HOST_PACKAGE)) {
        cases.push({
          name: `vendor-docs: @omega.js/${short} ships no docs`,
          run: (ctx) => {
            ctx.expect(packedFiles(ctx.expect, short).filter((file) => file.startsWith('docs/'))).toEqual([]);
          },
        });
      }
      return cases;
    })(),

    {
      name: 'vendor-docs: everything the lane writes is generated: gitignored, never a committed file',
      run: (ctx) => {
        packedFiles(ctx.expect, HOST_PACKAGE);
        const status = spawnSync('git', ['status', '--porcelain', '--', `packages/${HOST_PACKAGE}/docs`], { cwd: ROOT, encoding: 'utf8' });
        ctx.expect(status.status, `git status failed: ${status.stderr}`).toBe(0);
        ctx.expect(status.stdout.trim(), 'vendored docs must be gitignored and never a committed file').toBe('');
      },
    },
  ],
});
