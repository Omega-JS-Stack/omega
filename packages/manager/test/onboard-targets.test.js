/**
 * The target choice in onboard: the website alone by default, zero targets
 * allowed, and a rerun that adds the targets a brand lacks while changing
 * nothing already written. Removing a target stays by hand.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  folder, readConfig, pluginInstalled, captureConsole, quietly, driveWizard, pressEnterThrough, sleep, ENTER_THE_REST,
} = require('./lib/onboard-seams.js');
require('@omega.js/devkit/test/temp-home');
const { recordBrand } = require('@omega.js/config');

const { runOnboard } = require('../src/onboard.js');
const { openTtyPrompt } = require('./lib/interactive.js');

pluginInstalled();

const FLAGS = { name: 'Target Brand', url: 'https://targetbrand.test', contactName: 'Jane Doe', manage: false };
const REMOVAL_LINE = 'Removing a target is by hand: delete targets/web and its entry in config/omega.json5.';

/** At the target list, press `key` (the item's number toggles it), then Enter. */
const toggleTargets = (tty, key) => async () => {
  await sleep(100);
  await tty.answer('Targets (', key);
  await sleep(150);
  await tty.answer('Targets (', '\r');
};

/** Every file under `dir`, by relative path, with its contents. */
function snapshot(dir) {
  return Object.fromEntries(fs.readdirSync(dir, { recursive: true })
    .filter((rel) => fs.statSync(path.join(dir, rel)).isFile())
    .map((rel) => [rel, fs.readFileSync(path.join(dir, rel), 'utf8')]));
}

const targetFolders = (root) => (fs.existsSync(path.join(root, 'targets')) ? fs.readdirSync(path.join(root, 'targets')) : []);

test('#1030 case 1: Enter at every question gives a brand whose targets hold only web', async (t) => {
  const root = folder('enter-brand');
  const tty = openTtyPrompt();
  const capture = captureConsole();
  t.after(() => {
    tty.close();
    capture.restore();
  });

  // The contact name is flagged so no machine's git identity decides whether Enter can pass it
  const report = await pressEnterThrough(tty, runOnboard(root, { contactName: 'Jane Doe', manage: false }));

  assert.equal(report.valid, true);
  assert.deepEqual(Object.keys(readConfig(root).targets), ['web']);
});

test('#1030 case 2: --targets=none, or an empty pick, gives an empty targets object, a valid config and no target folder', async (t) => {
  const flagged = folder('none-brand');
  const { report } = await quietly(() => runOnboard(flagged, { id: 'none-brand', ...FLAGS, targets: 'none' }));

  assert.equal(report.valid, true);
  assert.deepEqual(readConfig(flagged).targets, {});
  assert.deepEqual(targetFolders(flagged), []);

  const picked = folder('empty-pick');
  const tty = openTtyPrompt();
  const capture = captureConsole();
  t.after(() => {
    tty.close();
    capture.restore();
  });
  const run = runOnboard(picked, { id: 'empty-pick', ...FLAGS });
  const { report: pickReport } = await driveWizard(tty, run, { ...ENTER_THE_REST, 'Targets (': toggleTargets(tty, '1') });

  assert.equal(pickReport.valid, true);
  assert.deepEqual(readConfig(picked).targets, {});
  assert.deepEqual(targetFolders(picked), []);
});

test('#1030 case 3: a rerun on a brand with zero targets creates no target file', async () => {
  const root = folder('zero-brand');
  await quietly(() => runOnboard(root, { id: 'zero-brand', ...FLAGS, targets: 'none' }));

  const { report } = await quietly(() => runOnboard(root, { manage: false }));

  assert.deepEqual(report.created.filter((file) => file.startsWith('targets/')), []);
  assert.deepEqual(targetFolders(root), []);
  assert.deepEqual(readConfig(root).targets, {});
});

