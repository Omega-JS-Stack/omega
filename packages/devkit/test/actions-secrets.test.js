/**
 * GitHub Actions secret publishing (#189) — the `gh` boundary is stubbed
 * everywhere: the suite must never touch a real repo. Pins: the exact argv
 * (value NOT in it), stdin delivery of the value, the loud failure when gh is
 * missing or signed out, and per-key failure isolation.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const actionsSecrets = require('../src/actions-secrets.js');
const { assertGhReady } = require('../src/github-repo.js');

const { buildSecretArgs, setActionsSecret, publishActionsSecrets } = actionsSecrets;

const quiet = { log() {}, warn() {}, error() {} };

test('buildSecretArgs: gh argv carries the key and repo — never the value', () => {
  assert.deepStrictEqual(
    buildSecretArgs({ repo: 'acme/site', key: 'OPENAI_API_KEY' }),
    ['secret', 'set', 'OPENAI_API_KEY', '--repo', 'acme/site'],
  );

  assert.throws(() => buildSecretArgs({ repo: 'site', key: 'A' }), /repo must be "owner\/name"/);
  assert.throws(() => buildSecretArgs({ repo: '', key: 'A' }), /repo must be "owner\/name"/);
  assert.throws(() => buildSecretArgs({ repo: 'acme/site', key: '9BAD' }), /invalid secret name/);
  assert.throws(() => buildSecretArgs({ repo: 'acme/site' }), /invalid secret name/);
});

test('setActionsSecret: the value is delivered on stdin, not argv', () => {
  const calls = [];
  setActionsSecret({
    repo: 'acme/site',
    key: 'GH_TOKEN',
    value: 'ghp_supersecret',
    execFn: (file, args, options) => { calls.push({ file, args, options }); return ''; },
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].file, 'gh');
  assert.deepStrictEqual(calls[0].args, ['secret', 'set', 'GH_TOKEN', '--repo', 'acme/site']);
  assert.strictEqual(calls[0].options.input, 'ghp_supersecret', 'value rides stdin');
  assert.ok(!calls[0].args.some((a) => a.includes('ghp_supersecret')), 'value never appears in argv');
});

test('assertGhReady: its one home is github-repo.js, and it proves the login with `gh api user`', () => {
  assert.strictEqual(actionsSecrets.assertGhReady, undefined, 'actions-secrets keeps no copy of its own');

  const calls = [];
  assertGhReady({ execFn: (file, args) => { calls.push([file, ...args]); return ''; } });
  assert.deepStrictEqual(calls, [['gh', '--version'], ['gh', 'api', 'user']]);
});

test('publishActionsSecrets: every key set once, in order, each value on stdin', () => {
  const calls = [];
  const result = publishActionsSecrets({
    repo: 'acme/site',
    secrets: { GH_TOKEN: 'tok', OPENAI_API_KEY: 'sk-1' },
    logger: quiet,
    execFn: (file, args, options) => { calls.push({ args, input: (options || {}).input }); return ''; },
  });

  assert.deepStrictEqual(result.published, ['GH_TOKEN', 'OPENAI_API_KEY']);
  assert.deepStrictEqual(result.failed, []);
  assert.deepStrictEqual(calls.map((c) => c.args.join(' ')), [
    '--version',
    'api user',
    'secret set GH_TOKEN --repo acme/site',
    'secret set OPENAI_API_KEY --repo acme/site',
  ]);
  assert.deepStrictEqual(calls.slice(2).map((c) => c.input), ['tok', 'sk-1']);
});

test('publishActionsSecrets: no gh → throws the install line before any secret is attempted', () => {
  const calls = [];
  assert.throws(
    () => publishActionsSecrets({
      repo: 'acme/site',
      secrets: { A: '1' },
      logger: quiet,
      execFn: (file, args) => {
        calls.push(args.join(' '));
        throw new Error('spawnSync gh ENOENT');
      },
    }),
    (error) => /GitHub CLI \(gh\) is not installed/.test(error.message) && /--no-secrets/.test(error.message),
  );
  assert.deepStrictEqual(calls, ['--version'], 'nothing was published');
});

test('publishActionsSecrets: a signed-out gh throws the sign-in line before any secret is written', () => {
  const calls = [];
  assert.throws(
    () => publishActionsSecrets({
      repo: 'acme/site',
      secrets: { A: '1' },
      logger: quiet,
      execFn: (file, args) => {
        calls.push(args.join(' '));
        if (args[0] === 'api' && args[1] === 'user') throw new Error('gh: Bad credentials (HTTP 401)');
        return '';
      },
    }),
    (error) => /gh auth login \(or set GH_TOKEN in the brand \.env\)/.test(error.message) && /--no-secrets/.test(error.message),
  );
  assert.ok(!calls.some((call) => call.startsWith('secret set')), `nothing was published: ${calls.join(' | ')}`);
});

test('publishActionsSecrets: one bad key is reported, the rest still publish', () => {
  const result = publishActionsSecrets({
    repo: 'acme/site',
    secrets: { GOOD: '1', BAD: '2', ALSO_GOOD: '3' },
    logger: quiet,
    execFn: (file, args) => {
      if (args[2] === 'BAD') throw new Error('HTTP 403: Resource not accessible');
      return '';
    },
  });

  assert.deepStrictEqual(result.published, ['GOOD', 'ALSO_GOOD']);
  assert.deepStrictEqual(result.failed.map((f) => f.key), ['BAD']);
  assert.match(result.failed[0].message, /403/);
});

test('publishActionsSecrets: an empty map is a no-op — gh is never even probed', () => {
  const result = publishActionsSecrets({
    repo: 'acme/site',
    secrets: {},
    logger: quiet,
    execFn: () => { throw new Error('gh must not run'); },
  });
  assert.deepStrictEqual(result, { published: [], failed: [] });
});
