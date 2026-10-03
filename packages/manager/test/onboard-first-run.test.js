/**
 * The first run from a brand-template copy: the marked folder becomes the
 * brand, the id comes from the repo name, the contact name from git, and the
 * run installs and starts the dev stack itself unless told `--no-dev`. Outside
 * a first run, onboard prints the next steps and offers manage as it always has.
 * The install and the dev stack go through the process seam and never really run.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'onboard-first-run',
  tests: [
    // ─── The brand id ────────────────────────────────────────────────────────────

    {
      name: '#1023 case 5: a first run in a folder named acme-omega, with no flags and no terminal, makes the brand acme',
      run: async (ctx) => {
        const root = stageTemplate(folder('acme-omega'));

        const { report } = await quietly(() => runOnboard(root, { dev: false }));

        ctx.expect(report.firstRun).toBe(true);
        ctx.expect(readConfig(root).brand.id).toBe('acme');
      },
    },

    {
      name: '#1023 case 6: an origin of someone/acme-omega makes the brand acme',
      run: async (ctx) => {
        const root = stageTemplate(withOrigin(folder('my-clone'), 'someone/acme-omega'));

        const { report } = await quietly(() => runOnboard(root, { dev: false }));

        ctx.expect(report.firstRun).toBe(true);
        ctx.expect(readConfig(root).brand.id).toBe('acme');
      },
    },

    {
      name: '#1023 case 7: an origin repo named my-site with the id acme prints the mismatch line and carries on',
      run: async (ctx) => {
        const root = stageTemplate(withOrigin(folder('my-site'), 'someone/my-site'));

        const { report, output } = await quietly(() => runOnboard(root, { id: 'acme', dev: false }));

        ctx.expect(output.includes('Your repo is named my-site. OMEGA expects acme-omega. Rename it: gh repo rename acme-omega'), `the mismatch line: ${output}`).toBeTruthy();
        ctx.expect(report.valid, 'the run carried on').toBe(true);
        ctx.expect(readConfig(root).brand.id).toBe('acme');
      },
    },

    // ─── The handover ────────────────────────────────────────────────────────────

    {
      name: '#1023 case 8: a first run writes the project, then installs, then starts the dev stack',
      run: async (ctx) => {
        const root = stageTemplate(folder('acme-omega'));
        const mark = calls.length;

        const { report } = await quietly(() => runOnboard(root, { id: 'acme' }));

        ctx.expect(report.firstRun).toBe(true);
        const kinds = calls.slice(mark).map((call) => call.kind);
        ctx.expect(kinds.includes('install'), `dependencies were installed: ${JSON.stringify(kinds)}`).toBeTruthy();
        ctx.expect(since(mark, 'dev').length, 'the dev stack was asked to start once').toBe(1);
        ctx.expect(kinds.indexOf('install') < kinds.indexOf('dev'), 'the install comes before the dev stack').toBeTruthy();

        const install = since(mark, 'install')[0];
        ctx.expect(fs.realpathSync(install.cwd), 'the install runs at the brand root').toBe(root);
        const atInstall = JSON.parse(install.packageJson);
        ctx.expect(atInstall.name, 'the project was written before the install').toBe('acme');
        ctx.expect(!('omega' in atInstall), 'the template package.json was already replaced').toBeTruthy();
        ctx.expect(fs.realpathSync(since(mark, 'dev')[0].cwd), 'the dev stack starts at the brand root').toBe(root);
        ctx.expect(report.devExitCode).toBe(0);
      },
    },

    {
      name: '#1023 case 8: --no-dev stops before the dev stack',
      run: async (ctx) => {
        const root = stageTemplate(folder('acme-omega'));
        const mark = calls.length;

        const { report } = await quietly(() => runOnboard(root, { id: 'acme', dev: false }));

        ctx.expect(report.firstRun).toBe(true);
        ctx.expect(readConfig(root).brand.id, 'the project is written').toBe('acme');
        ctx.expect(since(mark, 'dev'), 'no dev stack').toEqual([]);
        ctx.expect(typeof report.devExitCode).not.toBe('number');
      },
    },

    {
      name: '#1023 case 8: a first run with zero targets starts no dev stack and prints the command that adds one',
      run: async (ctx) => {
        const root = stageTemplate(folder('acme-omega'));
        const mark = calls.length;

        const { report, output } = await quietly(() => runOnboard(root, { id: 'acme', targets: 'none' }));

        ctx.expect(report.firstRun).toBe(true);
        ctx.expect(since(mark, 'dev'), 'no dev stack').toEqual([]);
        ctx.expect(output.includes('npx omega onboard --targets=web'), `the command that adds a target: ${output}`).toBeTruthy();
      },
    },

    {
      name: '#1023 case 9: a folder with no marker prints the next steps and offers manage, as today',
      run: async (ctx) => {
        const root = folder('plain-brand');
        const mark = calls.length;
        const tty = openTtyPrompt();
        const capture = captureConsole();
        ctx.after(() => {
          tty.close();
          capture.restore();
        });

        const run = runOnboard(root, { id: 'plain', name: 'Plain', url: 'https://plain.test', targets: 'web', contactName: 'Jane Doe' });
        const { report, asked } = await driveWizard(tty, run, { ...ENTER_THE_REST, 'Run manage now?': 'n\r' });

        ctx.expect(report.firstRun).toBe(false);
        ctx.expect(asked.includes('Run manage now?'), 'manage was offered').toBeTruthy();
        ctx.expect(report.manageExitCode).toBe(null);
        ctx.expect(capture.text()).toMatch(/next steps/i);
        ctx.expect(calls.slice(mark), 'no install and no dev stack outside a first run').toEqual([]);
      },
    },

    // ─── The contact name ────────────────────────────────────────────────────────

    {
      name: '#1023 case 11: the contact name defaults to the git user name, in a terminal and without one; no name leaves it out',
      run: async (ctx) => {
        const flags = { name: 'Graceful', url: 'https://graceful.test', targets: 'web', manage: false };

        const typed = gitIdentity(ctx, folder('typed'), 'Grace Hopper');
        const tty = openTtyPrompt();
        ctx.after(() => tty.close());
        await driveWizard(tty, runOnboard(typed, { id: 'typed', ...flags }), { ...ENTER_THE_REST, 'Contact person (': '\r' });
        tty.close();
        ctx.expect(readConfig(typed).brand.contact.person, 'Enter takes the git user name').toEqual({ name: 'Grace Hopper' });

        const headless = gitIdentity(ctx, folder('headless'), 'Grace Hopper');
        await quietly(() => runOnboard(headless, { id: 'headless', ...flags }));
        ctx.expect(readConfig(headless).brand.contact.person, 'no terminal takes it too').toEqual({ name: 'Grace Hopper' });

        const nameless = gitIdentity(ctx, folder('nameless'));
        await quietly(() => runOnboard(nameless, { id: 'nameless', ...flags }));
        ctx.expect(!('person' in readConfig(nameless).brand.contact), 'no git user name, no contact person').toBeTruthy();
      },
    },

    // ─── Help ────────────────────────────────────────────────────────────────────

    {
      name: '#1023 case 12: the "New here?" block in omega help shows the template path',
      run: async (ctx) => {
        const capture = captureConsole();
        try {
          await new Main({}).process({ _: ['help'] });
        } finally {
          capture.restore();
        }

        const text = capture.text();
        const block = text.slice(text.indexOf('New here?'));
        ctx.expect(text.includes('New here?'), `the block is there: ${text}`).toBeTruthy();
        ctx.expect(block, 'it starts from the template').toMatch(/brand-template/);
        ctx.expect(block, 'and ends on npm start').toMatch(/npm start/);
        ctx.expect(block, 'the old five-step path is gone').not.toMatch(/npm run manage/);
      },
    },
  ],
});
