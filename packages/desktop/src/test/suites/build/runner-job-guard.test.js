// The self-hosted signer's job guard
// ([#875](https://github.com/Omega-JS-Stack/omega/issues/875)): the hook the
// runner runs before a job's first step, and the three files the runner install
// writes beside the runner so it has an allow list to read.
//
// The hook is run here the way the runner runs it (a node process with the
// job's environment and nothing else), because the EXIT CODE is the whole
// mechanism: nonzero and the job dies with the script's output, before the
// checkout, before npm, before signtool ever sees the token.
//
// Nothing in this file touches a real box: every write goes to a scratch home
// under the OS temp dir, and no verb of `commands/runner.js` is called at all.

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { spawnSync } = require('child_process');
const defineCases = require('@omega.js/devkit/test/define-cases');

const guard = require('../../../utils/runner-job-guard.js');
const hook  = require('../../../runner/job-started.js');
const { ensureRunnerDirEnv } = require('../../../utils/runner-env.js');

const scratchHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'omega-job-guard-'));

// One job, as the runner delivers it: the three names the hook reads, and no
// inherited GITHUB_* (a run of this suite inside a job carries its own).
function runHook(hookPath, job) {
  return spawnSync(process.execPath, [hookPath], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot || '', ...job },
    encoding: 'utf8',
  });
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'runner job guard (#875): the box refuses any job that is not a trusted dispatch',
  tests: [
    {
      name: 'a dispatch from a listed repo by a listed actor is allowed, and every other job is refused with one line naming the check and the value',
      run: (ctx) => {
        const home = scratchHome();
        const { hook: hookPath } = guard.ensureRunnerJobGuard(home, { orgs: ['Omega-JS-Stack'], actor: 'ianwieds' });

        // The passing case, on the ONE trusted event (#923).
        const ok = runHook(hookPath, { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'Omega-JS-Stack/omega-omega', GITHUB_ACTOR: 'ianwieds' });
        ctx.expect(ok.status).toBe(0);
        ctx.expect(ok.stdout.trim()).toBe('Allowing this job: workflow_dispatch on Omega-JS-Stack/omega-omega by ianwieds.');

        // Each failing check: nonzero, and ONE line carrying the env name that
        // failed and the value seen.
        const cases = [
          [{ GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'Omega-JS-Stack/omega-omega', GITHUB_ACTOR: 'ianwieds' }, 'GITHUB_EVENT_NAME', 'pull_request'],
          [{ GITHUB_EVENT_NAME: 'repository_dispatch', GITHUB_REPOSITORY: 'Omega-JS-Stack/omega-omega', GITHUB_ACTOR: 'ianwieds' }, 'GITHUB_EVENT_NAME', 'repository_dispatch'],
          [{ GITHUB_EVENT_NAME: 'push', GITHUB_REPOSITORY: 'Omega-JS-Stack/omega-omega', GITHUB_ACTOR: 'ianwieds' }, 'GITHUB_EVENT_NAME', 'push'],
          [{ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'someone-else/their-app', GITHUB_ACTOR: 'ianwieds' }, 'GITHUB_REPOSITORY', 'someone-else/their-app'],
          [{ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'Omega-JS-Stack/omega-omega', GITHUB_ACTOR: 'mallory' }, 'GITHUB_ACTOR', 'mallory'],
        ];

        for (const [job, name, value] of cases) {
          const refused = runHook(hookPath, job);
          ctx.expect(refused.status).toBe(1);
          ctx.expect(refused.stdout.trim().split('\n').length).toBe(1);
          ctx.expect(refused.stdout).toContain(name);
          ctx.expect(refused.stdout).toContain(value);
        }

        fs.rmSync(home, { recursive: true, force: true });
      },
    },
    {
      name: 'a job with no environment at all is refused, and so is one whose allow list is missing',
      run: (ctx) => {
        const home = scratchHome();
        const { hook: hookPath, repos } = guard.ensureRunnerJobGuard(home, { orgs: ['Omega-JS-Stack'], actor: 'ianwieds' });

        // The runner always sets these; a hook run without them is a hook run
        // that cannot answer the question, which is a refusal.
        ctx.expect(runHook(hookPath, {}).status).toBe(1);

        // An allow list that is not there allows nothing: the guard never opens
        // the box up by failing to read its own configuration.
        fs.rmSync(repos, { force: true });
        const refused = runHook(hookPath, { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'Omega-JS-Stack/omega-omega', GITHUB_ACTOR: 'ianwieds' });
        ctx.expect(refused.status).toBe(1);
        ctx.expect(refused.stdout).toContain('allowed-repos.txt');

        fs.rmSync(home, { recursive: true, force: true });
      },
    },
    {
      name: 'the allow list reads `owner/*` and single repos alike, case-insensitively, and comments and blanks are not entries',
      run: (ctx) => {
        const lists = { repos: ['Omega-JS-Stack/*', 'other-org/one-app'], actors: ['ianwieds'], reposFile: 'allowed-repos.txt', actorsFile: 'allowed-actors.txt' };
        const dispatch = (repository) => hook.checkJob({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: repository, GITHUB_ACTOR: 'IanWieds' }, lists).allowed;

        ctx.expect(dispatch('omega-js-stack/anything')).toBe(true);
        ctx.expect(dispatch('other-org/one-app')).toBe(true);
        ctx.expect(dispatch('other-org/another-app')).toBe(false);
        // `owner/*` is one owner, never a prefix of another owner's name.
        ctx.expect(dispatch('Omega-JS-Stack-evil/app')).toBe(false);

        const home = scratchHome();
        const file = path.join(home, 'allowed-repos.txt');
        fs.writeFileSync(file, '# a comment\n\n  Omega-JS-Stack/omega-omega  # trailing\n');
        ctx.expect(hook.readList(file)).toEqual(['Omega-JS-Stack/omega-omega']);

        fs.rmSync(home, { recursive: true, force: true });
      },
    },
    {
      name: 'the setup writes the hook and both allow lists beside the runner, and rerunning writes the same bytes',
      run: (ctx) => {
        const home = scratchHome();
        const first = guard.ensureRunnerJobGuard(home, { orgs: ['Omega-JS-Stack'], actor: 'ianwieds' });

        ctx.expect(first.hook).toBe(path.join(home, 'job-started.js'));
        ctx.expect(first.repos).toBe(path.join(home, 'allowed-repos.txt'));
        ctx.expect(first.actors).toBe(path.join(home, 'allowed-actors.txt'));
        ctx.expect(first.added.repos).toEqual(['Omega-JS-Stack/*']);
        ctx.expect(first.added.actors).toEqual(['ianwieds']);

        // The hook on the box is this package's file, so a framework update
        // reaches the box on its next install or start.
        ctx.expect(fs.readFileSync(first.hook, 'utf8')).toBe(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'runner', 'job-started.js'), 'utf8'));

        const bytes = () => [first.hook, first.repos, first.actors].map((file) => fs.readFileSync(file, 'utf8'));
        const before = bytes();
        const again = guard.ensureRunnerJobGuard(home, { orgs: ['Omega-JS-Stack'], actor: 'ianwieds' });
        ctx.expect(again.added).toEqual({ repos: [], actors: [] });
        ctx.expect(bytes()).toEqual(before);

        // A second org registered later gets its line; the first one is not
        // duplicated and the file the operator reads keeps its header.
        const third = guard.ensureRunnerJobGuard(home, { orgs: ['Omega-JS-Stack', 'ITW-Creative-Works'], actor: 'ianwieds' });
        ctx.expect(third.added.repos).toEqual(['ITW-Creative-Works/*']);
        ctx.expect(hook.readList(third.repos)).toEqual(['Omega-JS-Stack/*', 'ITW-Creative-Works/*']);
        ctx.expect(fs.readFileSync(third.repos, 'utf8').startsWith('# The repositories this box will sign for')).toBe(true);

        fs.rmSync(home, { recursive: true, force: true });
      },
    },
    {
      name: 'an allow list narrowed by hand is never widened back by a later setup',
      run: (ctx) => {
        const home = scratchHome();
        const { repos } = guard.ensureRunnerJobGuard(home, { orgs: ['Omega-JS-Stack'], actor: 'ianwieds' });

        // The operator narrows the org wildcard to the one repo that signs.
        fs.writeFileSync(repos, '# mine\nOmega-JS-Stack/omega-omega\n');
        const again = guard.ensureRunnerJobGuard(home, { orgs: ['Omega-JS-Stack'], actor: 'ianwieds' });

        ctx.expect(again.added.repos).toEqual([]);
        ctx.expect(hook.readList(repos)).toEqual(['Omega-JS-Stack/omega-omega']);

        fs.rmSync(home, { recursive: true, force: true });
      },
    },
    {
      name: "the hook path reaches the listener through the runner dir's own .env, beside HOME",
      run: (ctx) => {
        const home = scratchHome();
        const runnerDir = path.join(home, 'actions-runner-omega-js-stack');
        const { hook: hookPath } = guard.ensureRunnerJobGuard(home, { orgs: ['Omega-JS-Stack'], actor: 'ianwieds' });

        // The file GitHub documents for runner env, which the listener reads at
        // startup and applies to every job: the same one the private HOME
        // travels in (#807), written once for both.
        const file = ensureRunnerDirEnv(runnerDir, { HOME: path.join(home, 'home'), ACTIONS_RUNNER_HOOK_JOB_STARTED: hookPath });
        const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);

        ctx.expect(lines).toContain(`ACTIONS_RUNNER_HOOK_JOB_STARTED=${hookPath}`);
        ctx.expect(lines).toContain(`HOME=${path.join(home, 'home')}`);
        // Bare, never quoted: the listener takes the rest of the line verbatim.
        ctx.expect(fs.readFileSync(file, 'utf8')).not.toContain('"');

        fs.rmSync(home, { recursive: true, force: true });
      },
    },
  ],
});
