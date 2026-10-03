/**
 * launch-cft tests — the launcher replaces a mac-arm64-only shell glob, so
 * the platform shapes and the newest-version pick are the behavior under
 * test. The spawn is an injected seam: no Chrome is ever started here.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { findChromeForTesting, buildArgs, byVersionDesc, main } = require('../src/launch-cft.js');
const { resolveBin } = require('../src/lib/env.js');

// One version directory per platform shape, exactly as puppeteer lays it out.
const SHAPES = {
  'darwin-arm64': () => ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'],
  'darwin-x64': () => ['chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'],
  linux: () => ['chrome-linux64/chrome'],
  win32: () => ['chrome-win64/chrome.exe'],
};

/**
 * Build a puppeteer-shaped cache dir.
 *
 * @param {object} versions - version dir name → array of relative executable paths
 * @returns {string} The cache dir
 */
function cacheFixture(versions) {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-cft-'));
  for (const [version, files] of Object.entries(versions)) {
    for (const file of files) {
      const full = path.join(cacheDir, version, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '');
    }
  }
  return cacheDir;
}

module.exports = defineCases({
  type: 'group',
  description: 'launch-cft',
  tests: [
    {
      name: 'macOS arm64 finds the binary inside the .app bundle',
      run: (ctx) => {
        const cacheDir = cacheFixture({ 'mac_arm-150.0.7871.24': SHAPES['darwin-arm64']() });
        const found = findChromeForTesting({ cacheDir, platform: 'darwin', arch: 'arm64' });
        ctx.expect(found).toBe(path.join(cacheDir, 'mac_arm-150.0.7871.24', 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'));
      },
    },

    {
      name: 'macOS x64 reads the intel bundle dir, not the arm one',
      run: (ctx) => {
        const cacheDir = cacheFixture({ 'mac-150.0.7871.24': SHAPES['darwin-x64']() });
        ctx.expect(findChromeForTesting({ cacheDir, platform: 'darwin', arch: 'x64' }).includes('chrome-mac-x64')).toBeTruthy();
        ctx.expect(findChromeForTesting({ cacheDir, platform: 'darwin', arch: 'arm64' })).toBe(null);
      },
    },

    {
      name: 'linux and windows each find their fixed executable',
      run: (ctx) => {
        const linux = cacheFixture({ 'linux-150.0.7871.24': SHAPES.linux() });
        ctx.expect(findChromeForTesting({ cacheDir: linux, platform: 'linux', arch: 'x64' })).toBe(path.join(linux, 'linux-150.0.7871.24', 'chrome-linux64', 'chrome'));

        const win = cacheFixture({ 'win64-150.0.7871.24': SHAPES.win32() });
        ctx.expect(findChromeForTesting({ cacheDir: win, platform: 'win32', arch: 'x64' })).toBe(path.join(win, 'win64-150.0.7871.24', 'chrome-win64', 'chrome.exe'));
      },
    },

    {
      name: 'the highest version wins, numerically — not by string sort',
      run: (ctx) => {
        const cacheDir = cacheFixture({
          'mac_arm-99.0.1234.5': SHAPES['darwin-arm64'](),
          'mac_arm-150.0.7871.24': SHAPES['darwin-arm64'](),
          'mac_arm-150.0.7871.9': SHAPES['darwin-arm64'](),
        });
        ctx.expect(findChromeForTesting({ cacheDir, platform: 'darwin', arch: 'arm64' }).includes('mac_arm-150.0.7871.24')).toBeTruthy();
      },
    },

    {
      name: 'a version dir that holds no executable for this platform is skipped',
      run: (ctx) => {
        const cacheDir = cacheFixture({
          'mac_arm-150.0.7871.24': ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/Info.plist'],
          'mac_arm-149.0.7827.22': SHAPES['darwin-arm64'](),
        });
        ctx.expect(findChromeForTesting({ cacheDir, platform: 'darwin', arch: 'arm64' }).includes('mac_arm-149.0.7827.22')).toBeTruthy();
      },
    },

    {
      name: 'an empty or absent cache resolves to nothing',
      run: (ctx) => {
        ctx.expect(findChromeForTesting({ cacheDir: cacheFixture({}), platform: 'darwin', arch: 'arm64' })).toBe(null);
        ctx.expect(findChromeForTesting({ cacheDir: '/no/such/cache', platform: 'linux', arch: 'x64' })).toBe(null);
      },
    },

    {
      name: 'byVersionDesc orders newest first',
      run: (ctx) => {
        ctx.expect(['mac_arm-9.0.0.0', 'mac_arm-150.0.7871.24', 'mac_arm-115.0.5790.98'].sort(byVersionDesc)).toEqual(['mac_arm-150.0.7871.24', 'mac_arm-115.0.5790.98', 'mac_arm-9.0.0.0']);
      },
    },

    {
      name: 'the base argv drives an isolated throwaway Chrome at the found executable',
      run: (ctx) => {
        ctx.expect(buildArgs('/cft/chrome', {})).toEqual([
          '-y',
          'chrome-devtools-mcp@1.4.0',
          '--isolated',
          '--acceptInsecureCerts',
          '--usage-statistics=false',
          '--executablePath=/cft/chrome',
          '--categoryExtensions',
        ]);
      },
    },

    {
      name: 'OMEGA_EXTENSION_PATH adds the load-extension pair',
      run: (ctx) => {
        const args = buildArgs('/cft/chrome', { OMEGA_EXTENSION_PATH: '/brand/targets/extension/dist' });
        ctx.expect(args.slice(-3)).toEqual([
          '--chromeArg=--load-extension=/brand/targets/extension/dist',
          '--ignoreDefaultChromeArg=--disable-extensions',
          '--categoryExtensions',
        ]);
      },
    },

    {
      name: 'main spawns the resolved npx with the built argv and forwards the child exit code',
      run: (ctx) => {
        const calls = [];
        const exits = [];
        main({
          find: () => '/cft/chrome',
          env: { OMEGA_EXTENSION_PATH: '/ext' },
          exit: (code) => exits.push(code),
          spawn: (command, args, options) => {
            calls.push({ command, args, options });
            return { on: (event, handler) => { if (event === 'exit') handler(3, null); } };
          },
        });
        ctx.expect(calls.length).toBe(1);
        // win32 spawns through a shell, where the absolute path needs its quotes.
        ctx.expect(calls[0].command).toBe(process.platform === 'win32' ? `"${resolveBin('npx')}"` : resolveBin('npx'));
        ctx.expect(calls[0].options.stdio).toBe('inherit');
        ctx.expect(calls[0].args).toEqual(buildArgs('/cft/chrome', { OMEGA_EXTENSION_PATH: '/ext' }));
        ctx.expect(exits).toEqual([3]);
      },
    },

    {
      name: 'no Chrome for Testing fails loudly with the install hint and never spawns',
      run: (ctx) => {
        const exits = [];
        const said = [];
        const write = process.stderr.write.bind(process.stderr);
        process.stderr.write = (chunk) => { said.push(String(chunk)); return true; };
        try {
          main({
            find: () => null,
            env: {},
            exit: (code) => exits.push(code),
            spawn: () => ctx.expect.fail('must not spawn without an executable'),
          });
        } finally {
          process.stderr.write = write;
        }
        ctx.expect(exits).toEqual([1]);
        ctx.expect(said.join('')).toMatch(/npx puppeteer browsers install chrome/);
      },
    },
  ],
});
