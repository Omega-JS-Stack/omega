/**
 * The first run from a brand-template copy: the marked folder becomes the
 * brand, the id comes from the repo name, the contact name from git, and the
 * run installs and starts the dev stack itself unless told `--no-dev`. Outside
 * a first run, onboard prints the next steps and offers manage as it always has.
 * The install and the dev stack go through the process seam and never really run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  calls, folder, git, emptyGitConfig, withOrigin, readConfig, pluginInstalled, captureConsole, quietly, driveWizard, ENTER_THE_REST,
} = require('./lib/onboard-seams.js');
require('@omega.js/devkit/test/temp-home');

const { runOnboard } = require('../src/onboard.js');
const Main = require('../src/cli.js');
const { openTtyPrompt } = require('./lib/interactive.js');
const { stageTemplate } = require('./lib/brand-template.js');

pluginInstalled();

/** Point git at an empty global config for this test; `name` sets the work tree's own user. */
function gitIdentity(t, dir, name) {
  emptyGitConfig(t);
  git(dir, 'init', '-q');
  if (name) git(dir, 'config', 'user.name', name);
  return dir;
}

const since = (mark, kind) => calls.slice(mark).filter((call) => call.kind === kind);

// ─── The brand id ────────────────────────────────────────────────────────────

test('#1023 case 5: a first run in a folder named acme-omega, with no flags and no terminal, makes the brand acme', async () => {
  const root = stageTemplate(folder('acme-omega'));

  const { report } = await quietly(() => runOnboard(root, { dev: false }));

  assert.equal(report.firstRun, true);
  assert.equal(readConfig(root).brand.id, 'acme');
});

test('#1023 case 6: an origin of someone/acme-omega makes the brand acme', async () => {
  const root = stageTemplate(withOrigin(folder('my-clone'), 'someone/acme-omega'));

  const { report } = await quietly(() => runOnboard(root, { dev: false }));

  assert.equal(report.firstRun, true);
  assert.equal(readConfig(root).brand.id, 'acme');
});

test('#1023 case 7: an origin repo named my-site with the id acme prints the mismatch line and carries on', async () => {
  const root = stageTemplate(withOrigin(folder('my-site'), 'someone/my-site'));

  const { report, output } = await quietly(() => runOnboard(root, { id: 'acme', dev: false }));

  assert.ok(
    output.includes('Your repo is named my-site. OMEGA expects acme-omega. Rename it: gh repo rename acme-omega'),
    `the mismatch line: ${output}`,
  );
  assert.equal(report.valid, true, 'the run carried on');
  assert.equal(readConfig(root).brand.id, 'acme');
});

// ─── The handover ────────────────────────────────────────────────────────────

test('#1023 case 8: a first run writes the project, then installs, then starts the dev stack', async () => {
  const root = stageTemplate(folder('acme-omega'));
  const mark = calls.length;

  const { report } = await quietly(() => runOnboard(root, { id: 'acme' }));

  assert.equal(report.firstRun, true);
  const kinds = calls.slice(mark).map((call) => call.kind);
  assert.ok(kinds.includes('install'), `dependencies were installed: ${JSON.stringify(kinds)}`);
  assert.equal(since(mark, 'dev').length, 1, 'the dev stack was asked to start once');
  assert.ok(kinds.indexOf('install') < kinds.indexOf('dev'), 'the install comes before the dev stack');

  const install = since(mark, 'install')[0];
  assert.equal(fs.realpathSync(install.cwd), root, 'the install runs at the brand root');
  const atInstall = JSON.parse(install.packageJson);
  assert.equal(atInstall.name, 'acme', 'the project was written before the install');
  assert.ok(!('omega' in atInstall), 'the template package.json was already replaced');
  assert.equal(fs.realpathSync(since(mark, 'dev')[0].cwd), root, 'the dev stack starts at the brand root');
  assert.equal(report.devExitCode, 0);
});

