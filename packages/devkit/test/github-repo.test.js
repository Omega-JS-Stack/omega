/**
 * The GitHub repo boundary (#883). The `gh` seam is stubbed everywhere: the
 * suite must never touch a real repo. Pins: the exact argv (an array, never a
 * shell string), create vs reconcile vs dry-run plan, the Pages lane's pending
 * answer before the first deploy, and the plan read that decides a website
 * repo's visibility.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { gh, getRepo, ensureRepo, getPages, ensurePages, ownerPlan, ghState, assertGhReady } = require('../src/github-repo.js');

const quiet = { log() {} };

/**
 * A `gh` stub answering per ARGV, recording every call. An argv nobody answered
 * is a 404, the shape gh gives a missing repo, branch or Pages site.
 * @param {object} answers - argv joined by spaces → stdout string.
 * @returns {{ calls: Array<{ file: string, args: string[] }>, execFn: Function }}
 */
function ghStub(answers) {
  const calls = [];

  const execFn = (file, args) => {
    calls.push({ file, args });
    const answer = answers[args.join(' ')];
    if (answer === undefined) {
      const error = new Error('gh exited 1');
      error.stderr = Buffer.from('gh: Not Found (HTTP 404)');
      throw error;
    }
    return answer;
  };

  return { calls, execFn };
}

const REPO = JSON.stringify({ full_name: 'acme/acme-web', private: true, homepage: 'https://old.acme.com' });

// ─── The GitHub CLI check: installed, then signed in by a real call ─────────

const INSTALL_LINE = 'GitHub CLI (gh) is not installed. Install from: https://cli.github.com/';

/**
 * A `gh` that answers the two probes as told, recording every call's argv.
 * `authStatus` is how `gh auth status` exits, which no check may ask.
 * @param {object} answers - { version, apiUser, authStatus }, each true to pass.
 * @returns {{ calls: string[][], execFn: Function }}
 */
function probeStub({ version = true, apiUser = true, authStatus = true }) {
  const calls = [];
  const execFn = (file, args) => {
    calls.push([file, ...args]);
    const fail = (message) => { throw Object.assign(new Error(message), { status: 1, stderr: Buffer.from(message) }); };
    if (args[0] === '--version') return version ? 'gh version 2.100.0' : fail('spawnSync gh ENOENT');
    if (args[0] === 'api' && args[1] === 'user') return apiUser ? '{"login":"acme"}' : fail('gh: Bad credentials (HTTP 401)');
    if (args[0] === 'auth' && args[1] === 'status') return authStatus ? 'Logged in' : fail('The token in GH_TOKEN is invalid');
    return fail(`no answer for gh ${args.join(' ')}`);
  };
  return { calls, execFn };
}

