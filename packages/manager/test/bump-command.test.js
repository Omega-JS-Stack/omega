/**
 * Brand-root `omega bump` ([#869](https://github.com/Omega-JS-Stack/omega/issues/869)):
 * the brand root package.json `version` is the master and every target follows
 * it, so ONE verb writes them together.
 *
 * What these tests hold it to:
 *   - a bare run REPORTS the brand's version and writes nothing;
 *   - `patch` moves the root, every target and the brand lock, at exact numbers;
 *   - an unknown token is refused naming the three kinds, writing nothing;
 *   - outside a brand the verb refuses rather than bumping the nearest manifest.
 *
 * Real files on disk, run through the real command: nothing is stubbed.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The machine registry is per-machine state: this file's fixtures write into a
// temp home, never the developer's ~/.omega (#677).
require('@omega.js/devkit/test/temp-home');

const bumpCommand = require('../src/commands/bump.js');

/** A brand with two targets and the lock npm writes beside them. */
function stageBrand({ version = '0.1.0' } = {}) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-bump-')));
  const brand = path.join(scratch, 'brand');

  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: { type: 'web' }, desktop: { type: 'desktop' } },
}
`);

  write(path.join(brand, 'package.json'), { name: 'fixture-brand', version, private: true, workspaces: ['targets/*'] });
  write(path.join(brand, 'targets', 'web', 'package.json'), { name: 'fixture-web', version, private: true });
  write(path.join(brand, 'targets', 'desktop', 'package.json'), { name: 'fixture-desktop', version, private: true });
  write(path.join(brand, 'package-lock.json'), {
    name: 'fixture-brand',
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture-brand', workspaces: ['targets/*'] },
      'targets/web': { name: 'fixture-web', version },
      'targets/desktop': { name: 'fixture-desktop', version },
    },
  });

  return brand;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
}

function read(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Every version in the tree: root, each target, each lock entry. */
function versions(brand) {
  const lock = read(path.join(brand, 'package-lock.json'));
  return {
    root: read(path.join(brand, 'package.json')).version,
    web: read(path.join(brand, 'targets', 'web', 'package.json')).version,
    desktop: read(path.join(brand, 'targets', 'desktop', 'package.json')).version,
    lockWeb: lock.packages['targets/web'].version,
    lockDesktop: lock.packages['targets/desktop'].version,
  };
}

/** Run the command from `cwd` with console captured, restoring cwd + exitCode. */
async function runBump(cwd, ...tokens) {
  const cwd0 = process.cwd();
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args) => lines.push(args.map(String).join(' '));
  console.error = (...args) => lines.push(args.map(String).join(' '));
  process.chdir(cwd);

  try {
    await bumpCommand({ _: ['bump', ...tokens] });
    return { text: lines.join('\n'), code: process.exitCode };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.chdir(cwd0);
    process.exitCode = undefined;
  }
}

module.exports = defineCases({
  type: 'group',
  description: 'bump-command',
  tests: [
    {
      name: 'a bare run prints the brand and its version, and writes nothing',
      run: async (ctx) => {
        const brand = stageBrand();
        const before = fs.readFileSync(path.join(brand, 'package.json'), 'utf8');

        const { text, code } = await runBump(brand);

        ctx.expect(text.trim(), 'the brand id and the one version, nothing else').toBe('fixture-brand v0.1.0');
        ctx.expect(code, 'a report exits clean').toBe(undefined);
        ctx.expect(fs.readFileSync(path.join(brand, 'package.json'), 'utf8'), 'a bare run is a read').toBe(before);
      },
    },

    {
      name: '`patch` moves the root AND every target AND the lock, together',
      run: async (ctx) => {
        const brand = stageBrand();

        const { text, code } = await runBump(brand, 'patch');

        ctx.expect(versions(brand), 'the root is the master and every target followed it').toEqual({
          root: '0.1.1', web: '0.1.1', desktop: '0.1.1', lockWeb: '0.1.1', lockDesktop: '0.1.1',
        });
        ctx.expect(code).toBe(undefined);

        ctx.expect(text, 'the summary names both numbers').toMatch(/0\.1\.0 -> 0\.1\.1/);
        ctx.expect(text, 'one line per file written').toMatch(/targets[\\/]desktop[\\/]package\.json 0\.1\.0 -> 0\.1\.1/);
        ctx.expect(text, 'and says the commit is still the ship flow\'s').toMatch(/chore\(release\)/);

        // It is a VERSION verb, not a release verb: nothing is committed or tagged.
        ctx.expect(fs.existsSync(path.join(brand, '.git'))).toBe(false);
      },
    },

    {
      name: 'minor and major are the other two kinds, and an unknown token is refused naming all three',
      run: async (ctx) => {
        const brand = stageBrand();

        await runBump(brand, 'minor');
        ctx.expect(versions(brand).root).toBe('0.2.0');

        await runBump(brand, 'major');
        ctx.expect(versions(brand).desktop, 'every target followed the major too').toBe('1.0.0');

        const { text, code } = await runBump(brand, 'v2');
        ctx.expect(text).toMatch(/Unknown bump "v2"/);
        ctx.expect(text, 'the error names what the verb does take').toMatch(/patch, minor, major/);
        ctx.expect(code).toBe(1);
        ctx.expect(versions(brand).root, 'a refused token writes nothing').toBe('1.0.0');
      },
    },

    {
      name: 'outside a brand it refuses: there is no nearest manifest to bump instead',
      run: async (ctx) => {
        const loose = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-bump-loose-')));
        fs.writeFileSync(path.join(loose, 'package.json'), '{"name":"standalone","version":"1.2.3"}\n');

        const { text, code } = await runBump(loose, 'patch');

        ctx.expect(text).toMatch(/Not inside a brand monorepo/);
        ctx.expect(text, 'the error names where the verb belongs').toMatch(/omega bump` at the brand root/);
        ctx.expect(code).toBe(1);
        ctx.expect(read(path.join(loose, 'package.json')).version, 'the standalone manifest is untouched').toBe('1.2.3');
      },
    },
  ],
});
