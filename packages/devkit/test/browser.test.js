// Unit tests for src/test/browser.js — where a lane's puppeteer comes from,
// and what it is launched with.
//
// The resolution runs for REAL against staged trees (a brand root declaring
// @omega.js/manager, a fixture puppeteer in its node_modules), because the
// whole point of the module is which directory node resolves from. Only the
// launch itself is answered by the fixture package — starting real Chrome
// proves puppeteer, not this.

const { test } = require('node:test');
const assert = require('node:assert/strict');
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

// ---- puppeteerRoot

test('the walk stops at the nearest manifest declaring @omega.js/manager', () => {
  const root = stageBrand();
  // A target sits between the lane and the brand root, with its own manifest
  write(path.join(root, 'targets', 'website', 'package.json'), JSON.stringify({ name: 'website' }));
  write(path.join(root, 'targets', 'website', 'test', 'e2e', 'run.js'), '');

  assert.equal(puppeteerRoot(path.join(root, 'test', 'e2e')), root);
  assert.equal(puppeteerRoot(path.join(root, 'targets', 'website', 'test', 'e2e')), root,
    'a target target-root manifest is not the brand root');
});

test('with no manager declared anywhere, the NEAREST manifest answers, never the outermost', () => {
  const dir = scratch();
  write(path.join(dir, 'package.json'), JSON.stringify({ name: 'monorepo', workspaces: ['packages/*'] }));
  const pkgDir = path.join(dir, 'packages', 'devkit');
  write(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@omega.js/devkit' }));

  // Resolution only needs a starting point node can climb FROM: the nearest
  // manifest reaches every install above it, while the outermost would skip a
  // nearer copy a nested install deliberately put there.
  assert.equal(puppeteerRoot(pkgDir), pkgDir);
  assert.equal(puppeteerRoot(path.join(pkgDir, 'test', 'deep')), pkgDir, 'a dir with no manifest of its own climbs to it');
  assert.equal(puppeteerRoot(dir), dir, 'at the outermost, the outermost IS the nearest');
});

test('a DECLARING ancestor still wins over the nearer non-declaring one', () => {
  const root = stageBrand();
  const targetDir = path.join(root, 'targets', 'website');
  write(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'website' }));

  // The brand root declares the manager; the target manifest between them does
  // not, and must not capture the walk.
  assert.equal(puppeteerRoot(targetDir), root);
});

test('an unreadable manifest is walked past, never read as a brand root', () => {
  const root = stageBrand();
  write(path.join(root, 'targets', 'website', 'package.json'), '{ not json');

  assert.equal(puppeteerRoot(path.join(root, 'targets', 'website')), root);
});

test('inside this monorepo the walk stops at the nearest package (no brand above it)', () => {
  // No manifest here declares @omega.js/manager, so the fallback answers: this
  // package. Node climbs from there to the root install that hoisted puppeteer.
  assert.equal(puppeteerRoot(__dirname), path.resolve(__dirname, '..'));
});

// ---- resolvePuppeteer

test('resolvePuppeteer loads the brand root\'s puppeteer from a lane deep inside it', () => {
  const root = stageBrand();
  const puppeteer = resolvePuppeteer(path.join(root, 'test', 'e2e'));
  assert.equal(typeof puppeteer.launch, 'function');
  assert.equal(puppeteer.executablePath(), process.execPath);
});

test('a brand root with no puppeteer installed throws, naming the root and the carrier', () => {
  const root = stageBrand({ puppeteer: 'absent' });
  assert.throws(() => resolvePuppeteer(root), new RegExp(`puppeteer is not installed at ${root}`));
  assert.throws(() => resolvePuppeteer(root), /@omega\.js\/manager carries it/);
});

test('an installed puppeteer whose Chrome is missing throws the install line', () => {
  const root = stageBrand({ chrome: 'absent' });
  assert.throws(() => resolvePuppeteer(root), /Chrome is not installed at .*no-such-chrome/);
  assert.throws(() => resolvePuppeteer(root), /puppeteer browsers install chrome/);
});

// ---- launchBrowser

test('launchBrowser runs headless with the lane args, resolved from the brand root', async () => {
  const root = stageBrand();
  const browser = await launchBrowser({ from: path.join(root, 'test', 'e2e') });

  assert.equal(browser.launched.headless, true);
  assert.deepEqual(browser.launched.args, LAUNCH_ARGS);
});

test('extra args append to the lane args, and other launch options pass through', async () => {
  const root = stageBrand();
  const browser = await launchBrowser({
    from: root,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND'],
    devtools: true,
    headless: 'shell',
  });

  assert.deepEqual(browser.launched.args, [...LAUNCH_ARGS, '--host-resolver-rules=MAP * ~NOTFOUND']);
  assert.equal(browser.launched.devtools, true);
  assert.equal(browser.launched.headless, 'shell', 'an explicit headless mode wins over the default');
});

test('an injected puppeteer skips resolution entirely (the lane owns its own driver)', async () => {
  const calls = [];
  const fake = { launch: async (options) => { calls.push(options); return { fake: true }; } };

  const browser = await launchBrowser({ from: '/nowhere-at-all', puppeteer: fake });

  assert.deepEqual(browser, { fake: true });
  assert.deepEqual(calls[0].args, LAUNCH_ARGS);
});
