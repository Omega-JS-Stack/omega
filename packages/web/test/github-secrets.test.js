/**
 * `.env` → Actions secrets (#189): the SCHEMA-derived key set every lane now
 * shares ([#627](https://github.com/Omega-JS-Stack/omega/issues/627)), the
 * composed target env that supplies its VALUES
 * ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)), the generated
 * workflow env block, and the setup step's loud skips.
 *
 * The `gh`/`git` boundaries are injected in every test — the suite never
 * touches a real repo.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { publishSecretKeys, WORKFLOW_OWNED_KEYS } = require('@omega.js/config/env-delivery');

const {
  collectEnvSecrets,
  renderSecretsBlock,
  publishEnvSecrets,
} = require('../src/github-secrets.js');
const { scaffoldDefaults } = require('../src/scaffold.js');

const quiet = { log() {}, warn() {}, error() {} };

// The schema's answer for web — the ONE list this suite asserts against, so a
// new `delivery: { web: 'ci' }` entry never needs an edit here.
const WEB_KEYS = publishSecretKeys('web');

/** A temp target dir, optionally with a local-level .env. */
function tmpTarget(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-secrets-'));
  if (env !== undefined) fs.writeFileSync(path.join(dir, '.env'), env);
  return dir;
}

/**
 * A `git` stub that answers PER COMMAND. The publisher resolves the deploy lane
 * before it guards ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)),
 * so `rev-parse --show-toplevel` has to answer that this checkout IS the brand
 * root: an unplaced answer reads as a NESTED brand, whose remote names the
 * enclosing repo by construction and whose mismatch guard is therefore skipped.
 *
 * @param {string|function} remote - What `git config --get remote.origin.url` answers (or throws).
 * @returns {function} `(command, options) => string`
 */
function gitStub(remote) {
  return (command, options) => {
    if (command.includes('rev-parse')) return `${options.cwd}\n`;
    return typeof remote === 'function' ? remote() : remote;
  };
}

/** A brand root (config/omega.json5) with a target under targets/. */
function tmpBrand(options) {
  const { brandEnv, targetEnv } = options || {};
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-brand-'));
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), '{ brand: { id: "b" } }');
  if (brandEnv !== undefined) fs.writeFileSync(path.join(brand, '.env'), brandEnv);

  const target = path.join(brand, 'targets', 'website');
  fs.mkdirSync(target, { recursive: true });
  if (targetEnv !== undefined) fs.writeFileSync(path.join(target, '.env'), targetEnv);

  return { brand, target };
}

/** Declare the brand's own GitHub repo — the publish precondition. */
function declareRepo(dir, slug) {
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'omega.json5'), [
    '{',
    "  brand: { id: 'my-brand', name: 'My Brand', url: 'https://my.brand' },",
    `  repo: { providers: { github: { repo: '${slug}' } } },`,
    '  targets: { web: {} },',
    '}',
  ].join('\n'));
}

