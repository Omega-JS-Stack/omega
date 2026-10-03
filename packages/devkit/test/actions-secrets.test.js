/**
 * GitHub Actions secret publishing (#189) — the `gh` boundary is stubbed
 * everywhere: the suite must never touch a real repo. Pins: the exact argv
 * (value NOT in it), stdin delivery of the value, the loud failure when gh is
 * missing or signed out, and per-key failure isolation.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const actionsSecrets = require('../src/actions-secrets.js');
const { assertGhReady } = require('../src/github-repo.js');

const { buildSecretArgs, setActionsSecret, publishActionsSecrets } = actionsSecrets;

const quiet = { log() {}, warn() {}, error() {} };

module.exports = defineCases({
  type: 'group',
  description: 'actions-secrets',
  tests: [
    {
      name: 'buildSecretArgs: gh argv carries the key and repo — never the value',
      run: (ctx) => {
        ctx.expect(buildSecretArgs({ repo: 'acme/site', key: 'OPENAI_API_KEY' })).toEqual(['secret', 'set', 'OPENAI_API_KEY', '--repo', 'acme/site']);

        ctx.expect(() => buildSecretArgs({ repo: 'site', key: 'A' })).toThrow(/repo must be "owner\/name"/);
        ctx.expect(() => buildSecretArgs({ repo: '', key: 'A' })).toThrow(/repo must be "owner\/name"/);
        ctx.expect(() => buildSecretArgs({ repo: 'acme/site', key: '9BAD' })).toThrow(/invalid secret name/);
        ctx.expect(() => buildSecretArgs({ repo: 'acme/site' })).toThrow(/invalid secret name/);
      },
    },

    {
      name: 'setActionsSecret: the value is delivered on stdin, not argv',
      run: (ctx) => {
        const calls = [];
        setActionsSecret({
          repo: 'acme/site',
          key: 'GH_TOKEN',
          value: 'ghp_supersecret',
          execFn: (file, args, options) => { calls.push({ file, args, options }); return ''; },
        });

        ctx.expect(calls.length).toBe(1);
        ctx.expect(calls[0].file).toBe('gh');
        ctx.expect(calls[0].args).toEqual(['secret', 'set', 'GH_TOKEN', '--repo', 'acme/site']);
        ctx.expect(calls[0].options.input, 'value rides stdin').toBe('ghp_supersecret');
        ctx.expect(!calls[0].args.some((a) => a.includes('ghp_supersecret')), 'value never appears in argv').toBeTruthy();
      },
    },

    {
      name: 'assertGhReady: its one home is github-repo.js, and it proves the login with `gh api user`',
      run: (ctx) => {
        ctx.expect(actionsSecrets.assertGhReady, 'actions-secrets keeps no copy of its own').toBe(undefined);

        const calls = [];
        assertGhReady({ execFn: (file, args) => { calls.push([file, ...args]); return ''; } });
        ctx.expect(calls).toEqual([['gh', '--version'], ['gh', 'api', 'user']]);
      },
    },

    {
      name: 'publishActionsSecrets: every key set once, in order, each value on stdin',
      run: (ctx) => {
        const calls = [];
        const result = publishActionsSecrets({
          repo: 'acme/site',
          secrets: { GH_TOKEN: 'tok', OPENAI_API_KEY: 'sk-1' },
          logger: quiet,
          execFn: (file, args, options) => { calls.push({ args, input: (options || {}).input }); return ''; },
        });

        ctx.expect(result.published).toEqual(['GH_TOKEN', 'OPENAI_API_KEY']);
        ctx.expect(result.failed).toEqual([]);
        ctx.expect(calls.map((c) => c.args.join(' '))).toEqual([
          '--version',
          'api user',
          'secret set GH_TOKEN --repo acme/site',
          'secret set OPENAI_API_KEY --repo acme/site',
        ]);
        ctx.expect(calls.slice(2).map((c) => c.input)).toEqual(['tok', 'sk-1']);
      },
    },

    {
      name: 'publishActionsSecrets: no gh → throws the install line before any secret is attempted',
      run: (ctx) => {
        const calls = [];
        ctx.expect(() => publishActionsSecrets({
            repo: 'acme/site',
            secrets: { A: '1' },
            logger: quiet,
            execFn: (file, args) => {
              calls.push(args.join(' '));
              throw new Error('spawnSync gh ENOENT');
            },
          })).toThrow((error) => /GitHub CLI \(gh\) is not installed/.test(error.message) && /--no-secrets/.test(error.message));
        ctx.expect(calls, 'nothing was published').toEqual(['--version']);
      },
    },

    {
      name: 'publishActionsSecrets: a signed-out gh throws the sign-in line before any secret is written',
      run: (ctx) => {
        const calls = [];
        ctx.expect(() => publishActionsSecrets({
            repo: 'acme/site',
            secrets: { A: '1' },
            logger: quiet,
            execFn: (file, args) => {
              calls.push(args.join(' '));
              if (args[0] === 'api' && args[1] === 'user') throw new Error('gh: Bad credentials (HTTP 401)');
              return '';
            },
          })).toThrow((error) => /gh auth login \(or set GH_TOKEN in the brand \.env\)/.test(error.message) && /--no-secrets/.test(error.message));
        ctx.expect(!calls.some((call) => call.startsWith('secret set')), `nothing was published: ${calls.join(' | ')}`).toBeTruthy();
      },
    },

    {
      name: 'publishActionsSecrets: one bad key is reported, the rest still publish',
      run: (ctx) => {
        const result = publishActionsSecrets({
          repo: 'acme/site',
          secrets: { GOOD: '1', BAD: '2', ALSO_GOOD: '3' },
          logger: quiet,
          execFn: (file, args) => {
            if (args[2] === 'BAD') throw new Error('HTTP 403: Resource not accessible');
            return '';
          },
        });

        ctx.expect(result.published).toEqual(['GOOD', 'ALSO_GOOD']);
        ctx.expect(result.failed.map((f) => f.key)).toEqual(['BAD']);
        ctx.expect(result.failed[0].message).toMatch(/403/);
      },
    },

    {
      name: 'publishActionsSecrets: an empty map is a no-op — gh is never even probed',
      run: (ctx) => {
        const result = publishActionsSecrets({
          repo: 'acme/site',
          secrets: {},
          logger: quiet,
          execFn: () => { throw new Error('gh must not run'); },
        });
        ctx.expect(result).toEqual({ published: [], failed: [] });
      },
    },
  ],
});
