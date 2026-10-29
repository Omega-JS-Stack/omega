/**
 * The GitHub owner question in onboard, written as `repo.owner`: the origin
 * remote's owner is the default, `--owner` is the flag form, and a missing or
 * signed-out GitHub CLI skips the question with one line. The CLI is the fake
 * `gh` the seams put first on PATH; nothing here reaches GitHub.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const {
  useGh, withoutGh, ghCalls, folder, withOrigin, readConfig, pluginInstalled, captureConsole, quietly, driveWizard, pressEnterThrough, sleep,
  ENTER_THE_REST,
} = require('./lib/onboard-seams.js');
require('@omega.js/devkit/test/temp-home');

const { runOnboard } = require('../src/onboard.js');
const { openTtyPrompt } = require('./lib/interactive.js');
const { createGh } = require('./lib/fake-gh.js');
const { createMachine } = require('./lib/fake-claude.js');

pluginInstalled();

const FLAGS = { name: 'Acme', url: 'https://acme.test', targets: 'web', manage: false };
const CREATE_ORG_URL = 'https://github.com/account/organizations/new';
const SKIP_LINE = 'GitHub CLI is not signed in, so the repo owner was not set. Set repo.owner in config/omega.json5 later.';

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

module.exports = defineCases({
  type: 'group',
  description: 'onboard-owner',
  tests: [
    {
      name: '#889 case 2, in the wizard: the org holding <brand id>-omega ranks first, and a probe that fails counts as not the holder',
      run: async (ctx) => {
        ctx.after(useGh({ user: 'jane', orgs: ['beta', 'zz-holder', 'alpha'], repos: { 'zz-holder/acme-omega': {} }, failing: ['beta/acme-omega'] }));
        const root = folder('holder');
        const { tty } = terminal(ctx);

        // The list reads: create a new org, then the holder; a number key picks
        const pickSecond = async () => {
          await sleep(100);
          await tty.answer('zz-holder', '2');
          await sleep(150);
          await tty.answer('zz-holder', '\r');
        };
        const { report } = await driveWizard(tty, runOnboard(root, { id: 'acme', ...FLAGS }), { ...ENTER_THE_REST, 'zz-holder': pickSecond });

        ctx.expect(report.valid, 'the failed probe threw nothing').toBe(true);
        ctx.expect(readConfig(root).repo).toEqual({ owner: 'zz-holder' });
      },
    },

    {
      name: '#889 case 3: an origin of someone/acme-omega makes someone the default, and a run with no terminal writes repo.owner: someone',
      run: async (ctx) => {
        const headless = withOrigin(folder('acme-omega'), 'someone/acme-omega');
        await quietly(() => runOnboard(headless, { id: 'acme', ...FLAGS }));
        ctx.expect(readConfig(headless).repo).toEqual({ owner: 'someone' });

        // In a terminal, Enter takes the default, ahead of the org named like the brand
        ctx.after(useGh({ user: 'jane', orgs: ['acme', 'someone', 'zeta'] }));
        const typed = withOrigin(folder('acme-omega'), 'someone/acme-omega');
        const { tty } = terminal(ctx);
        await pressEnterThrough(tty, runOnboard(typed, { id: 'acme', ...FLAGS }));
        ctx.expect(readConfig(typed).repo).toEqual({ owner: 'someone' });
      },
    },

    {
      name: '#889 case 4: --owner=acme-co writes repo: { owner: \'acme-co\' }',
      run: async (ctx) => {
        const root = folder('flagged');

        await quietly(() => runOnboard(root, { id: 'acme', owner: 'acme-co', ...FLAGS }));

        ctx.expect(readConfig(root).repo).toEqual({ owner: 'acme-co' });
      },
    },

    {
      name: '--org is no alias: --org=acme-co writes no repo block',
      run: async (ctx) => {
        const root = folder('old-flag');

        await quietly(() => runOnboard(root, { id: 'acme', org: 'acme-co', ...FLAGS }));

        ctx.expect(!('repo' in readConfig(root)), 'the retired flag is unknown, so nothing names an owner').toBeTruthy();
      },
    },

    {
      name: 'a bare --owner is refused, naming the flag form',
      run: async (ctx) => {
        const root = folder('bare-owner');

        await ctx.expect((() => quietly(() => runOnboard(root, { id: 'acme', owner: true, ...FLAGS })))()).rejects.toThrow(/Invalid --owner: pass the GitHub owner \(--owner=acme\)/);
      },
    },

    {
      name: '#889 case 5: no terminal, no flag and no origin writes no repo block',
      run: async (ctx) => {
        const root = folder('ownerless');

        await quietly(() => runOnboard(root, { id: 'acme', ...FLAGS }));

        ctx.expect(!('repo' in readConfig(root)), 'no repo block').toBeTruthy();
      },
    },

    {
      name: '#889 case 6: with no origin, a missing or signed-out GitHub CLI skips the question with the skip line, and writes no repo block',
      run: async (ctx) => {
        const signedOut = folder('signed-out');
        const first = terminal(ctx);
        await pressEnterThrough(first.tty, runOnboard(signedOut, { id: 'acme', ...FLAGS }));
        first.tty.close();
        first.capture.restore();
        ctx.expect(first.capture.text().includes(SKIP_LINE), `signed out, the skip line: ${first.capture.text()}`).toBeTruthy();
        ctx.expect(!('repo' in readConfig(signedOut))).toBeTruthy();

        ctx.after(withoutGh());
        const missing = folder('no-gh');
        const second = terminal(ctx);
        await pressEnterThrough(second.tty, runOnboard(missing, { id: 'acme', ...FLAGS }));
        ctx.expect(second.capture.text().includes(SKIP_LINE), `no gh at all, the skip line: ${second.capture.text()}`).toBeTruthy();
        ctx.expect(!('repo' in readConfig(missing))).toBeTruthy();
      },
    },

    {
      name: '#889 case 6, with an origin: in a terminal, a GitHub CLI that cannot answer leaves the origin owner as the answer, and no skip line',
      run: async (ctx) => {
        const signedOut = withOrigin(folder('acme-omega'), 'someone/acme-omega');
        const first = terminal(ctx);
        await pressEnterThrough(first.tty, runOnboard(signedOut, { id: 'acme', ...FLAGS }));
        first.tty.close();
        first.capture.restore();
        ctx.expect(readConfig(signedOut).repo, 'signed out').toEqual({ owner: 'someone' });
        ctx.expect(!first.capture.text().includes(SKIP_LINE), `no skip line when the origin answers: ${first.capture.text()}`).toBeTruthy();

        ctx.after(withoutGh());
        const missing = withOrigin(folder('acme-omega'), 'someone/acme-omega');
        const second = terminal(ctx);
        await pressEnterThrough(second.tty, runOnboard(missing, { id: 'acme', ...FLAGS }));
        ctx.expect(readConfig(missing).repo, 'no gh at all').toEqual({ owner: 'someone' });
        ctx.expect(!second.capture.text().includes(SKIP_LINE)).toBeTruthy();
      },
    },

    {
      name: '#889 case 6, an old GitHub CLI: when `gh api user/orgs` fails (no --slurp), the wizard skips the question and never throws',
      run: async (ctx) => {
        ctx.after(useGh({ user: 'jane', orgs: ['acme', 'beta'], noSlurp: true }));
        const root = folder('old-gh');
        const { tty } = terminal(ctx);

        const report = await pressEnterThrough(tty, runOnboard(root, { id: 'acme', ...FLAGS }));

        ctx.expect(report.valid).toBe(true);
        ctx.expect(!('repo' in readConfig(root)), 'no repo block').toBeTruthy();
      },
    },

    {
      name: '#1044 one `execFn` passed to runOnboard runs both the owner question and the plugin offer',
      run: async (ctx) => {
        // A machine with claude and no plugin, so the offer is made through the same runner
        const gh = createGh({ user: 'jane', orgs: ['acme', 'beta'] });
        const machine = createMachine({ published: require('../package.json').version });
        const calls = [];
        const execFn = (file, args, options) => {
          calls.push([file, ...args]);
          return file === 'gh' ? gh(file, args, options) : machine.exec(file, args, options);
        };
        const root = folder('injected');
        const { tty } = terminal(ctx);
        const pathCalls = ghCalls().length;

        // The list reads: create a new org, then acme, the best match; a number key picks
        const pickSecond = async () => {
          await sleep(100);
          await tty.answer('beta', '2');
          await sleep(150);
          await tty.answer('beta', '\r');
        };
        const { asked } = await driveWizard(tty, runOnboard(root, { id: 'acme', ...FLAGS, execFn }), { ...ENTER_THE_REST, beta: pickSecond, Claude: 'n\r' });

        ctx.expect(calls.some((call) => call[0] === 'gh' && call.includes('user/orgs')), `the owner question listed the orgs: ${JSON.stringify(calls)}`).toBeTruthy();
        ctx.expect(calls.some((call) => call[0] === 'claude'), `the plugin offer read the machine: ${JSON.stringify(calls)}`).toBeTruthy();
        ctx.expect(asked.includes('Claude'), 'the injected machine has no plugin, so the install was offered').toBeTruthy();
        ctx.expect(ghCalls().slice(pathCalls), 'the gh on PATH was never called').toEqual([]);
        ctx.expect(readConfig(root).repo).toEqual({ owner: 'acme' });
      },
    },

    {
      name: '#889 case 7:picking "create a new org" prints the GitHub page for it and asks again',
      run: async (ctx) => {
        ctx.after(useGh({ user: 'jane', orgs: ['zeta', 'acme', 'beta'] }));
        const root = folder('creator');
        const { tty, capture } = terminal(ctx);
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

        ctx.expect(await pageShown(), 'the GitHub page for a new org was printed').toBeTruthy();
        ctx.expect(readConfig(root).repo, 'the question came back, and the second answer was written').toEqual({ owner: 'acme' });
      },
    },
  ],
});
