// The release workflow's job graph
// ([#802](https://github.com/Omega-JS-Stack/omega/issues/802)).
//
// The workflow runs NO tests. Ian's ruling (2026-09-07): tests run on the
// developer's machine and the commit gate runs the battery at ship, so CI is
// dispatch-only and BUILDS, which is what web's and the extension's release
// workflows already do. Desktop's Test job was the leftover (first ahead of
// Build, then beside it); it is gone, and so is every `needs` on it.
//
// The scaffolded copy is what a consumer's CI executes, so the graph is read
// off a real `copyDefaults` render rather than off the template's tokens.

const path = require('path');
const fs = require('fs');
const os = require('os');
const jetpack = require('fs-jetpack');
const yaml = require('js-yaml');

const { copyDefaults } = require('../../../commands/lib/ensure-target.js');
const { composeWorkflow } = require('@omega.js/devkit/ci-workflows');
const defineCases = require('@omega.js/devkit/test/define-cases');

// GitHub takes `needs` as a string or as a list; the graph question is the same.
const needsOf = (job) => [].concat(job.needs || []);

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'release workflow job graph (#802): a build-only workflow, no test job',
  tests: [
    {
      name: 'there is no Test job, and nothing waits on one',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-workflow-jobs-'));
        await copyDefaults(tmp);
        const { jobs } = yaml.load(jetpack.read(path.join(tmp, '.github', 'workflows', 'build.yml')));

        ctx.expect(Object.keys(jobs)).not.toContain('test');
        for (const job of Object.values(jobs)) {
          ctx.expect(needsOf(job)).not.toContain('test');
        }

        ctx.expect(needsOf(jobs.build)).toEqual(['setup']);
        ctx.expect(needsOf(jobs.finalize)).toEqual(['setup', 'build', 'windows-sign']);
        // finalize runs under `always()`, so a job that FAILED or was skipped
        // still reaches its `if`: the gate has to name the result it wants.
        ctx.expect(jobs.finalize.if).not.toContain('needs.test.result');
        ctx.expect(jobs.finalize.if).toContain("needs.build.result == 'success'");

        // Signing still hangs off the artifact Build uploads, nothing else.
        ctx.expect(needsOf(jobs['windows-sign'])).toContain('build');
        ctx.expect(needsOf(jobs['windows-strategy'])).toContain('build');
      },
    },
    // The Windows legs of this workflow force `shell: cmd`
    // ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)), and cmd cannot
    // execute the extension-less `sfw` Socket's action caches on Windows: every
    // windows job died on `'sfw' is not recognized`. devkit renders the shim that
    // copies the binary to `sfw.exe` beside the action step, so the check is on the
    // WRITTEN file, standalone and composed alike.
    {
      name: 'every job that runs sfw carries the Windows cmd shim, standalone and composed (#872)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-workflow-firewall-'));
        await copyDefaults(tmp);
        const scaffolded = jetpack.read(path.join(tmp, '.github', 'workflows', 'build.yml'));

        for (const workflow of [scaffolded, composeWorkflow(scaffolded, { targetPath: 'targets/desktop', targetName: 'desktop' })]) {
          // A step the shim broke would not parse at all, so the parse IS an assertion
          const { jobs } = yaml.load(workflow);

          for (const job of Object.values(jobs)) {
            const steps = job.steps || [];
            const install = steps.findIndex((step) => /\bsfw npm(?:\.cmd)? (ci|install)\b/.test(String(step.run || '')));
            if (install === -1) {
              continue;
            }

            const firewall = steps.findIndex((step) => String(step.uses || '').startsWith('SocketDev/action@'));
            const shim = steps.findIndex((step) => String(step.run || '').includes('firewall-path-binary'));

            ctx.expect(firewall).not.toBe(-1);
            ctx.expect(shim).not.toBe(-1);
            ctx.expect(firewall < shim && shim < install).toBe(true);
            ctx.expect(steps[shim].shell).toBe('cmd');
            ctx.expect(steps[shim].if).toContain('Windows');
          }
        }

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
    // The workflow env carries the mac credentials as the base64 secrets themselves,
    // and only the mac job decodes them to disk
    // ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)). A leg that never
    // signs for mac must not hold them: electron-builder would sign with the cert,
    // and the precheck would be handed a .p8 no filesystem can answer for.
    {
      name: 'the mac credentials are blanked on the linux and windows legs, and gated on mac (#872)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-workflow-creds-'));
        await copyDefaults(tmp);
        const { jobs } = yaml.load(jetpack.read(path.join(tmp, '.github', 'workflows', 'build.yml')));
        const steps = jobs.build.steps;

        const stepOn = (os_, command) => steps.find((step) => String(step.if || '').includes(os_) && String(step.run || '').includes(command));

        const linux = stepOn('ubuntu-latest', 'npm run release:local');
        ctx.expect(linux.env.CSC_LINK).toBe('');
        ctx.expect(linux.env.APPLE_API_KEY).toBe('');

        const windows = stepOn('windows-latest', 'npm run package');
        ctx.expect(windows.env.CSC_LINK).toBe('');
        ctx.expect(windows.env.APPLE_API_KEY).toBe('');

        // The mac leg is the one that decodes them, and it points at each file only
        // when that secret EXISTS (#872): decoding an empty secret writes an empty
        // file and `security import` of one dies with "parameters not valid", so a
        // brand with no mac cert builds unsigned instead.
        const decode = stepOn('macos-latest', 'base64 --decode');
        ctx.expect(decode.run).toContain('if [ -n "${{ secrets.CSC_LINK }}" ]; then');
        ctx.expect(decode.run).toContain('if [ -n "${{ secrets.APPLE_API_KEY }}" ]; then');

        const mac = stepOn('macos-latest', 'npm run release:local');
        ctx.expect(mac.env.CSC_LINK).toBe("${{ secrets.CSC_LINK != '' && 'config/certs/dev-id.p12' || '' }}");
        ctx.expect(mac.env.APPLE_API_KEY).toBe("${{ secrets.APPLE_API_KEY != '' && 'config/certs/AuthKey.p8' || '' }}");

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
    // The firewall spawns the command it is given LITERALLY on Windows, with no
    // PATHEXT resolution, and the only `npm` on a Windows runner's PATH is
    // `npm.cmd` (#872): under cmd, bare `npm` is "Command 'npm' not found in PATH".
    {
      name: 'every cmd-shelled install names npm.cmd, every other one stays bare npm (#872)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-workflow-npmcmd-'));
        await copyDefaults(tmp);
        const { jobs } = yaml.load(jetpack.read(path.join(tmp, '.github', 'workflows', 'build.yml')));

        for (const job of Object.values(jobs)) {
          const jobShell = job.defaults?.run?.shell;

          for (const step of job.steps || []) {
            const run = String(step.run || '');
            if (!run.includes('sfw npm')) {
              continue;
            }

            const underCmd = (step.shell || jobShell) === 'cmd';
            ctx.expect(run.includes('sfw npm.cmd ')).toBe(underCmd);
          }
        }

        // And the two legs that DO run under cmd are still there to be checked.
        ctx.expect(jobs.build.steps.some((step) => step.shell === 'cmd' && String(step.run || '').includes('sfw npm.cmd ci'))).toBe(true);
        ctx.expect(jobs['windows-sign'].defaults.run.shell).toBe('cmd');
        // The self-hosted signer installs WITHOUT the firewall (#872): its network does
        // not reach Socket's API and the firewall fails closed, while the lockfile it
        // installs was screened by the hosted build jobs of the same run.
        ctx.expect(jobs['windows-sign'].steps.some((step) => String(step.run || '').trim() === 'npm.cmd ci')).toBe(true);
        ctx.expect(jobs['windows-sign'].steps.some((step) => String(step.run || '').includes('sfw '))).toBe(false);
        ctx.expect(jobs['windows-sign'].steps.some((step) => String(step.uses || '').startsWith('SocketDev/action@'))).toBe(false);

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
    // The template matches its three siblings in shape
    // ([#880](https://github.com/Omega-JS-Stack/omega/issues/880)): the same
    // header, the same two dispatch triggers, a version log, and a bound on
    // every job. Read off the scaffolded render, like every case above.
    {
      name: 'the scaffolded workflow carries the sibling header, both dispatch triggers, a version log and a timeout per job (#880)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-workflow-shape-'));
        await copyDefaults(tmp);
        const scaffolded = jetpack.read(path.join(tmp, '.github', 'workflows', 'build.yml'));
        const doc = yaml.load(scaffolded);

        // The header opens the file, above `name:`, the way backend's does.
        ctx.expect(scaffolded.startsWith('# Deliberate deploys (D13):')).toBe(true);
        ctx.expect(scaffolded).toContain("Regenerated by every verb's ensureTarget");

        // Both dispatch triggers, and the `platforms` input stays on the manual
        // one. js-yaml 4 keeps `on` a plain string key (YAML 1.2 drops the
        // `on`/`off` booleans YAML 1.1 had), so `doc.on` is the trigger map.
        ctx.expect(Object.keys(doc.on)).toEqual(['workflow_dispatch', 'repository_dispatch']);
        ctx.expect(doc.on.workflow_dispatch.inputs).toHaveProperty('platforms');
        ctx.expect(doc.on.repository_dispatch.types).toEqual(['omega-deploy']);

        // ONE version log for all three legs of the build matrix, under an
        // explicit `shell: bash` (the cmd forcing is for npm, this step reads).
        const log = doc.jobs.build.steps.find((step) => step.name === 'Log versions');
        ctx.expect(log).toBeDefined();
        ctx.expect(log.shell).toBe('bash');
        for (const command of ['node -v', 'npm -v', 'npx --no-install omega-desktop version']) {
          ctx.expect(log.run).toContain(command);
        }

        // No job holds a runner for GitHub's six-hour default.
        const unbounded = Object.entries(doc.jobs)
          .filter(([, job]) => typeof job['timeout-minutes'] !== 'number')
          .map(([name]) => name);
        ctx.expect(unbounded).toEqual([]);

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
  ],
});
