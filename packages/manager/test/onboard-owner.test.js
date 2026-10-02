/**
 * The GitHub owner question in onboard, written as `repo.org`: the origin
 * remote's owner is the default, `--org` is the flag form, and a missing or
 * signed-out GitHub CLI skips the question with one line. The CLI is the fake
 * `gh` the seams put first on PATH; nothing here reaches GitHub.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  useGh, withoutGh, ghCalls, folder, withOrigin, readConfig, pluginInstalled, captureConsole, quietly, driveWizard, pressEnterThrough, sleep,
  ENTER_THE_REST,
} = require('./lib/onboard-seams.js');
require('@omega.js/devkit/test/temp-home');

const { runOnboard } = require('../src/onboard.js');
const { openTtyPrompt } = require('./lib/interactive.js');
const { createGh } = require('./lib/fake-gh.js');

pluginInstalled();

const FLAGS = { name: 'Acme', url: 'https://acme.test', targets: 'web', contactName: 'Jane Doe', manage: false };
const CREATE_ORG_URL = 'https://github.com/account/organizations/new';
const SKIP_LINE = 'GitHub CLI is not signed in, so the repo owner was not set. Set repo.org in config/omega.json5 later.';

/** Open a fake terminal with the console captured, both undone after the test. */
function terminal(t) {
  const tty = openTtyPrompt();
  const capture = captureConsole();
  t.after(() => {
    tty.close();
    capture.restore();
  });
  return { tty, capture };
}

async function until(check, label, timeoutMs = 10000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(20);
  }
}

test('#889 case 2, in the wizard: the org holding <brand id>-omega ranks first, and a probe that fails counts as not the holder', async (t) => {
  t.after(useGh({ user: 'jane', orgs: ['beta', 'zz-holder', 'alpha'], repos: ['zz-holder/acme-omega'], failing: ['beta/acme-omega'] }));
  const root = folder('holder');
  const { tty } = terminal(t);

  // The list reads: create a new org, then the holder; a number key picks
  const pickSecond = async () => {
    await sleep(100);
    await tty.answer('zz-holder', '2');
    await sleep(150);
    await tty.answer('zz-holder', '\r');
  };
  const { report } = await driveWizard(tty, runOnboard(root, { id: 'acme', ...FLAGS }), { ...ENTER_THE_REST, 'zz-holder': pickSecond });

  assert.equal(report.valid, true, 'the failed probe threw nothing');
  assert.deepEqual(readConfig(root).repo, { org: 'zz-holder' });
});

test('#889 case 3: an origin of someone/acme-omega makes someone the default, and a run with no terminal writes repo.org: someone', async (t) => {
  const headless = withOrigin(folder('acme-omega'), 'someone/acme-omega');
  await quietly(() => runOnboard(headless, { id: 'acme', ...FLAGS }));
  assert.deepEqual(readConfig(headless).repo, { org: 'someone' });

  // In a terminal, Enter takes the default, ahead of the org named like the brand
  t.after(useGh({ user: 'jane', orgs: ['acme', 'someone', 'zeta'] }));
  const typed = withOrigin(folder('acme-omega'), 'someone/acme-omega');
  const { tty } = terminal(t);
  await pressEnterThrough(tty, runOnboard(typed, { id: 'acme', ...FLAGS }));
  assert.deepEqual(readConfig(typed).repo, { org: 'someone' });
});

test('#889 case 4: --org=acme-co writes repo: { org: \'acme-co\' }', async () => {
  const root = folder('flagged');

  await quietly(() => runOnboard(root, { id: 'acme', org: 'acme-co', ...FLAGS }));

  assert.deepEqual(readConfig(root).repo, { org: 'acme-co' });
});

test('#889 case 5: no terminal, no flag and no origin writes no repo block', async () => {
  const root = folder('ownerless');

  await quietly(() => runOnboard(root, { id: 'acme', ...FLAGS }));

  assert.ok(!('repo' in readConfig(root)), 'no repo block');
});

