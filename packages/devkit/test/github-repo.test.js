/**
 * The GitHub repo boundary (#883). The `gh` seam is stubbed everywhere: the
 * suite must never touch a real repo. Pins: the exact argv (an array, never a
 * shell string), create vs reconcile vs dry-run plan, the Pages lane's pending
 * answer before the first deploy, and the plan read that decides a website
 * repo's visibility.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { gh, getRepo, ensureRepo, getPages, ensurePages, ownerPlan } = require('../src/github-repo.js');

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

test('gh: one argv array, never a shell string, and the failure carries gh stderr', () => {
  const { calls, execFn } = ghStub({ 'api user': '{"login":"acme"}' });

  assert.strictEqual(gh(['api', 'user'], { execFn }), '{"login":"acme"}');
  assert.deepStrictEqual(calls[0], { file: 'gh', args: ['api', 'user'] });
  assert.ok(calls.every((call) => Array.isArray(call.args)), 'the command is an argv array: a config value can never inject');

  assert.throws(() => gh(['api', 'orgs/nope'], { execFn }), /gh api orgs\/nope failed: .*Not Found/);
});

test('gh: a timeout option bounds the call, and a call that hits it fails like any other', () => {
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

  assert.strictEqual(gh(['api', 'user'], { execFn }), '{"login":"acme"}');
  assert.strictEqual(seen[0], undefined, 'no timeout unless asked: an ensure may take as long as it takes');
  assert.throws(() => gh(['api', 'user'], { execFn, timeout: 5 }), /gh api user failed: .*ETIMEDOUT/);
  assert.strictEqual(seen[1], 5, 'the timeout reaches the exec');
});

test('getRepo/getPages: a 404 is the answer "it does not exist", never a failure', () => {
  const { execFn } = ghStub({
    'api repos/acme/acme-web': REPO,
    'api repos/acme/acme-web/pages': JSON.stringify({ cname: 'acme.com', source: { branch: 'gh-pages' } }),
  });

  assert.strictEqual(getRepo('acme', 'acme-web', { execFn }).full_name, 'acme/acme-web');
  assert.strictEqual(getRepo('acme', 'missing', { execFn }), null);
  assert.strictEqual(getPages('acme', 'acme-web', { execFn }).cname, 'acme.com');
  assert.strictEqual(getPages('acme', 'missing', { execFn }), null);
});

test('ensureRepo: a missing repo is created at the declared visibility', () => {
  const { calls, execFn } = ghStub({ 'repo create acme/acme-web --public --description Acme website --homepage https://acme.com': '' });

  const result = ensureRepo(
    { owner: 'acme', name: 'acme-web', private: false, description: 'Acme website', homepage: 'https://acme.com' },
    { execFn },
  );

  assert.deepStrictEqual(result, { created: true, changed: false, planned: ['create acme/acme-web (public)'] });
  assert.deepStrictEqual(calls[1].args, [
    'repo', 'create', 'acme/acme-web', '--public', '--description', 'Acme website', '--homepage', 'https://acme.com',
  ]);
});

// C9: the caller owns the WHY (a website repo is public because the org is on
// the free plan, which only the manage walk knows). It hands the words in, so
// nothing downstream has to match this line by string to append to it.
test('ensureRepo: an optional reason rides the create line the plan prints', () => {
  const { execFn } = ghStub({ 'repo create acme/acme-web --public': '' });

  const result = ensureRepo(
    { owner: 'acme', name: 'acme-web', private: false, reason: 'free plan' },
    { execFn, dryRun: true },
  );

  assert.deepStrictEqual(result.planned, ['create acme/acme-web (public: free plan)']);
  assert.deepStrictEqual(
    ensureRepo({ owner: 'acme', name: 'acme-web', private: false }, { execFn, dryRun: true }).planned,
    ['create acme/acme-web (public)'],
    'no reason, no colon: the line is the plain one every other role prints',
  );
});

test('ensureRepo: a repo that must carry a commit asks for one (the releases repo)', () => {
  const { calls, execFn } = ghStub({ 'repo create acme/acme-releases --public --add-readme': '' });

  ensureRepo({ owner: 'acme', name: 'acme-releases', private: false, autoInit: true }, { execFn });

  assert.deepStrictEqual(calls[1].args, ['repo', 'create', 'acme/acme-releases', '--public', '--add-readme']);
});

test('ensureRepo: an existing repo is reconciled to the visibility and homepage it should have', () => {
  const { calls, execFn } = ghStub({
    'api repos/acme/acme-web': REPO,
    'api repos/acme/acme-web -X PATCH -F private=false -f homepage=https://acme.com': '{}',
  });

  const result = ensureRepo(
    { owner: 'acme', name: 'acme-web', private: false, homepage: 'https://acme.com' },
    { execFn },
  );

  assert.strictEqual(result.created, false);
  assert.strictEqual(result.changed, true);
  assert.deepStrictEqual(result.planned, ['acme/acme-web: private -> public', 'acme/acme-web: homepage -> https://acme.com']);
  // Typed with -F so the boolean arrives as a real JSON boolean, not "false".
  assert.deepStrictEqual(calls[1].args, [
    'api', 'repos/acme/acme-web', '-X', 'PATCH', '-F', 'private=false', '-f', 'homepage=https://acme.com',
  ]);
});

test('ensureRepo: a converged repo is left alone (idempotent)', () => {
  const { calls, execFn } = ghStub({ 'api repos/acme/acme-web': REPO });

  const result = ensureRepo({ owner: 'acme', name: 'acme-web', private: true, homepage: 'https://old.acme.com' }, { execFn });

  assert.deepStrictEqual(result, { created: false, changed: false, planned: [] });
  assert.strictEqual(calls.length, 1, 'the read alone: nothing to write');
});

test('ensureRepo: a dry run is the PLAN, with nothing touched', () => {
  const create = ghStub({});
  assert.deepStrictEqual(
    ensureRepo({ owner: 'acme', name: 'acme-web', private: false }, { dryRun: true, execFn: create.execFn }),
    { created: false, changed: false, planned: ['create acme/acme-web (public)'] },
  );
  assert.strictEqual(create.calls.length, 1, 'the existence read only');

  const reconcile = ghStub({ 'api repos/acme/acme-web': REPO });
  const result = ensureRepo({ owner: 'acme', name: 'acme-web', private: false }, { dryRun: true, execFn: reconcile.execFn });
  assert.deepStrictEqual(result, { created: false, changed: false, planned: ['acme/acme-web: private -> public'] });
  assert.strictEqual(reconcile.calls.length, 1, 'no PATCH under a dry run');
});

test('ensurePages: pending until the branch the first deploy pushes exists', () => {
  const { calls, execFn } = ghStub({ 'api repos/acme/acme-web': REPO });
  const heard = [];

  const result = ensurePages(
    { owner: 'acme', name: 'acme-web', branch: 'gh-pages', cname: 'acme.com' },
    { execFn, logger: { log: (line) => heard.push(line) } },
  );

  assert.deepStrictEqual(result, { created: false, changed: false, planned: [], pending: true });
  assert.ok(heard.some((line) => line.includes('Pages configures after the first deploy')), heard.join(' | '));
  assert.deepStrictEqual(calls.map((call) => call.args.join(' ')), ['api repos/acme/acme-web/branches/gh-pages']);
});

test('ensurePages: the branch exists and Pages is off, so it is turned on at the custom domain', () => {
  const { calls, execFn } = ghStub({
    'api repos/acme/acme-web/branches/gh-pages': '{"name":"gh-pages"}',
    'api repos/acme/acme-web/pages -X POST -f source[branch]=gh-pages -f source[path]=/': '{}',
    'api repos/acme/acme-web/pages -X PUT -f cname=acme.com': '{}',
  });

  const result = ensurePages({ owner: 'acme', name: 'acme-web', cname: 'acme.com' }, { execFn, logger: quiet });

  assert.strictEqual(result.created, true);
  assert.deepStrictEqual(result.planned, ['pages acme/acme-web: gh-pages -> acme.com']);
  assert.deepStrictEqual(calls.map((call) => call.args.join(' ')), [
    'api repos/acme/acme-web/branches/gh-pages',
    'api repos/acme/acme-web/pages',
    'api repos/acme/acme-web/pages -X POST -f source[branch]=gh-pages -f source[path]=/',
    'api repos/acme/acme-web/pages -X PUT -f cname=acme.com',
  ]);
});

test('ensurePages: a converged site is left alone; a drifted domain is moved', () => {
  const converged = ghStub({
    'api repos/acme/acme-web/branches/gh-pages': '{"name":"gh-pages"}',
    'api repos/acme/acme-web/pages': JSON.stringify({ cname: 'acme.com', source: { branch: 'gh-pages' } }),
  });
  assert.deepStrictEqual(
    ensurePages({ owner: 'acme', name: 'acme-web', cname: 'acme.com' }, { execFn: converged.execFn, logger: quiet }),
    { created: false, changed: false, planned: [] },
  );
  assert.strictEqual(converged.calls.length, 2, 'two reads, no writes');

  const drifted = ghStub({
    'api repos/acme/acme-web/branches/gh-pages': '{"name":"gh-pages"}',
    'api repos/acme/acme-web/pages': JSON.stringify({ cname: 'old.acme.com', source: { branch: 'gh-pages' } }),
    'api repos/acme/acme-web/pages -X PUT -f cname=acme.com': '{}',
  });
  const result = ensurePages({ owner: 'acme', name: 'acme-web', cname: 'acme.com' }, { execFn: drifted.execFn, logger: quiet });
  assert.strictEqual(result.changed, true);
  assert.deepStrictEqual(result.planned, ['pages acme/acme-web: domain -> acme.com']);

  const dry = ghStub({
    'api repos/acme/acme-web/branches/gh-pages': '{"name":"gh-pages"}',
    'api repos/acme/acme-web/pages': JSON.stringify({ cname: 'old.acme.com', source: { branch: 'gh-pages' } }),
  });
  const plan = ensurePages({ owner: 'acme', name: 'acme-web', cname: 'acme.com' }, { dryRun: true, execFn: dry.execFn, logger: quiet });
  assert.deepStrictEqual(plan, { created: false, changed: false, planned: ['pages acme/acme-web: domain -> acme.com'] });
  assert.strictEqual(dry.calls.length, 2, 'no PUT under a dry run');
});

test('ownerPlan: the paid plan reads through; a free org and a USER owner both read free', () => {
  const team = ghStub({ 'api orgs/acme': JSON.stringify({ plan: { name: 'team' } }) });
  assert.strictEqual(ownerPlan('acme', { execFn: team.execFn }), 'team');

  const free = ghStub({ 'api orgs/acme': JSON.stringify({ plan: { name: 'free' } }) });
  assert.strictEqual(ownerPlan('acme', { execFn: free.execFn }), 'free');

  // A user account is not an org, so `orgs/<owner>` 404s: it cannot host a
  // private Pages site either, and guessing the other way publishes a site the
  // brand meant to keep private.
  const user = ghStub({});
  assert.strictEqual(ownerPlan('ianwieds', { execFn: user.execFn }), 'free');

  const planless = ghStub({ 'api orgs/acme': '{}' });
  assert.strictEqual(ownerPlan('acme', { execFn: planless.execFn }), 'free');
});
