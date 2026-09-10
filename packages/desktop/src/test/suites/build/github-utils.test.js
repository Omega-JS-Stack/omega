// Build-layer tests for src/utils/github.js — the octokit factory + repo ensure.
// Repo DISCOVERY is not this module's job any more (#799): the app repo and the
// releases repo come from @omega.js/config, never a package.json or a git remote.

const path    = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'utils/github — octokit factory + repo ensure',
  tests: [
    {
      name: 'github utils exports the octokit surface and NO repo discovery (#799)',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'utils', 'github.js'));
        ctx.expect(typeof mod.getOctokit).toBe('function');
        ctx.expect(typeof mod.ensureRepo).toBe('function');
        // The git-remote fallback is gone: in a brand monorepo it answered the
        // ENCLOSING repo, so every release verb targeted the wrong owner.
        ctx.expect(mod.discoverRepo).toBeUndefined();
      },
    },
    {
      name: 'getOctokit returns null when GH_TOKEN missing',
      run: (ctx) => {
        const { getOctokit } = require(path.join(__dirname, '..', '..', '..', 'utils', 'github.js'));
        const orig = process.env.GH_TOKEN;
        delete process.env.GH_TOKEN;
        try {
          ctx.expect(getOctokit()).toBe(null);
        } finally {
          if (orig !== undefined) process.env.GH_TOKEN = orig;
        }
      },
    },
    {
      name: 'getOctokit returns a client when GH_TOKEN set',
      run: (ctx) => {
        const { getOctokit } = require(path.join(__dirname, '..', '..', '..', 'utils', 'github.js'));
        const orig = process.env.GH_TOKEN;
        process.env.GH_TOKEN = 'ghp_test_fake_token_for_unit_test';
        try {
          const client = getOctokit();
          ctx.expect(client).toBeDefined();
          ctx.expect(typeof client.rest).toBe('object');
        } finally {
          if (orig !== undefined) process.env.GH_TOKEN = orig;
          else delete process.env.GH_TOKEN;
        }
      },
    },
  ],
});
