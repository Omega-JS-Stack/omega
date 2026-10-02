// Unit tests for the GitHub half of src/deploy-snapshot.js: the default-branch
// heal and the two waits that follow a snapshot push. Only the network is
// injected (fetchFn), so every call is pinned by URL and method.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { healDefaultBranch, waitForWorkflow, waitForRef } = require('../src/deploy-snapshot.js');

const TOKEN = 'ghp_fixture_token';

test('waitForWorkflow polls until GitHub answers for the workflow', async () => {
  const seen = [];
  const answers = [404, 404, 200];

  await waitForWorkflow({
    owner: 'acme',
    repo: 'acme-omega',
    workflow: 'desktop-build.yml',
    ref: 'main',
    token: TOKEN,
    attempts: 5,
    delayMs: 0,
    fetchFn: async (url, options) => {
      seen.push({ url, authorization: options.headers.Authorization });
      return { status: answers[seen.length - 1] };
    },
  });

  assert.equal(seen.length, 3, 'it stopped at the first 200');
  assert.equal(seen[0].url, 'https://api.github.com/repos/acme/acme-omega/actions/workflows/desktop-build.yml');
  assert.equal(seen[0].authorization, `Bearer ${TOKEN}`);
});

test('healDefaultBranch: a gh-pages DEFAULT branch moves back to main (#922)', async () => {
  // GitHub registers a workflow from the DEFAULT branch, so a repo whose first
  // web deploy created gh-pages points every listing and every dispatch at the
  // published site, where the next web deploy's force-push wipes whatever the
  // compose step wrote. The heal runs on the name the lane already read.
  const calls = [];
  const lines = [];

  const branch = await healDefaultBranch({
    owner: 'acme',
    repo: 'acme-omega',
    current: 'gh-pages',
    token: TOKEN,
    logger: { log: (line) => lines.push(line) },
    fetchFn: async (url, options) => {
      calls.push(`${options.method || 'GET'} ${url}`);

      if (url === 'https://api.github.com/repos/acme/acme-omega/git/ref/heads/main') {
        return { status: 200, json: async () => ({ object: { sha: 'aaaa1111' } }) };
      }

      return { status: 200 };
    },
  });

  assert.deepEqual(calls, [
    'GET https://api.github.com/repos/acme/acme-omega/git/ref/heads/main',
    'PATCH https://api.github.com/repos/acme/acme-omega',
  ], 'main is already there, so nothing is created');
  assert.equal(branch, 'main', 'the lane composes onto main from here on');
  assert.equal(lines.filter((line) => line.includes('default branch')).length, 1, 'one line says so');
});

test('healDefaultBranch: no main at all, so it is created from gh-pages first (#922)', async () => {
  // The live shape: an empty repo whose FIRST web deploy created gh-pages, so
  // the branch the default moves to does not exist yet.
  const calls = [];
  let created = null;

  const branch = await healDefaultBranch({
    owner: 'acme',
    repo: 'acme-omega',
    current: 'gh-pages',
    token: TOKEN,
    fetchFn: async (url, options) => {
      calls.push(`${options.method || 'GET'} ${url}`);

      if (url === 'https://api.github.com/repos/acme/acme-omega/git/ref/heads/main') {
        return { status: 404 };
      }
      if (url === 'https://api.github.com/repos/acme/acme-omega/git/ref/heads/gh-pages') {
        return { status: 200, json: async () => ({ object: { sha: 'bbbb2222' } }) };
      }
      if (url === 'https://api.github.com/repos/acme/acme-omega/git/refs') {
        created = JSON.parse(options.body);
        return { status: 201 };
      }

      return { status: 200 };
    },
  });

  assert.deepEqual(calls, [
    'GET https://api.github.com/repos/acme/acme-omega/git/ref/heads/main',
    'GET https://api.github.com/repos/acme/acme-omega/git/ref/heads/gh-pages',
    'POST https://api.github.com/repos/acme/acme-omega/git/refs',
    'PATCH https://api.github.com/repos/acme/acme-omega',
  ]);
  assert.deepEqual(created, { ref: 'refs/heads/main', sha: 'bbbb2222' }, 'main starts at the head gh-pages carries');
  assert.equal(branch, 'main');
});

test('healDefaultBranch: an ordinary default branch is not touched at all (#922)', async () => {
  const calls = [];

  const branch = await healDefaultBranch({
    owner: 'acme',
    repo: 'acme-omega',
    current: 'main',
    token: TOKEN,
    fetchFn: async (url) => {
      calls.push(url);
      return { status: 200 };
    },
  });

  assert.deepEqual(calls, [], 'the heal is once per repo: a healthy default costs no call');
  assert.equal(branch, 'main', 'and the lane keeps the branch it read');
});

