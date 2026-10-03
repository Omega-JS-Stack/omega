// Unit tests for the GitHub half of src/deploy-snapshot.js: the default-branch
// heal and the two waits that follow a snapshot push. Only the network is
// injected (fetchFn), so every call is pinned by URL and method.

const defineCases = require('@omega.js/devkit/test/define-cases');
const { healDefaultBranch, waitForWorkflow, waitForRef } = require('../src/deploy-snapshot.js');

const TOKEN = 'ghp_fixture_token';

module.exports = defineCases({
  type: 'group',
  description: 'deploy-github',
  tests: [
    {
      name: 'waitForWorkflow polls until GitHub answers for the workflow',
      run: async (ctx) => {
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

        ctx.expect(seen.length, 'it stopped at the first 200').toBe(3);
        ctx.expect(seen[0].url).toBe('https://api.github.com/repos/acme/acme-omega/actions/workflows/desktop-build.yml');
        ctx.expect(seen[0].authorization).toBe(`Bearer ${TOKEN}`);
      },
    },

    {
      name: 'healDefaultBranch: a gh-pages DEFAULT branch moves back to main (#922)',
      run: async (ctx) => {
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

        ctx.expect(calls, 'main is already there, so nothing is created').toEqual([
          'GET https://api.github.com/repos/acme/acme-omega/git/ref/heads/main',
          'PATCH https://api.github.com/repos/acme/acme-omega',
        ]);
        ctx.expect(branch, 'the lane composes onto main from here on').toBe('main');
        ctx.expect(lines.filter((line) => line.includes('default branch')).length, 'one line says so').toBe(1);
      },
    },

    {
      name: 'healDefaultBranch: no main at all, so it is created from gh-pages first (#922)',
      run: async (ctx) => {
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

        ctx.expect(calls).toEqual([
          'GET https://api.github.com/repos/acme/acme-omega/git/ref/heads/main',
          'GET https://api.github.com/repos/acme/acme-omega/git/ref/heads/gh-pages',
          'POST https://api.github.com/repos/acme/acme-omega/git/refs',
          'PATCH https://api.github.com/repos/acme/acme-omega',
        ]);
        ctx.expect(created, 'main starts at the head gh-pages carries').toEqual({ ref: 'refs/heads/main', sha: 'bbbb2222' });
        ctx.expect(branch).toBe('main');
      },
    },

    {
      name: 'healDefaultBranch: an ordinary default branch is not touched at all (#922)',
      run: async (ctx) => {
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

        ctx.expect(calls, 'the heal is once per repo: a healthy default costs no call').toEqual([]);
        ctx.expect(branch, 'and the lane keeps the branch it read').toBe('main');
      },
    },

    {
      name: 'healDefaultBranch: a flip that FAILS refuses instead of composing onto gh-pages (#922)',
      run: async (ctx) => {
        await ctx.expect((() => healDefaultBranch({
            owner: 'acme',
            repo: 'acme-omega',
            current: 'gh-pages',
            token: TOKEN,
            fetchFn: async (url) => (url.endsWith('/git/ref/heads/main')
              ? { status: 200, json: async () => ({ object: { sha: 'aaaa1111' } }) }
              : { status: 403 }),
          }))()).rejects.toThrow(/set the default branch by hand and re-run the deploy/i);
      },
    },

    {
      name: 'waitForWorkflow: the wait heals nothing, and never reads the repo (#922)',
      run: async (ctx) => {
        const calls = [];

        await ctx.expect((() => waitForWorkflow({
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
          }))()).rejects.toThrow(/website-build\.yml/);

        ctx.expect(calls.every((url) => url.includes('/actions/workflows/')), 'only the workflow listing was ever read').toBe(true);
      },
    },

    {
      name: 'waitForWorkflow gives up loudly, naming the workflow and the ref',
      run: async (ctx) => {
        let attempts = 0;

        await ctx.expect((() => waitForWorkflow({
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
          }))()).rejects.toThrow(/desktop-build\.yml[\s\S]*omega-deploy/);
        ctx.expect(attempts, 'the whole budget was spent').toBe(3);
      },
    },

    {
      name: 'waitForRef polls until the ref RESOLVES to the pushed sha (#902)',
      run: async (ctx) => {
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

        ctx.expect(seen.length, 'it stopped at the poll that carried this deploy\'s sha').toBe(3);
        ctx.expect(seen[0].url).toBe('https://api.github.com/repos/Omega-JS-Stack/playground-omega/git/ref/heads/main');
        ctx.expect(seen[0].authorization).toBe(`Bearer ${TOKEN}`);
        ctx.expect(lines.length, 'one line per stale answer').toBe(2);
        ctx.expect(lines[0]).toMatch(/Omega-JS-Stack\/playground-omega#main still resolves to cf6718c, waiting for d09a588/);
      },
    },

    {
      name: 'waitForRef gives up loudly, naming the ref, the pushed sha and what GitHub reported (#902)',
      run: async (ctx) => {
        let attempts = 0;

        await ctx.expect((() => waitForRef({
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
          }))()).rejects.toThrow((error) => {
            ctx.expect(error.message, 'the ref it waited on').toMatch(/acme\/acme-omega#main/);
            ctx.expect(error.message, 'the sha this deploy pushed').toMatch(/d09a5882bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
            ctx.expect(error.message, 'and the one GitHub kept reporting').toMatch(/cf6718cdaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
            return true;
          });
        ctx.expect(attempts, 'the whole budget was spent').toBe(2);
      },
    },

    {
      name: 'waitForRef: a ref GitHub has not created yet counts as a miss, never a throw (#902)',
      run: async (ctx) => {
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

        ctx.expect(statuses, 'the miss was polled through, and the 200 that carried the sha resolved it').toEqual([404, 200]);
      },
    },
  ],
});
