/**
 * playground-desktop rehearsal tests: the working-tree snapshot is a real git
 * snapshot that never touches the working tree, the real index or ANY branch of
 * this repo, and the `gh` calls are exactly the ones the run needs
 * ([#802](https://github.com/Omega-JS-Stack/omega/issues/802)).
 *
 * The snapshot cases run against a scratch repo with a bare "rehearsal" repo
 * beside it, so `push` is real and local — a fake exec there would prove nothing
 * about the temporary-index dance, which is the whole risk this script carries.
 *
 * Run: node --test scripts/playground-desktop-rehearsal.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const { ensureRepo, publishSecrets, snapshotTree, waitForWorkflow, dispatchRun, findRun, REPO, BRANCH, LOCAL_REF, WORKFLOW_PATH, WORKFLOW_FILE } = require('./playground-desktop-rehearsal.js');

// The working tree the scratch repo carries into every snapshot case: one
// tracked file edited, one new file, the IGNORED workflow file the run cannot
// start without, and the playground lockfile that is untracked on purpose and
// must never reach the snapshot.
const DIRTY_STATUS = ' M tracked.txt\n?? brands/\n?? new.txt\n';
const SNAPSHOT_TREE = ['.gitignore', WORKFLOW_PATH, 'new.txt', 'tracked.txt'].sort();
const SNAPSHOT_MESSAGE = 'chore(rehearsal): snapshot the working tree for the playground desktop run';

// The newest run on the branch, asked for twice over: bare identity before the
// dispatch, identity plus the URL while polling for the run it created.
const GH_LIST_ID = ['gh', 'run', 'list', '--repo', REPO, '--workflow', WORKFLOW_FILE, '--branch', BRANCH, '--limit', '1', '--json', 'databaseId'];
const GH_LIST_RUN = ['gh', 'run', 'list', '--repo', REPO, '--workflow', WORKFLOW_FILE, '--branch', BRANCH, '--limit', '1', '--json', 'databaseId,url'];
const RUN_URL = (id) => `https://github.com/${REPO}/actions/runs/${id}`;

// The secrets go to the private REHEARSAL repo, named here rather than read back
// from the script: publishing this brand's keys anywhere else is the whole risk.
const REHEARSAL_REPO = 'Omega-JS-Stack/omega-playground-rehearsal';
const GH_AUTH = ['gh', 'auth', 'status'];
const GH_SECRET_SET = (key) => ['gh', 'secret', 'set', key, '--repo', REHEARSAL_REPO];

// The repo the snapshot is pushed to: looked up, then created PRIVATE when the
// lookup fails. Public would publish the whole framework source.
const GH_REPO_VIEW = ['gh', 'repo', 'view', REHEARSAL_REPO, '--json', 'name'];

// The workflow-registration probe, asked once per attempt until GitHub answers.
const GH_WORKFLOW_PROBE = ['gh', 'api', `repos/${REHEARSAL_REPO}/actions/workflows/${WORKFLOW_FILE}`];
const GH_REPO_CREATE = ['gh', 'repo', 'create', REHEARSAL_REPO, '--private', '--description', 'Playground desktop rehearsal snapshot (throwaway)'];

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

/**
 * A desktop target dir outside any brand, carrying the `.env` it composes from.
 * @param {object} t - The node:test context.
 * @param {string} [env] - The target `.env` contents (omitted: no file at all).
 * @returns {string} The target dir.
 */
function fixtureTarget(t, env) {
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-rehearsal-target-'));
  t.after(() => jetpack.remove(targetDir));

  if (env) jetpack.write(path.join(targetDir, '.env'), env);

  return targetDir;
}

/**
 * A logger that keeps every line, so a test can prove what did NOT get logged.
 * @returns {{ lines: string[], logger: object }}
 */
function recordingLogger() {
  const lines = [];
  const record = (message) => lines.push(String(message));

  return { lines, logger: { log: record, warn: record, error: record } };
}

/**
 * A scratch repo (one commit, a dirty working tree) with the bare rehearsal repo
 * beside it, torn down when the test ends. The workflow file is gitignored here
 * exactly as it is in the monorepo, so the force-add is under test.
 * @param {object} t - The node:test context.
 * @returns {{ root: string, remote: string, missing: string, indexFile: string, head: string }}
 */