test('healDefaultBranch: a flip that FAILS refuses instead of composing onto gh-pages (#922)', async () => {
  await assert.rejects(
    () => healDefaultBranch({
      owner: 'acme',
      repo: 'acme-omega',
      current: 'gh-pages',
      token: TOKEN,
      fetchFn: async (url) => (url.endsWith('/git/ref/heads/main')
        ? { status: 200, json: async () => ({ object: { sha: 'aaaa1111' } }) }
        : { status: 403 }),
    }),
    /set the default branch by hand and re-run the deploy/i,
  );
});

test('waitForWorkflow: the wait heals nothing, and never reads the repo (#922)', async () => {
  const calls = [];

  await assert.rejects(
    () => waitForWorkflow({
      owner: 'acme',
      repo: 'acme-omega',
      workflow: 'website-build.yml',
      ref: 'omega-deploy',
      token: TOKEN,
      attempts: 2,
      delayMs: 0,
      fetchFn: async (url) => {
        calls.push(url);
        return { status: 404 };
      },
    }),
    /website-build\.yml/,
  );

  assert.equal(calls.every((url) => url.includes('/actions/workflows/')), true, 'only the workflow listing was ever read');
});

test('waitForWorkflow gives up loudly, naming the workflow and the ref', async () => {
  let attempts = 0;

  await assert.rejects(
    () => waitForWorkflow({
      owner: 'acme',
      repo: 'acme-omega',
      workflow: 'desktop-build.yml',
      ref: 'omega-deploy',
      token: TOKEN,
      attempts: 3,
      delayMs: 0,
      fetchFn: async () => {
        attempts++;
        return { status: 404 };
      },
    }),
    /desktop-build\.yml[\s\S]*omega-deploy/,
  );
  assert.equal(attempts, 3, 'the whole budget was spent');
});

test('waitForRef polls until the ref RESOLVES to the pushed sha (#902)', async () => {
  // The live shape: the force-push is accepted, GitHub keeps answering the
  // PREVIOUS snapshot for a moment, and a dispatch sent in that moment starts a
  // run on the wrong tree.
  const seen = [];
  const answers = ['cf6718cdaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'cf6718cdaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'd09a5882bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'];
  const lines = [];

  await waitForRef({
    owner: 'Omega-JS-Stack',
    repo: 'playground-omega',
    ref: 'main',
    sha: 'd09a5882bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    token: TOKEN,
    attempts: 5,
    delayMs: 0,
    logger: { log: (line) => lines.push(line) },
    fetchFn: async (url, options) => {
      seen.push({ url, authorization: options.headers.Authorization });
      return { status: 200, json: async () => ({ object: { sha: answers[seen.length - 1] } }) };
    },
  });

  assert.equal(seen.length, 3, 'it stopped at the poll that carried this deploy\'s sha');
  assert.equal(seen[0].url, 'https://api.github.com/repos/Omega-JS-Stack/playground-omega/git/ref/heads/main');
  assert.equal(seen[0].authorization, `Bearer ${TOKEN}`);
  assert.equal(lines.length, 2, 'one line per stale answer');
  assert.match(lines[0], /Omega-JS-Stack\/playground-omega#main still resolves to cf6718c, waiting for d09a588/);
});

test('waitForRef gives up loudly, naming the ref, the pushed sha and what GitHub reported (#902)', async () => {
  let attempts = 0;

  await assert.rejects(
    () => waitForRef({
      owner: 'acme',
      repo: 'acme-omega',
      ref: 'main',
      sha: 'd09a5882bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      token: TOKEN,
      attempts: 2,
      delayMs: 0,
      fetchFn: async () => {
        attempts++;
        return { status: 200, json: async () => ({ object: { sha: 'cf6718cdaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } }) };
      },
    }),
    (error) => {
      assert.match(error.message, /acme\/acme-omega#main/, 'the ref it waited on');
      assert.match(error.message, /d09a5882bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/, 'the sha this deploy pushed');
      assert.match(error.message, /cf6718cdaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/, 'and the one GitHub kept reporting');
      return true;
    },
  );
  assert.equal(attempts, 2, 'the whole budget was spent');
});

test('waitForRef: a ref GitHub has not created yet counts as a miss, never a throw (#902)', async () => {
  // A brand's FIRST snapshot: the branch does not exist until the push lands,
  // so the 404 is the ordinary case rather than a failure.
  const statuses = [];

  await waitForRef({
    owner: 'acme',
    repo: 'acme-omega',
    ref: 'main',
    sha: 'abc1234567890abcdef1234567890abcdef12345',
    token: TOKEN,
    attempts: 5,
    delayMs: 0,
    fetchFn: async () => {
      statuses.push(statuses.length === 0 ? 404 : 200);
      return statuses.length === 1
        ? { status: 404 }
        : { status: 200, json: async () => ({ object: { sha: 'abc1234567890abcdef1234567890abcdef12345' } }) };
    },
  });

  assert.deepEqual(statuses, [404, 200], 'the miss was polled through, and the 200 that carried the sha resolved it');
});
