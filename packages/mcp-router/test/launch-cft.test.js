/**
 * launch-cft tests — the launcher replaces a mac-arm64-only shell glob, so
 * the platform shapes and the newest-version pick are the behavior under
 * test. The spawn is an injected seam: no Chrome is ever started here.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { findChromeForTesting, buildArgs, byVersionDesc, main } = require('../src/launch-cft.js');

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

test('macOS arm64 finds the binary inside the .app bundle', () => {
  const cacheDir = cacheFixture({ 'mac_arm-150.0.7871.24': SHAPES['darwin-arm64']() });
  const found = findChromeForTesting({ cacheDir, platform: 'darwin', arch: 'arm64' });
  assert.equal(found, path.join(cacheDir, 'mac_arm-150.0.7871.24', 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'));
});

test('macOS x64 reads the intel bundle dir, not the arm one', () => {
  const cacheDir = cacheFixture({ 'mac-150.0.7871.24': SHAPES['darwin-x64']() });
  assert.ok(findChromeForTesting({ cacheDir, platform: 'darwin', arch: 'x64' }).includes('chrome-mac-x64'));
  assert.equal(findChromeForTesting({ cacheDir, platform: 'darwin', arch: 'arm64' }), null);
});

test('linux and windows each find their fixed executable', () => {
  const linux = cacheFixture({ 'linux-150.0.7871.24': SHAPES.linux() });
  assert.equal(findChromeForTesting({ cacheDir: linux, platform: 'linux', arch: 'x64' }), path.join(linux, 'linux-150.0.7871.24', 'chrome-linux64', 'chrome'));

  const win = cacheFixture({ 'win64-150.0.7871.24': SHAPES.win32() });
  assert.equal(findChromeForTesting({ cacheDir: win, platform: 'win32', arch: 'x64' }), path.join(win, 'win64-150.0.7871.24', 'chrome-win64', 'chrome.exe'));
});

test('the highest version wins, numerically — not by string sort', () => {
  const cacheDir = cacheFixture({
    'mac_arm-99.0.1234.5': SHAPES['darwin-arm64'](),
    'mac_arm-150.0.7871.24': SHAPES['darwin-arm64'](),
    'mac_arm-150.0.7871.9': SHAPES['darwin-arm64'](),
  });
  assert.ok(findChromeForTesting({ cacheDir, platform: 'darwin', arch: 'arm64' }).includes('mac_arm-150.0.7871.24'));
});

test('a version dir that holds no executable for this platform is skipped', () => {
  const cacheDir = cacheFixture({
    'mac_arm-150.0.7871.24': ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/Info.plist'],
    'mac_arm-149.0.7827.22': SHAPES['darwin-arm64'](),
  });
  assert.ok(findChromeForTesting({ cacheDir, platform: 'darwin', arch: 'arm64' }).includes('mac_arm-149.0.7827.22'));
});

test('an empty or absent cache resolves to nothing', () => {
  assert.equal(findChromeForTesting({ cacheDir: cacheFixture({}), platform: 'darwin', arch: 'arm64' }), null);
  assert.equal(findChromeForTesting({ cacheDir: '/no/such/cache', platform: 'linux', arch: 'x64' }), null);
});

test('byVersionDesc orders newest first', () => {
  assert.deepEqual(['mac_arm-9.0.0.0', 'mac_arm-150.0.7871.24', 'mac_arm-115.0.5790.98'].sort(byVersionDesc), ['mac_arm-150.0.7871.24', 'mac_arm-115.0.5790.98', 'mac_arm-9.0.0.0']);
});

test('the base argv drives an isolated throwaway Chrome at the found executable', () => {
  assert.deepEqual(buildArgs('/cft/chrome', {}), [
    '-y',
    'chrome-devtools-mcp@1.4.0',
    '--isolated',
    '--acceptInsecureCerts',
    '--usage-statistics=false',
    '--executablePath=/cft/chrome',
    '--categoryExtensions',
  ]);
});

test('OMEGA_EXTENSION_PATH adds the load-extension pair', () => {
  const args = buildArgs('/cft/chrome', { OMEGA_EXTENSION_PATH: '/brand/apps/extension/dist' });
  assert.deepEqual(args.slice(-3), [
    '--chromeArg=--load-extension=/brand/apps/extension/dist',
    '--ignoreDefaultChromeArg=--disable-extensions',
    '--categoryExtensions',
  ]);
});

test('main spawns npx with the built argv and forwards the child exit code', () => {
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
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'npx');
  assert.equal(calls[0].options.stdio, 'inherit');
  assert.deepEqual(calls[0].args, buildArgs('/cft/chrome', { OMEGA_EXTENSION_PATH: '/ext' }));
  assert.deepEqual(exits, [3]);
});

test('no Chrome for Testing fails loudly with the install hint and never spawns', () => {
  const exits = [];
  const said = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { said.push(String(chunk)); return true; };
  try {
    main({
      find: () => null,
      env: {},
      exit: (code) => exits.push(code),
      spawn: () => assert.fail('must not spawn without an executable'),
    });
  } finally {
    process.stderr.write = write;
  }
  assert.deepEqual(exits, [1]);
  assert.match(said.join(''), /npx puppeteer browsers install chrome/);
});