function scratchRepo(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-rehearsal-'));
  const root = path.join(base, 'omega');
  const remote = path.join(base, 'rehearsal.git');
  t.after(() => jetpack.remove(base));

  git(base, 'init', '--bare', '-q', remote);
  jetpack.write(path.join(root, 'tracked.txt'), 'one\n');
  jetpack.write(path.join(root, '.gitignore'), `${WORKFLOW_PATH}\n`);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'rehearsal@example.com');
  git(root, 'config', 'user.name', 'Rehearsal Test');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'first');

  jetpack.write(path.join(root, 'tracked.txt'), 'two\n');
  jetpack.write(path.join(root, 'new.txt'), 'added\n');
  jetpack.write(path.join(root, WORKFLOW_PATH), 'name: rendered per rehearsal\n');
  jetpack.write(path.join(root, 'brands', 'omega-playground', 'package-lock.json'), '{}\n');

  return {
    root,
    remote,
    missing: path.join(base, 'no-such-repo.git'),
    indexFile: path.join(base, 'rehearsal-index'),
    head: git(root, 'rev-parse', 'HEAD').trim(),
  };
}

/**
 * A recording `exec`: every call as one flat array, its options beside it, and
 * canned stdout in order.
 * @param {string[]} [queue] - Responses, in call order; `[]` once exhausted.
 * @returns {{ calls: string[][], options: object[], exec: Function }}
 */
function recorder(queue = []) {
  const calls = [];
  const options = [];
  return {
    calls,
    options,
    exec: (file, args, opts) => {
      calls.push([file, ...args]);
      options.push(opts);
      return queue.shift() ?? '[]';
    },
  };
}

test('the snapshot carries the working tree and the ignored workflow file, minus the playground lockfile', (t) => {
  const { root, remote, indexFile, head } = scratchRepo(t);
  assert.equal(git(root, 'status', '--porcelain'), DIRTY_STATUS);

  const snapshot = snapshotTree({ root, indexFile, remote });

  // The workflow file is IGNORED here and still in the tree: without it the run
  // has no workflow to dispatch. The lockfile is excluded, as always.
  assert.deepEqual(git(root, 'ls-tree', '-r', '--name-only', LOCAL_REF).trim().split('\n').sort(), SNAPSHOT_TREE);
  assert.equal(git(root, 'show', `${LOCAL_REF}:tracked.txt`), 'two\n');
  assert.equal(git(root, 'show', `${LOCAL_REF}:new.txt`), 'added\n');
  assert.equal(git(root, 'log', '-1', '--format=%s', LOCAL_REF).trim(), SNAPSHOT_MESSAGE);

  // The commit is parked outside `refs/heads/`: no branch of this repo is
  // written, so a `rehearsal` branch never appears and `main` never moves.
  assert.equal(git(root, 'branch', '--list', 'rehearsal'), '');
  assert.deepEqual(git(root, 'branch', '--format=%(refname:short)').trim().split('\n'), ['main']);
  assert.equal(git(root, 'rev-parse', '--verify', LOCAL_REF).trim(), snapshot.sha);

  // Nothing a `git status` can see moved either.
  assert.equal(git(root, 'rev-parse', 'HEAD').trim(), head);
  assert.equal(git(root, 'rev-parse', `${LOCAL_REF}^`).trim(), head);
  assert.equal(git(root, 'status', '--porcelain'), DIRTY_STATUS);

  // The rehearsal repo got it on its `main`, which is the branch the run reads.
  assert.equal(git(remote, 'rev-parse', BRANCH).trim(), snapshot.sha);
});

test('a second run with no edits reuses the commit and pushes nothing new', (t) => {
  const { root, remote, indexFile } = scratchRepo(t);

  const first = snapshotTree({ root, indexFile, remote });
  const second = snapshotTree({ root, indexFile, remote });

  assert.equal(second.sha, first.sha);
  assert.equal(second.reused, true);
  assert.equal(git(remote, 'rev-parse', BRANCH).trim(), first.sha);
});

test('a HEAD that moves under an identical tree is a new commit on the new HEAD', (t) => {
  const { root, remote, indexFile } = scratchRepo(t);

  const first = snapshotTree({ root, indexFile, remote });

  // Commit that same working tree onto main, minus the excluded lockfile, so the
  // tree the next snapshot writes is identical and ONLY the parent has moved.
  git(root, 'add', '-A', '--', '.', ':!brands/omega-playground/package-lock.json');
  git(root, 'commit', '-qm', 'second');
  const head = git(root, 'rev-parse', 'HEAD').trim();

  const second = snapshotTree({ root, indexFile, remote });

  assert.equal(second.tree, first.tree);
  assert.notEqual(second.sha, first.sha);
  assert.equal(second.reused, false);
  assert.equal(git(root, 'rev-parse', `${LOCAL_REF}^`).trim(), head);
  assert.equal(git(remote, 'rev-parse', BRANCH).trim(), second.sha);
});