test('#889 case 6: with no origin, a missing or signed-out GitHub CLI skips the question with the skip line, and writes no repo block', async (t) => {
  const signedOut = folder('signed-out');
  const first = terminal(t);
  await pressEnterThrough(first.tty, runOnboard(signedOut, { id: 'acme', ...FLAGS }));
  first.tty.close();
  first.capture.restore();
  assert.ok(first.capture.text().includes(SKIP_LINE), `signed out, the skip line: ${first.capture.text()}`);
  assert.ok(!('repo' in readConfig(signedOut)));

  t.after(withoutGh());
  const missing = folder('no-gh');
  const second = terminal(t);
  await pressEnterThrough(second.tty, runOnboard(missing, { id: 'acme', ...FLAGS }));
  assert.ok(second.capture.text().includes(SKIP_LINE), `no gh at all, the skip line: ${second.capture.text()}`);
  assert.ok(!('repo' in readConfig(missing)));
});

test('#889 case 6, with an origin: in a terminal, a GitHub CLI that cannot answer leaves the origin owner as the answer, and no skip line', async (t) => {
  const signedOut = withOrigin(folder('acme-omega'), 'someone/acme-omega');
  const first = terminal(t);
  await pressEnterThrough(first.tty, runOnboard(signedOut, { id: 'acme', ...FLAGS }));
  first.tty.close();
  first.capture.restore();
  assert.deepEqual(readConfig(signedOut).repo, { org: 'someone' }, 'signed out');
  assert.ok(!first.capture.text().includes(SKIP_LINE), `no skip line when the origin answers: ${first.capture.text()}`);

  t.after(withoutGh());
  const missing = withOrigin(folder('acme-omega'), 'someone/acme-omega');
  const second = terminal(t);
  await pressEnterThrough(second.tty, runOnboard(missing, { id: 'acme', ...FLAGS }));
  assert.deepEqual(readConfig(missing).repo, { org: 'someone' }, 'no gh at all');
  assert.ok(!second.capture.text().includes(SKIP_LINE));
});

test('#889 case 6, an old GitHub CLI: when `gh api user/orgs` fails (no --slurp), the wizard skips the question and never throws', async (t) => {
  t.after(useGh({ user: 'jane', orgs: ['acme', 'beta'], noSlurp: true }));
  const root = folder('old-gh');
  const { tty } = terminal(t);

  const report = await pressEnterThrough(tty, runOnboard(root, { id: 'acme', ...FLAGS }));

  assert.equal(report.valid, true);
  assert.ok(!('repo' in readConfig(root)), 'no repo block');
});

test('#889 a `ghExec` runner passed to runOnboard is the one the owner question uses', async (t) => {
  const ghExec = createGh({ user: 'jane', orgs: ['acme', 'beta'] });
  const root = folder('injected');
  const { tty } = terminal(t);
  const pathCalls = ghCalls().length;

  // The list reads: create a new org, then acme, the best match; a number key picks
  const pickSecond = async () => {
    await sleep(100);
    await tty.answer('beta', '2');
    await sleep(150);
    await tty.answer('beta', '\r');
  };
  await driveWizard(tty, runOnboard(root, { id: 'acme', ...FLAGS, ghExec }), { ...ENTER_THE_REST, beta: pickSecond });

  assert.ok(ghExec.calls.some((args) => args.includes('user/orgs')), `the injected runner listed the orgs: ${JSON.stringify(ghExec.calls)}`);
  assert.deepEqual(ghCalls().slice(pathCalls), [], 'the gh on PATH was never called');
  assert.deepEqual(readConfig(root).repo, { org: 'acme' });
});

test('#889 case 7:picking "create a new org" prints the GitHub page for it and asks again', async (t) => {
  t.after(useGh({ user: 'jane', orgs: ['zeta', 'acme', 'beta'] }));
  const root = folder('creator');
  const { tty, capture } = terminal(t);
  // Printed to the console or onto the prompt itself
  const pageShown = async () => capture.text().includes(CREATE_ORG_URL) || tty.waitFor(CREATE_ORG_URL, 0).then(() => true, () => false);

  // The list reads: create a new org, acme, beta, jane, zeta; a number key picks
  const pickOwner = async () => {
    await sleep(100);
    await tty.answer('zeta', '1');
    await sleep(150);
    await tty.answer('zeta', '\r');
    await until(pageShown, 'the create-org page');
    await sleep(300);
    await tty.answer('zeta', '2');
    await sleep(150);
    await tty.answer('zeta', '\r');
  };

  await driveWizard(tty, runOnboard(root, { id: 'acme', ...FLAGS }), { ...ENTER_THE_REST, zeta: pickOwner });

  assert.ok(await pageShown(), 'the GitHub page for a new org was printed');
  assert.deepEqual(readConfig(root).repo, { org: 'acme' }, 'the question came back, and the second answer was written');
});