test('#1030 case 5: a rerun with --targets=web,backend adds backend (and the cloud block a backend needs) and changes nothing else', async () => {
  const root = folder('site-brand');
  await quietly(() => runOnboard(root, { id: 'site-brand', ...FLAGS, targets: 'web' }));
  const configPath = path.join(root, 'config', 'omega.json5');
  const rawBefore = fs.readFileSync(configPath, 'utf8');
  const before = readConfig(root);
  const web = snapshot(path.join(root, 'targets', 'web'));

  const { report } = await quietly(() => runOnboard(root, { targets: 'web,backend', manage: false }));

  const after = readConfig(root);
  assert.deepEqual(after.targets, { web: { type: 'web' }, backend: { type: 'backend' } });
  const { targets: _beforeTargets, ...restBefore } = before;
  const { targets: _afterTargets, ...restAfter } = after;
  // The one other key: the brand-level block a fresh scaffold writes for a backend, which this brand lacked
  assert.equal(before.cloud, undefined);
  const cloud = { provider: 'firebase', config: { projectId: 'demo-site-brand' } };
  assert.deepEqual(restAfter, { ...restBefore, cloud }, 'every other key is unchanged');
  const rawAfter = fs.readFileSync(configPath, 'utf8');
  for (const line of rawBefore.split('\n').filter((text) => text.trim().startsWith('//'))) {
    assert.ok(rawAfter.includes(line), `the comment line survives: ${line}`);
  }
  assert.ok(report.created.includes('targets/backend/package.json'));
  assert.ok(fs.existsSync(path.join(root, 'targets', 'backend', 'package.json')));
  assert.deepEqual(snapshot(path.join(root, 'targets', 'web')), web, 'the website files are untouched');
});

test('#1030 a rerun seeds what a fresh scaffold writes: desktop added to a company brand gets the fresh scaffold\'s bundleIdPrefix', async (t) => {
  const parent = folder('fixture-co');
  fs.mkdirSync(path.join(parent, 'config'));
  fs.writeFileSync(path.join(parent, 'config', 'omega.json5'), `{
    brand: { id: 'fixture-co', name: 'Fixture Co', url: 'https://fixtureco.com' },
    company: { id: 'self' },
  }`);
  recordBrand({ id: 'fixture-co', root: parent, name: 'Fixture Co', url: 'https://fixtureco.com' });
  const capture = captureConsole();
  t.after(() => capture.restore());
  const flags = { id: 'acme', name: 'Acme', url: 'https://acme.test', contactName: 'Jane Doe', manage: false };
  const answers = { ...ENTER_THE_REST, 'Company brand id': 'fixture-co\r' };
  const prefixOf = (root) => readConfig(root).certificates?.providers?.apple?.bundleIdPrefix;

  const fresh = folder('fresh');
  const freshTty = openTtyPrompt();
  await driveWizard(freshTty, runOnboard(fresh, { ...flags, targets: 'web,backend,desktop' }), answers);
  freshTty.close();

  const grown = folder('grown');
  const grownTty = openTtyPrompt();
  await driveWizard(grownTty, runOnboard(grown, { ...flags, targets: 'web' }), answers);
  grownTty.close();
  assert.equal(prefixOf(grown), undefined, 'no signing target yet, no prefix');
  await runOnboard(grown, { targets: 'web,desktop', manage: false });

  assert.equal(prefixOf(fresh), 'com.fixtureco', 'the fresh scaffold signs under the company domain');
  assert.equal(prefixOf(grown), prefixOf(fresh), 'the rerun seeded the same prefix');
});

test('#1030 case 6:a rerun in a terminal shows web checked; checking backend adds it, unchecking web removes nothing', async (t) => {
  const root = folder('checked-brand');
  await quietly(() => runOnboard(root, { id: 'checked-brand', ...FLAGS, targets: 'web' }));
  const web = snapshot(path.join(root, 'targets', 'web'));
  const capture = captureConsole();
  t.after(() => capture.restore());

  // Only backend toggled: web stays because it was shown checked
  const add = openTtyPrompt();
  await driveWizard(add, runOnboard(root, { manage: false }), { ...ENTER_THE_REST, 'Targets (': toggleTargets(add, '2') });
  add.close();
  assert.deepEqual(Object.keys(readConfig(root).targets).sort(), ['backend', 'web']);
  assert.ok(fs.existsSync(path.join(root, 'targets', 'backend', 'package.json')));
  assert.ok(!capture.text().includes(REMOVAL_LINE), 'nothing was unchecked');

  const remove = openTtyPrompt();
  await driveWizard(remove, runOnboard(root, { manage: false }), { ...ENTER_THE_REST, 'Targets (': toggleTargets(remove, '1') });
  remove.close();
  assert.ok(capture.text().includes(REMOVAL_LINE), `the removal line: ${capture.text()}`);
  assert.deepEqual(Object.keys(readConfig(root).targets).sort(), ['backend', 'web'], 'web is still declared');
  assert.deepEqual(snapshot(path.join(root, 'targets', 'web')), web, 'and its files are untouched');
});