test('an edit between runs is a new commit on HEAD, force-pushed', (t) => {
  const { root, remote, indexFile, head } = scratchRepo(t);

  const first = snapshotTree({ root, indexFile, remote });
  jetpack.write(path.join(root, 'tracked.txt'), 'three\n');
  const second = snapshotTree({ root, indexFile, remote });

  assert.notEqual(second.sha, first.sha);
  assert.equal(second.reused, false);
  assert.equal(git(root, 'rev-parse', `${LOCAL_REF}^`).trim(), head);
  assert.equal(git(root, 'show', `${LOCAL_REF}:tracked.txt`), 'three\n');
  // The two snapshots are siblings, so the repo only reaches the second one by force.
  assert.equal(git(remote, 'rev-parse', BRANCH).trim(), second.sha);
});

test('the temporary index file never survives the run, success or failure', (t) => {
  const { root, remote, missing, indexFile } = scratchRepo(t);

  snapshotTree({ root, indexFile, remote });
  assert.equal(fs.existsSync(indexFile), false);

  // A push that cannot land (no repo at that address) still cleans up.
  assert.throws(() => snapshotTree({ root, indexFile, remote: missing }));
  assert.equal(fs.existsSync(indexFile), false);
});

test('ensureRepo takes an existing repo as it finds it, creating nothing', () => {
  const { calls, options, exec } = recorder();
  const { lines, logger } = recordingLogger();

  assert.deepEqual(ensureRepo({ exec, logger }), { created: false });
  assert.deepEqual(calls, [GH_REPO_VIEW]);
  assert.ok(lines.some((line) => line.includes('exists')));

  // The probe EXPECTS to fail on a fresh repo, so gh's own "Could not resolve to
  // a Repository" never reaches the log beside the script's lines.
  assert.equal(options[0].stdio[2], 'ignore', 'the repo probe must swallow gh stderr');
});

test('ensureRepo creates the missing repo PRIVATE, described as the throwaway it is', () => {
  const calls = [];
  const { lines, logger } = recordingLogger();

  // `gh repo view` on a repo that is not there yet exits non-zero.
  const exec = (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('view')) throw new Error('gh: Could not resolve to a Repository');
    return '';
  };

  assert.deepEqual(ensureRepo({ exec, logger }), { created: true });
  assert.deepEqual(calls, [GH_REPO_VIEW, GH_REPO_CREATE]);
  assert.ok(lines.some((line) => line.includes('created') && line.includes('private')));
});

test('waitForWorkflow rides out a workflow GitHub has not registered yet, then lets the dispatch run', async () => {
  const calls = [];
  const options = [];
  let sleeps = 0;

  // The first real run's failure, twice: GitHub indexes a pushed workflow a few
  // seconds after the push, and until it does the dispatch 404s.
  const exec = (file, args, opts) => {
    calls.push([file, ...args]);
    options.push(opts);
    if (calls.length < 3) throw new Error('gh: HTTP 404: workflow playground-desktop.yml not found on the default branch');
    return '{"id":1,"state":"active"}';
  };

  await waitForWorkflow({ exec, sleep: async () => { sleeps++; } });

  assert.deepEqual(calls, [GH_WORKFLOW_PROBE, GH_WORKFLOW_PROBE, GH_WORKFLOW_PROBE]);
  assert.equal(sleeps, 2);
  assert.equal(options[0].stdio[2], 'ignore', 'the 404 is the answer, not a line for the log');
});

test('waitForWorkflow fails loudly past the poll budget, and never sleeps after the last try', async () => {
  const calls = [];
  let sleeps = 0;
  const exec = (file, args) => {
    calls.push([file, ...args]);
    throw new Error('gh: HTTP 404');
  };

  await assert.rejects(
    waitForWorkflow({ exec, attempts: 3, sleep: async () => { sleeps++; } }),
    /still not registered/i,
  );
  assert.equal(calls.length, 3);
  assert.equal(sleeps, 2);
});

test('dispatchRun reads the run already there, then dispatches on the rehearsal repo\'s branch', () => {
  const { calls, exec } = recorder([JSON.stringify([{ databaseId: 11 }])]);

  const before = dispatchRun({ exec, platforms: 'windows' });

  assert.deepEqual(calls, [GH_LIST_ID, ['gh', 'workflow', 'run', WORKFLOW_FILE, '--repo', REPO, '--ref', BRANCH, '-f', 'platforms=windows']]);
  assert.equal(before, 11);
});