test('collect: the SCHEMA names the keys, the composed env supplies the values (#627)', () => {
  // A key nobody declared for web is not a web secret, however it got into the
  // cascade — the published set is the schema's `delivery: { web: … }` list.
  const dir = tmpTarget('OPENAI_API_KEY=sk\nMY_CUSTOM_THING=custom\nlowercase=nope\nRECAPTCHA_SITE_KEY=\n');
  assert.deepStrictEqual(collectEnvSecrets(dir), { OPENAI_API_KEY: 'sk' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('collect: the composed env is FILES only — the shell is never a source (#678)', () => {
  const { brand, target } = tmpBrand({ brandEnv: 'GH_TOKEN=brand-token\n' });

  process.env.OMEGA_TEST_USER_UID = 'shell-only';
  try {
    assert.deepStrictEqual(collectEnvSecrets(target), { GH_TOKEN: 'brand-token' });
  } finally {
    delete process.env.OMEGA_TEST_USER_UID;
  }

  fs.rmSync(brand, { recursive: true, force: true });
});

test('collect: the brand-root .env alone supplies the target — no target .env exists (#678)', () => {
  const { brand, target } = tmpBrand({ brandEnv: 'GH_TOKEN=brand-token\nOPENAI_API_KEY=brand-openai\n' });

  assert.ok(!fs.existsSync(path.join(target, '.env')), 'the target ships no .env of its own');
  assert.deepStrictEqual(collectEnvSecrets(target), {
    GH_TOKEN: 'brand-token',
    OPENAI_API_KEY: 'brand-openai',
  });

  fs.rmSync(brand, { recursive: true, force: true });
});

test('collect: a target .env overrides the brand root per key (#678)', () => {
  const { brand, target } = tmpBrand({
    brandEnv: 'GH_TOKEN=brand-token\nOPENAI_API_KEY=brand-openai\n',
    targetEnv: 'GH_TOKEN=target-token\nLOCAL_ONLY=local-value\n',
  });

  assert.deepStrictEqual(collectEnvSecrets(target), {
    GH_TOKEN: 'target-token',
    OPENAI_API_KEY: 'brand-openai',
  });

  fs.rmSync(brand, { recursive: true, force: true });
});

test('collect: the env schema decides what rides down — a backend key stays home, GA4 arrives renamed (#678)', () => {
  const { brand, target } = tmpBrand({
    brandEnv: [
      'STRIPE_SECRET_KEY=sk_live_brand',
      'GOOGLE_ANALYTICS_SECRET_BACKEND=backend-stream',
      'GOOGLE_ANALYTICS_SECRET_WEB=web-stream',
      'MY_CUSTOM_THING=custom',
      '',
    ].join('\n'),
  });

  assert.deepStrictEqual(collectEnvSecrets(target), {
    GOOGLE_ANALYTICS_SECRET: 'web-stream',
  });

  fs.rmSync(brand, { recursive: true, force: true });
});

test('#454: machine-local keys never publish, from any layer', () => {
  // The schema drops them from the delivered set itself, so no lane can carry
  // a developer-machine path to a runner.
  assert.ok(require('@omega.js/config/env-schema').isMachineLocal('OMEGA_FONTAWESOME_ROOT'), 'the schema flags the key');
  assert.ok(!WEB_KEYS.includes('OMEGA_FONTAWESOME_ROOT'), 'and it is not a web delivery');

  const dir = tmpTarget('OMEGA_FONTAWESOME_ROOT=/Users/ian/.omega/fontawesome\nOPENAI_API_KEY=sk\n');
  assert.deepStrictEqual(collectEnvSecrets(dir), { OPENAI_API_KEY: 'sk' });

  // Nor from the brand root, where the cascade otherwise delivers it to web.
  const { brand, target } = tmpBrand({ brandEnv: 'OMEGA_FONTAWESOME_ROOT=/Users/ian/.omega/fontawesome\n' });
  assert.deepStrictEqual(collectEnvSecrets(target), {});

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(brand, { recursive: true, force: true });
});

test('#454: a machine-local key never reaches the workflow env block either', () => {
  const dir = tmpTarget('OMEGA_FONTAWESOME_ROOT=/Users/ian/.omega/fontawesome\n');

  scaffoldDefaults({ outputDir: dir, logger: quiet });
  const workflow = fs.readFileSync(path.join(dir, '.github', 'workflows', 'build.yml'), 'utf8');

  assert.ok(!workflow.includes('OMEGA_FONTAWESOME_ROOT'), 'the machine-local path is not injected into CI');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('#715: no scaffold workflow gates a step on the `secrets` context — GitHub refuses the whole file', () => {
  // The `secrets` context is unavailable in EVERY `if` expression; one such
  // line makes the server reject the workflow before it runs a job, so the
  // consumer sees a zero-job "workflow file issue" run on every push.
  const workflowDir = path.join(__dirname, '..', 'scaffold', '.github', 'workflows');

  for (const name of fs.readdirSync(workflowDir)) {
    const template = fs.readFileSync(path.join(workflowDir, name), 'utf8');
    for (const line of template.split('\n')) {
      if (!/^\s*if:/.test(line)) continue;
      assert.ok(!line.includes('secrets.'), `${name} gates a step on the secrets context: ${line.trim()}`);
    }
  }

  // A secret-conditional step reads the value through the workflow env block.
  const dir = tmpTarget('GH_TOKEN=ghp\n');
  scaffoldDefaults({ outputDir: dir, logger: quiet });
  const workflow = fs.readFileSync(path.join(dir, '.github', 'workflows', 'build.yml'), 'utf8');

  assert.ok(workflow.includes('\n  CLOUDFLARE_TOKEN: ${{ secrets.CLOUDFLARE_TOKEN }}'),
    'the purge token is hoisted into the workflow env block');
  assert.ok(workflow.includes("if: env.CLOUDFLARE_TOKEN != ''"), 'the purge step gates on env');
  // …and the publish lane arms that gate: without the repo secret the
  // expression is permanently false and the purge step can never fire (#728)
  assert.ok(WEB_KEYS.includes('CLOUDFLARE_TOKEN'), 'the purge token publishes as a repo Actions secret');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('block: one `KEY: ${{ secrets.KEY }}` line per SCHEMA key, sorted, template-owned keys dropped (#627)', () => {
  const expected = WEB_KEYS
    .filter((key) => !WORKFLOW_OWNED_KEYS.includes(key))
    .map((key) => `${key}: \${{ secrets.${key} }}`)
    .join('\n  ');

  assert.strictEqual(renderSecretsBlock('web'), expected);

  // GH_TOKEN/NODE_* are already in the workflow's env: block — a second
  // mapping key there would be invalid YAML.
  assert.ok(WEB_KEYS.includes('GH_TOKEN'), 'GH_TOKEN is published…');
  assert.ok(!renderSecretsBlock('web').includes('GH_TOKEN'), '…and never re-rendered');
});

test('workflow: the scaffolded block is the schema set — the same block for any .env (#627)', () => {
  const dir = tmpTarget('OPENAI_API_KEY=sk\nGH_TOKEN=ghp\n');
  const workflowPath = path.join(dir, '.github', 'workflows', 'build.yml');

  scaffoldDefaults({ outputDir: dir, logger: quiet });
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  for (const key of WEB_KEYS.filter((k) => !WORKFLOW_OWNED_KEYS.includes(k))) {
    assert.ok(workflow.includes(`\n  ${key}: \${{ secrets.${key} }}`), `${key} injected`);
  }
  assert.ok(!workflow.includes('{{ githubSecrets }}'), 'the token is consumed');
  assert.strictEqual(
    (workflow.match(/^ {2}GH_TOKEN:/gm) || []).length,
    1,
    'GH_TOKEN stays a single env key (the template already declares it)',
  );

  // A CHANGED .env no longer moves the block: what CI needs is what the schema
  // declares, not what this machine's files happen to hold.
  fs.writeFileSync(path.join(dir, '.env'), 'CLOUDFLARE_TOKEN=cf\n');
  const second = scaffoldDefaults({ outputDir: dir, logger: quiet });
  const reread = fs.readFileSync(workflowPath, 'utf8');

  assert.ok(!renderSecretsBlock('web').includes('CLOUDFLARE_TOKEN'), 'the template declares it itself — the generated block never restates it (#728)');
  assert.strictEqual(
    (reread.match(/^ {2}CLOUDFLARE_TOKEN:/gm) || []).length,
    1,
    "the only CLOUDFLARE_TOKEN env key is the template's own purge gate (#715)",
  );
  assert.strictEqual(reread, workflow, 'the block is unchanged');
  assert.ok(!second.written.includes('.github/workflows/build.yml'), 'idempotent: identical block is not a write');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('setup step: publishes the collected keys to the origin repo, values on stdin', () => {
  const dir = tmpTarget('GH_TOKEN=ghp_abc\nOPENAI_API_KEY=sk-1\nMY_CUSTOM_THING=custom\n');
  declareRepo(dir, 'acme/site');
  const gh = [];

  const result = publishEnvSecrets({
    targetDir: dir,
    logger: quiet,
    env: {},
    gitExecFn: () => 'git@github.com:acme/site.git\n',
    execFn: (file, args, options) => { gh.push({ file, args, input: options.input }); return ''; },
  });

  assert.deepStrictEqual(result.published, ['GH_TOKEN', 'OPENAI_API_KEY']);
  assert.deepStrictEqual(gh.map((c) => c.args.join(' ')), [
    'auth status',
    'secret set GH_TOKEN --repo acme/site',
    'secret set OPENAI_API_KEY --repo acme/site',
  ]);
  assert.deepStrictEqual(gh.slice(1).map((c) => c.input), ['ghp_abc', 'sk-1']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('setup step: no remote, no .env, and CI each skip LOUDLY without touching gh', () => {
  const noGh = () => { throw new Error('gh must not run'); };

  const remoteless = tmpTarget('GH_TOKEN=ghp\n');
  // The brand DECLARES its repo: that guard runs first, so a target without one
  // never reaches the remote probe this case is about.
  declareRepo(remoteless, 'acme/site');
  const warnings = [];
  const loud = { log: (m) => warnings.push(m), warn: (m) => warnings.push(m), error: (m) => warnings.push(m) };

  assert.deepStrictEqual(
    publishEnvSecrets({
      targetDir: remoteless,
      logger: loud,
      env: {},
      execFn: noGh,
      gitExecFn: gitStub(() => { throw new Error('fatal: no such remote'); }),
    }),
    { skipped: 'no-remote' },
  );
  assert.match(warnings.join('\n'), /no GitHub remote/);
  fs.rmSync(remoteless, { recursive: true, force: true });

  // A cascade that holds nothing the schema delivers to web is nothing to push.
  const empty = tmpTarget('# nothing but comments\nMY_CUSTOM_THING=custom\nGH_TOKEN=\n');
  warnings.length = 0;
  assert.deepStrictEqual(
    publishEnvSecrets({ targetDir: empty, logger: loud, env: {}, execFn: noGh, gitExecFn: noGh }),
    { skipped: 'no-secrets' },
  );
  assert.match(warnings.join('\n'), /no keys composed for this target/);

  warnings.length = 0;
  assert.deepStrictEqual(
    publishEnvSecrets({ targetDir: empty, logger: loud, env: { CI: 'true' }, execFn: noGh, gitExecFn: noGh }),
    { skipped: 'ci' },
  );
  assert.match(warnings.join('\n'), /CI already has the repo secrets/);
  fs.rmSync(empty, { recursive: true, force: true });
});

test('setup step: no declared brand repo skips loudly — an inferred remote is never trusted', () => {
  const dir = tmpTarget('GH_TOKEN=ghp\n');
  const messages = [];
  const loud = { log: (m) => messages.push(m), warn: (m) => messages.push(m), error: (m) => messages.push(m) };

  // No config/omega.json5 at all: the enclosing checkout's remote (here the
  // framework monorepo) must NOT become the publish target.
  assert.deepStrictEqual(
    publishEnvSecrets({
      targetDir: dir,
      logger: loud,
      env: {},
      gitExecFn: () => 'git@github.com:Omega-JS-Stack/omega.git\n',
      execFn: () => { throw new Error('gh must not run'); },
    }),
    { skipped: 'no-declared-repo' },
  );
  assert.match(messages.join('\n'), /names no GitHub repo/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('setup step: a remote that is not the brand\'s own repo skips loudly (never arms a stranger\'s Actions)', () => {
  const dir = tmpTarget('GH_TOKEN=ghp\n');
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'omega.json5'), [
    '{',
    "  brand: { id: 'my-brand', name: 'My Brand', url: 'https://my.brand' },",
    "  repo: { providers: { github: { org: 'acme' } } },",
    '  targets: { web: {} },',
    '}',
  ].join('\n'));

  const messages = [];
  const loud = { log: (m) => messages.push(m), warn: (m) => messages.push(m), error: (m) => messages.push(m) };

  // Remote = the enclosing (framework/test) monorepo, config = the brand repo.
  assert.deepStrictEqual(
    publishEnvSecrets({
      targetDir: dir,
      logger: loud,
      env: {},
      gitExecFn: gitStub('git@github.com:Omega-JS-Stack/omega.git\n'),
      execFn: () => { throw new Error('gh must not run'); },
    }),
    { skipped: 'repo-mismatch' },
  );
  assert.match(messages.join('\n'), /remote here is Omega-JS-Stack\/omega, but this brand's repo is acme\/my-brand-omega/);

  // Same brand, checked out as its own repo → publishes.
  const published = publishEnvSecrets({
    targetDir: dir,
    logger: quiet,
    env: {},
    gitExecFn: gitStub('git@github.com:acme/my-brand-omega.git\n'),
    execFn: () => '',
  });
  assert.deepStrictEqual(published.published, ['GH_TOKEN']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('setup step: a missing/signed-out gh throws instructions — never a silent skip', () => {
  const dir = tmpTarget('GH_TOKEN=ghp\n');
  declareRepo(dir, 'acme/site');

  assert.throws(
    () => publishEnvSecrets({
      targetDir: dir,
      logger: quiet,
      env: {},
      gitExecFn: () => 'https://github.com/acme/site.git',
      execFn: () => { throw new Error('spawnSync gh ENOENT'); },
    }),
    /GitHub CLI is required[\s\S]*gh auth login[\s\S]*--no-secrets/,
  );

  fs.rmSync(dir, { recursive: true, force: true });
});