module.exports = defineCases({
  type: 'group',
  description: 'github-repo',
  tests: [
    {
      name: 'gh: one argv array, never a shell string, and the failure carries gh stderr',
      run: (ctx) => {
        const { calls, execFn } = ghStub({ 'api user': '{"login":"acme"}' });

        ctx.expect(gh(['api', 'user'], { execFn })).toBe('{"login":"acme"}');
        ctx.expect(calls[0]).toEqual({ file: 'gh', args: ['api', 'user'] });
        ctx.expect(calls.every((call) => Array.isArray(call.args)), 'the command is an argv array: a config value can never inject').toBeTruthy();

        ctx.expect(() => gh(['api', 'orgs/nope'], { execFn })).toThrow(/gh api orgs\/nope failed: .*Not Found/);
      },
    },

    {
      name: 'gh: a timeout option bounds the call, and a call that hits it fails like any other',
      run: (ctx) => {
        const seen = [];
        const execFn = (file, args, opts) => {
          seen.push(opts.timeout);
          if (opts.timeout === 5) {
            const error = new Error('spawnSync gh ETIMEDOUT');
            error.stderr = Buffer.from('');
            throw error;
          }
          return '{"login":"acme"}';
        };

        ctx.expect(gh(['api', 'user'], { execFn })).toBe('{"login":"acme"}');
        ctx.expect(seen[0], 'no timeout unless asked: an ensure may take as long as it takes').toBe(undefined);
        ctx.expect(() => gh(['api', 'user'], { execFn, timeout: 5 })).toThrow(/gh api user failed: .*ETIMEDOUT/);
        ctx.expect(seen[1], 'the timeout reaches the exec').toBe(5);
      },
    },

    {
      name: 'getRepo/getPages: a 404 is the answer "it does not exist", never a failure',
      run: (ctx) => {
        const { execFn } = ghStub({
          'api repos/acme/acme-web': REPO,
          'api repos/acme/acme-web/pages': JSON.stringify({ cname: 'acme.com', source: { branch: 'gh-pages' } }),
        });

        ctx.expect(getRepo('acme', 'acme-web', { execFn }).full_name).toBe('acme/acme-web');
        ctx.expect(getRepo('acme', 'missing', { execFn })).toBe(null);
        ctx.expect(getPages('acme', 'acme-web', { execFn }).cname).toBe('acme.com');
        ctx.expect(getPages('acme', 'missing', { execFn })).toBe(null);
      },
    },

    {
      name: 'ensureRepo: a missing repo is created at the declared visibility',
      run: (ctx) => {
        const { calls, execFn } = ghStub({ 'repo create acme/acme-web --public --description Acme website --homepage https://acme.com': '' });

        const result = ensureRepo(
          { owner: 'acme', name: 'acme-web', private: false, description: 'Acme website', homepage: 'https://acme.com' },
          { execFn },
        );

        ctx.expect(result).toEqual({ created: true, changed: false, planned: ['create acme/acme-web (public)'] });
        ctx.expect(calls[1].args).toEqual([
          'repo', 'create', 'acme/acme-web', '--public', '--description', 'Acme website', '--homepage', 'https://acme.com',
        ]);
      },
    },

    // C9: the caller owns the WHY (a website repo is public because the org is on
    // the free plan, which only the manage walk knows). It hands the words in, so
    // nothing downstream has to match this line by string to append to it.
    {
      name: 'ensureRepo: an optional reason rides the create line the plan prints',
      run: (ctx) => {
        const { execFn } = ghStub({ 'repo create acme/acme-web --public': '' });

        const result = ensureRepo(
          { owner: 'acme', name: 'acme-web', private: false, reason: 'free plan' },
          { execFn, dryRun: true },
        );

        ctx.expect(result.planned).toEqual(['create acme/acme-web (public: free plan)']);
        ctx.expect(ensureRepo({ owner: 'acme', name: 'acme-web', private: false }, { execFn, dryRun: true }).planned, 'no reason, no colon: the line is the plain one every other role prints').toEqual(['create acme/acme-web (public)']);
      },
    },

    {
      name: 'ensureRepo: a repo that must carry a commit asks for one (the releases repo)',
      run: (ctx) => {
        const { calls, execFn } = ghStub({ 'repo create acme/acme-releases --public --add-readme': '' });

        ensureRepo({ owner: 'acme', name: 'acme-releases', private: false, autoInit: true }, { execFn });

        ctx.expect(calls[1].args).toEqual(['repo', 'create', 'acme/acme-releases', '--public', '--add-readme']);
      },
    },

    {
      name: 'ensureRepo: an existing repo is reconciled to the visibility and homepage it should have',
      run: (ctx) => {
        const { calls, execFn } = ghStub({
          'api repos/acme/acme-web': REPO,
          'api repos/acme/acme-web -X PATCH -F private=false -f homepage=https://acme.com': '{}',
        });

        const result = ensureRepo(
          { owner: 'acme', name: 'acme-web', private: false, homepage: 'https://acme.com' },
          { execFn },
        );

        ctx.expect(result.created).toBe(false);
        ctx.expect(result.changed).toBe(true);
        ctx.expect(result.planned).toEqual(['acme/acme-web: private -> public', 'acme/acme-web: homepage -> https://acme.com']);
        // Typed with -F so the boolean arrives as a real JSON boolean, not "false".
        ctx.expect(calls[1].args).toEqual([
          'api', 'repos/acme/acme-web', '-X', 'PATCH', '-F', 'private=false', '-f', 'homepage=https://acme.com',
        ]);
      },
    },

    {
      name: 'ensureRepo: a converged repo is left alone (idempotent)',
      run: (ctx) => {
        const { calls, execFn } = ghStub({ 'api repos/acme/acme-web': REPO });

        const result = ensureRepo({ owner: 'acme', name: 'acme-web', private: true, homepage: 'https://old.acme.com' }, { execFn });

        ctx.expect(result).toEqual({ created: false, changed: false, planned: [] });
        ctx.expect(calls.length, 'the read alone: nothing to write').toBe(1);
      },
    },

    {
      name: 'ensureRepo: a dry run is the PLAN, with nothing touched',
      run: (ctx) => {
        const create = ghStub({});
        ctx.expect(ensureRepo({ owner: 'acme', name: 'acme-web', private: false }, { dryRun: true, execFn: create.execFn })).toEqual({ created: false, changed: false, planned: ['create acme/acme-web (public)'] });
        ctx.expect(create.calls.length, 'the existence read only').toBe(1);

        const reconcile = ghStub({ 'api repos/acme/acme-web': REPO });
        const result = ensureRepo({ owner: 'acme', name: 'acme-web', private: false }, { dryRun: true, execFn: reconcile.execFn });
        ctx.expect(result).toEqual({ created: false, changed: false, planned: ['acme/acme-web: private -> public'] });
        ctx.expect(reconcile.calls.length, 'no PATCH under a dry run').toBe(1);
      },
    },

    {
      name: 'ensurePages: pending until the branch the first deploy pushes exists',
      run: (ctx) => {
        const { calls, execFn } = ghStub({ 'api repos/acme/acme-web': REPO });
        const heard = [];

        const result = ensurePages(
          { owner: 'acme', name: 'acme-web', branch: 'gh-pages', cname: 'acme.com' },
          { execFn, logger: { log: (line) => heard.push(line) } },
        );

        ctx.expect(result).toEqual({ created: false, changed: false, planned: [], pending: true });
        ctx.expect(heard.some((line) => line.includes('Pages configures after the first deploy')), heard.join(' | ')).toBeTruthy();
        ctx.expect(calls.map((call) => call.args.join(' '))).toEqual(['api repos/acme/acme-web/branches/gh-pages']);
      },
    },

    {
      name: 'ensurePages: the branch exists and Pages is off, so it is turned on at the custom domain',
      run: (ctx) => {
        const { calls, execFn } = ghStub({
          'api repos/acme/acme-web/branches/gh-pages': '{"name":"gh-pages"}',
          'api repos/acme/acme-web/pages -X POST -f source[branch]=gh-pages -f source[path]=/': '{}',
          'api repos/acme/acme-web/pages -X PUT -f cname=acme.com': '{}',
        });

        const result = ensurePages({ owner: 'acme', name: 'acme-web', cname: 'acme.com' }, { execFn, logger: quiet });

        ctx.expect(result.created).toBe(true);
        ctx.expect(result.planned).toEqual(['pages acme/acme-web: gh-pages -> acme.com']);
        ctx.expect(calls.map((call) => call.args.join(' '))).toEqual([
          'api repos/acme/acme-web/branches/gh-pages',
          'api repos/acme/acme-web/pages',
          'api repos/acme/acme-web/pages -X POST -f source[branch]=gh-pages -f source[path]=/',
          'api repos/acme/acme-web/pages -X PUT -f cname=acme.com',
        ]);
      },
    },

    {
      name: 'ensurePages: a converged site is left alone; a drifted domain is moved',
      run: (ctx) => {
        const converged = ghStub({
          'api repos/acme/acme-web/branches/gh-pages': '{"name":"gh-pages"}',
          'api repos/acme/acme-web/pages': JSON.stringify({ cname: 'acme.com', source: { branch: 'gh-pages' } }),
        });
        ctx.expect(ensurePages({ owner: 'acme', name: 'acme-web', cname: 'acme.com' }, { execFn: converged.execFn, logger: quiet })).toEqual({ created: false, changed: false, planned: [] });
        ctx.expect(converged.calls.length, 'two reads, no writes').toBe(2);

        const drifted = ghStub({
          'api repos/acme/acme-web/branches/gh-pages': '{"name":"gh-pages"}',
          'api repos/acme/acme-web/pages': JSON.stringify({ cname: 'old.acme.com', source: { branch: 'gh-pages' } }),
          'api repos/acme/acme-web/pages -X PUT -f cname=acme.com': '{}',
        });
        const result = ensurePages({ owner: 'acme', name: 'acme-web', cname: 'acme.com' }, { execFn: drifted.execFn, logger: quiet });
        ctx.expect(result.changed).toBe(true);
        ctx.expect(result.planned).toEqual(['pages acme/acme-web: domain -> acme.com']);

        const dry = ghStub({
          'api repos/acme/acme-web/branches/gh-pages': '{"name":"gh-pages"}',
          'api repos/acme/acme-web/pages': JSON.stringify({ cname: 'old.acme.com', source: { branch: 'gh-pages' } }),
        });
        const plan = ensurePages({ owner: 'acme', name: 'acme-web', cname: 'acme.com' }, { dryRun: true, execFn: dry.execFn, logger: quiet });
        ctx.expect(plan).toEqual({ created: false, changed: false, planned: ['pages acme/acme-web: domain -> acme.com'] });
        ctx.expect(dry.calls.length, 'no PUT under a dry run').toBe(2);
      },
    },

    {
      name: 'ownerPlan: the paid plan reads through; a free org and a USER owner both read free',
      run: (ctx) => {
        const team = ghStub({ 'api orgs/acme': JSON.stringify({ plan: { name: 'team' } }) });
        ctx.expect(ownerPlan('acme', { execFn: team.execFn })).toBe('team');

        const free = ghStub({ 'api orgs/acme': JSON.stringify({ plan: { name: 'free' } }) });
        ctx.expect(ownerPlan('acme', { execFn: free.execFn })).toBe('free');

        // A user account is not an org, so `orgs/<owner>` 404s: it cannot host a
        // private Pages site either, and guessing the other way publishes a site the
        // brand meant to keep private.
        const user = ghStub({});
        ctx.expect(ownerPlan('ianwieds', { execFn: user.execFn })).toBe('free');

        const planless = ghStub({ 'api orgs/acme': '{}' });
        ctx.expect(ownerPlan('acme', { execFn: planless.execFn })).toBe('free');
      },
    },

    {
      name: 'ghState: a gh whose --version fails is missing, and assertGhReady throws the install line',
      run: (ctx) => {
        const { execFn } = probeStub({ version: false });

        ctx.expect(ghState({ execFn })).toBe('missing');
        ctx.expect(() => assertGhReady({ execFn })).toThrow((error) => error.message.includes(INSTALL_LINE));
      },
    },

    {
      name: 'ghState: an installed gh whose `gh api user` fails is signed out, and assertGhReady names gh auth login and GH_TOKEN',
      run: (ctx) => {
        const { execFn } = probeStub({ apiUser: false });

        ctx.expect(ghState({ execFn })).toBe('signed-out');
        ctx.expect(() => assertGhReady({ execFn })).toThrow((error) => error.message.includes('gh auth login (or set GH_TOKEN in the brand .env)'));
      },
    },

    {
      name: 'assertGhReady: a failing `gh api user` keeps gh\'s first stderr line after the sign-in line',
      run: (ctx) => {
        const execFn = (file, args) => {
          if (args[0] === '--version') return 'gh version 2.100.0';
          const stderr = 'HTTP 403: API rate limit exceeded for user ID 1. (https://api.github.com/user)\nretry later\n';
          throw Object.assign(new Error('Command failed: gh api user'), { status: 1, stderr: Buffer.from(stderr) });
        };

        ctx.expect(() => assertGhReady({ execFn })).toThrow((error) => error.message === 'GitHub CLI is not authenticated. Run: gh auth login (or set GH_TOKEN in the brand .env): HTTP 403: API rate limit exceeded for user ID 1. (https://api.github.com/user)');
      },
    },

    {
      name: 'ghState: both probes passing is ready, and assertGhReady returns',
      run: (ctx) => {
        const { calls, execFn } = probeStub({});

        ctx.expect(ghState({ execFn })).toBe('ready');
        ctx.expect(() => assertGhReady({ execFn })).not.toThrow();
        ctx.expect(calls.slice(0, 2), 'the two probes, in order').toEqual([['gh', '--version'], ['gh', 'api', 'user']]);
      },
    },

    {
      name: 'ghState: a working GH_TOKEN that `gh auth status` refuses is ready, and auth status is never asked',
      run: (ctx) => {
        const { calls, execFn } = probeStub({ authStatus: false });

        ctx.expect(ghState({ execFn })).toBe('ready');
        assertGhReady({ execFn });
        ctx.expect(calls.length > 0, 'the state was probed').toBeTruthy();
        ctx.expect(!calls.some((call) => call.includes('auth') && call.includes('status')), JSON.stringify(calls)).toBeTruthy();
      },
    },
  ],
});