test('dispatchRun reports a branch with no run yet as null', () => {
  const { exec } = recorder();

  assert.equal(dispatchRun({ exec, platforms: 'all' }), null);
});

test('findRun waits out the run that was already there and returns the new one', async () => {
  const { calls, exec } = recorder([
    JSON.stringify([{ databaseId: 11, url: RUN_URL(11) }]),
    JSON.stringify([{ databaseId: 11, url: RUN_URL(11) }]),
    JSON.stringify([{ databaseId: 22, url: RUN_URL(22) }]),
  ]);

  const run = await findRun({ exec, before: 11, sleep: async () => {} });

  assert.equal(run.databaseId, 22);
  assert.equal(run.url, RUN_URL(22));
  assert.deepEqual(calls, [GH_LIST_RUN, GH_LIST_RUN, GH_LIST_RUN]);
});

test('findRun takes the first run to appear when the branch had none', async () => {
  const { calls, exec } = recorder(['[]', JSON.stringify([{ databaseId: 22, url: RUN_URL(22) }])]);

  const run = await findRun({ exec, before: null, sleep: async () => {} });

  assert.equal(run.databaseId, 22);
  assert.deepEqual(calls, [GH_LIST_RUN, GH_LIST_RUN]);
});

test('findRun fails loudly past the poll budget, and never sleeps after the last try', async () => {
  const { calls, exec } = recorder([JSON.stringify([{ databaseId: 11, url: RUN_URL(11) }])]);
  let sleeps = 0;

  await assert.rejects(
    findRun({ exec, before: 11, attempts: 3, sleep: async () => { sleeps++; } }),
    /no new run/i,
  );
  assert.equal(calls.length, 3);
  assert.equal(sleeps, 2);
});

test('publishSecrets sends the composed desktop keys, by delivered name, to the rehearsal repo', (t) => {
  const targetDir = fixtureTarget(t, 'GH_TOKEN="gh-fixture-token"\nGOOGLE_ANALYTICS_SECRET_DESKTOP="ga-fixture-secret"\nNOT_A_DESKTOP_KEY="ignored"\n');
  const { calls, exec } = recorder();
  const { lines, logger } = recordingLogger();

  const result = publishSecrets({ exec, logger, targetDir });

  // The delivery schema names the set: the brand-level GA key arrives as
  // GOOGLE_ANALYTICS_SECRET, and a key desktop never reads travels nowhere.
  assert.deepEqual(result.published, ['GH_TOKEN', 'GOOGLE_ANALYTICS_SECRET']);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(calls, [GH_AUTH, GH_SECRET_SET('GH_TOKEN'), GH_SECRET_SET('GOOGLE_ANALYTICS_SECRET')]);

  // Names and the count are logged; a VALUE never is, in argv or in output.
  assert.ok(lines.some((line) => line.includes('GH_TOKEN, GOOGLE_ANALYTICS_SECRET')));
  assert.ok(lines.includes('published 2/2'));
  assert.equal([...lines, ...calls.flat()].join('\n').includes('fixture'), false);
});

test('publishSecrets fails loudly on an empty set instead of dispatching a run that cannot build', (t) => {
  const targetDir = fixtureTarget(t);
  const { calls, exec } = recorder();
  const { logger } = recordingLogger();

  assert.throws(() => publishSecrets({ exec, logger, targetDir }), /no desktop secrets/i);
  assert.deepEqual(calls, []);
});

test('publishSecrets refuses a half-written set: one failed key throws, naming it', (t) => {
  const targetDir = fixtureTarget(t, 'GH_TOKEN="gh-fixture-token"\nGOOGLE_ANALYTICS_SECRET_DESKTOP="ga-fixture-secret"\n');
  const calls = [];
  const { lines, logger } = recordingLogger();

  // The second key's `gh secret set` fails the way a revoked scope does: the
  // first one is already published, which is exactly the half-written set.
  const exec = (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('GOOGLE_ANALYTICS_SECRET')) throw new Error('gh: HTTP 403');
    return '[]';
  };

  assert.throws(
    () => publishSecrets({ exec, logger, targetDir }),
    /1\/2.*GOOGLE_ANALYTICS_SECRET/s,
  );

  // Every key was still attempted, and no value rode along with the failure.
  assert.deepEqual(calls, [GH_AUTH, GH_SECRET_SET('GH_TOKEN'), GH_SECRET_SET('GOOGLE_ANALYTICS_SECRET')]);
  assert.equal(lines.join('\n').includes('fixture'), false);
});