test('#1023 case 8: --no-dev stops before the dev stack', async () => {
  const root = stageTemplate(folder('acme-omega'));
  const mark = calls.length;

  const { report } = await quietly(() => runOnboard(root, { id: 'acme', dev: false }));

  assert.equal(report.firstRun, true);
  assert.equal(readConfig(root).brand.id, 'acme', 'the project is written');
  assert.deepEqual(since(mark, 'dev'), [], 'no dev stack');
  assert.notEqual(typeof report.devExitCode, 'number');
});

test('#1023 case 8: a first run with zero targets starts no dev stack and prints the command that adds one', async () => {
  const root = stageTemplate(folder('acme-omega'));
  const mark = calls.length;

  const { report, output } = await quietly(() => runOnboard(root, { id: 'acme', targets: 'none' }));

  assert.equal(report.firstRun, true);
  assert.deepEqual(since(mark, 'dev'), [], 'no dev stack');
  assert.ok(output.includes('npx omega onboard --targets=web'), `the command that adds a target: ${output}`);
});

test('#1023 case 9: a folder with no marker prints the next steps and offers manage, as today', async (t) => {
  const root = folder('plain-brand');
  const mark = calls.length;
  const tty = openTtyPrompt();
  const capture = captureConsole();
  t.after(() => {
    tty.close();
    capture.restore();
  });

  const run = runOnboard(root, { id: 'plain', name: 'Plain', url: 'https://plain.test', targets: 'web', contactName: 'Jane Doe' });
  const { report, asked } = await driveWizard(tty, run, { ...ENTER_THE_REST, 'Run manage now?': 'n\r' });

  assert.equal(report.firstRun, false);
  assert.ok(asked.includes('Run manage now?'), 'manage was offered');
  assert.equal(report.manageExitCode, null);
  assert.match(capture.text(), /next steps/i);
  assert.deepEqual(calls.slice(mark), [], 'no install and no dev stack outside a first run');
});

// ─── The contact name ────────────────────────────────────────────────────────

test('#1023 case 11: the contact name defaults to the git user name, in a terminal and without one; no name leaves it out', async (t) => {
  const flags = { name: 'Graceful', url: 'https://graceful.test', targets: 'web', manage: false };

  const typed = gitIdentity(t, folder('typed'), 'Grace Hopper');
  const tty = openTtyPrompt();
  t.after(() => tty.close());
  await driveWizard(tty, runOnboard(typed, { id: 'typed', ...flags }), { ...ENTER_THE_REST, 'Contact person (': '\r' });
  tty.close();
  assert.deepEqual(readConfig(typed).brand.contact.person, { name: 'Grace Hopper' }, 'Enter takes the git user name');

  const headless = gitIdentity(t, folder('headless'), 'Grace Hopper');
  await quietly(() => runOnboard(headless, { id: 'headless', ...flags }));
  assert.deepEqual(readConfig(headless).brand.contact.person, { name: 'Grace Hopper' }, 'no terminal takes it too');

  const nameless = gitIdentity(t, folder('nameless'));
  await quietly(() => runOnboard(nameless, { id: 'nameless', ...flags }));
  assert.ok(!('person' in readConfig(nameless).brand.contact), 'no git user name, no contact person');
});

// ─── Help ────────────────────────────────────────────────────────────────────

test('#1023 case 12: the "New here?" block in omega help shows the template path', async () => {
  const capture = captureConsole();
  try {
    await new Main({}).process({ _: ['help'] });
  } finally {
    capture.restore();
  }

  const text = capture.text();
  const block = text.slice(text.indexOf('New here?'));
  assert.ok(text.includes('New here?'), `the block is there: ${text}`);
  assert.match(block, /brand-template/, 'it starts from the template');
  assert.match(block, /npm start/, 'and ends on npm start');
  assert.doesNotMatch(block, /npm run manage/, 'the old five-step path is gone');
});
