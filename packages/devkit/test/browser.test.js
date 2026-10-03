// Unit tests for src/test/browser.js — where a lane's puppeteer comes from,
// and what it is launched with.
//
// The resolution runs for REAL against staged trees (a brand root declaring
// @omega.js/manager, a fixture puppeteer in its node_modules), because the
// whole point of the module is which directory node resolves from. Only the
// launch itself is answered by the fixture package — starting real Chrome
// proves puppeteer, not this.

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { launchBrowser, resolvePuppeteer, puppeteerRoot, LAUNCH_ARGS } = require('../src/test/browser.js');

function write(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function scratch() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-browser-')));
}

/**
 * A brand root: package.json declaring @omega.js/manager, an optional fixture
 * puppeteer in its node_modules, and a target dir a lane could run from.
 */
function stageBrand({ manager = true, puppeteer = 'installed', chrome = 'present' } = {}) {
  const root = path.join(scratch(), 'brand');
  write(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture-brand',
    private: true,
    ...(manager ? { devDependencies: { '@omega.js/manager': '*' } } : {}),
  }));
  write(path.join(root, 'test', 'e2e', 'run.js'), '');

  if (puppeteer === 'installed') {
    const chromePath = chrome === 'present' ? process.execPath : path.join(root, 'no-such-chrome');
    write(path.join(root, 'node_modules', 'puppeteer', 'package.json'), JSON.stringify({ name: 'puppeteer', version: '24.0.0', main: 'index.js' }));
    write(path.join(root, 'node_modules', 'puppeteer', 'index.js'),
      `module.exports = {\n`
      + `  executablePath: () => ${JSON.stringify(chromePath)},\n`
      + `  launch: async (options) => ({ launched: options }),\n`
      + `};\n`);
  }

  return root;
}

module.exports = defineCases({
  type: 'group',
  description: 'browser',
  tests: [
    // ---- puppeteerRoot

    {
      name: 'the walk stops at the nearest manifest declaring @omega.js/manager',
      run: (ctx) => {
        const root = stageBrand();
        // A target sits between the lane and the brand root, with its own manifest
        write(path.join(root, 'targets', 'web', 'package.json'), JSON.stringify({ name: 'web' }));
        write(path.join(root, 'targets', 'web', 'test', 'e2e', 'run.js'), '');

        ctx.expect(puppeteerRoot(path.join(root, 'test', 'e2e'))).toBe(root);
        ctx.expect(puppeteerRoot(path.join(root, 'targets', 'web', 'test', 'e2e')), 'a target target-root manifest is not the brand root').toBe(root);
      },
    },

    {
      name: 'with no manager declared anywhere, the NEAREST manifest answers, never the outermost',
      run: (ctx) => {
        const dir = scratch();
        write(path.join(dir, 'package.json'), JSON.stringify({ name: 'monorepo', workspaces: ['packages/*'] }));
        const pkgDir = path.join(dir, 'packages', 'devkit');
        write(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@omega.js/devkit' }));

        // Resolution only needs a starting point node can climb FROM: the nearest
        // manifest reaches every install above it, while the outermost would skip a
        // nearer copy a nested install deliberately put there.
        ctx.expect(puppeteerRoot(pkgDir)).toBe(pkgDir);
        ctx.expect(puppeteerRoot(path.join(pkgDir, 'test', 'deep')), 'a dir with no manifest of its own climbs to it').toBe(pkgDir);
        ctx.expect(puppeteerRoot(dir), 'at the outermost, the outermost IS the nearest').toBe(dir);
      },
    },

    {
      name: 'a DECLARING ancestor still wins over the nearer non-declaring one',
      run: (ctx) => {
        const root = stageBrand();
        const targetDir = path.join(root, 'targets', 'web');
        write(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'web' }));

        // The brand root declares the manager; the target manifest between them does
        // not, and must not capture the walk.
        ctx.expect(puppeteerRoot(targetDir)).toBe(root);
      },
    },

    {
      name: 'an unreadable manifest is walked past, never read as a brand root',
      run: (ctx) => {
        const root = stageBrand();
        write(path.join(root, 'targets', 'web', 'package.json'), '{ not json');

        ctx.expect(puppeteerRoot(path.join(root, 'targets', 'web'))).toBe(root);
      },
    },

    {
      name: 'inside this monorepo the walk stops at the nearest package (no brand above it)',
      run: (ctx) => {
        // No manifest here declares @omega.js/manager, so the fallback answers: this
        // package. Node climbs from there to the root install that hoisted puppeteer.
        ctx.expect(puppeteerRoot(__dirname)).toBe(path.resolve(__dirname, '..'));
      },
    },

    // ---- resolvePuppeteer

    {
      name: 'resolvePuppeteer loads the brand root\'s puppeteer from a lane deep inside it',
      run: (ctx) => {
        const root = stageBrand();
        const puppeteer = resolvePuppeteer(path.join(root, 'test', 'e2e'));
        ctx.expect(typeof puppeteer.launch).toBe('function');
        ctx.expect(puppeteer.executablePath()).toBe(process.execPath);
      },
    },

    {
      name: 'a brand root with no puppeteer installed throws, naming the root and the carrier',
      run: (ctx) => {
        const root = stageBrand({ puppeteer: 'absent' });
        ctx.expect(() => resolvePuppeteer(root)).toThrow(new RegExp(`puppeteer is not installed at ${root}`));
        ctx.expect(() => resolvePuppeteer(root)).toThrow(/@omega\.js\/manager carries it/);
      },
    },

    {
      name: 'an installed puppeteer whose Chrome is missing throws the install line',
      run: (ctx) => {
        const root = stageBrand({ chrome: 'absent' });
        ctx.expect(() => resolvePuppeteer(root)).toThrow(/Chrome is not installed at .*no-such-chrome/);
        ctx.expect(() => resolvePuppeteer(root)).toThrow(/puppeteer browsers install chrome/);
      },
    },

    // ---- launchBrowser

    {
      name: 'launchBrowser runs headless with the lane args, resolved from the brand root',
      run: async (ctx) => {
        const root = stageBrand();
        const browser = await launchBrowser({ from: path.join(root, 'test', 'e2e') });

        ctx.expect(browser.launched.headless).toBe(true);
        ctx.expect(browser.launched.args).toEqual(LAUNCH_ARGS);
      },
    },

    {
      name: 'extra args append to the lane args, and other launch options pass through',
      run: async (ctx) => {
        const root = stageBrand();
        const browser = await launchBrowser({
          from: root,
          args: ['--host-resolver-rules=MAP * ~NOTFOUND'],
          devtools: true,
          headless: 'shell',
        });

        ctx.expect(browser.launched.args).toEqual([...LAUNCH_ARGS, '--host-resolver-rules=MAP * ~NOTFOUND']);
        ctx.expect(browser.launched.devtools).toBe(true);
        ctx.expect(browser.launched.headless, 'an explicit headless mode wins over the default').toBe('shell');
      },
    },

    {
      name: 'an injected puppeteer skips resolution entirely (the lane owns its own driver)',
      run: async (ctx) => {
        const calls = [];
        const fake = { launch: async (options) => { calls.push(options); return { fake: true }; } };

        const browser = await launchBrowser({ from: '/nowhere-at-all', puppeteer: fake });

        ctx.expect(browser).toEqual({ fake: true });
        ctx.expect(calls[0].args).toEqual(LAUNCH_ARGS);
      },
    },
  ],
});
