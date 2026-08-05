/**
 * `.env` → Actions secrets (#189): the collection filter (mirrored from UJM's
 * `publishSecrets()`), the cascade precedence that supplies values, the
 * generated workflow env block, and the setup step's loud skips.
 *
 * The `gh`/`git` boundaries are injected in every test — the suite never
 * touches a real repo.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  collectEnvSecrets,
  parseEnvFile,
  renderSecretsBlock,
  publishEnvSecrets,
  EMPTY_BLOCK,
} = require('../src/github-secrets.js');
const { scaffoldDefaults } = require('../src/scaffold.js');

const quiet = { log() {}, warn() {}, error() {} };

/** A temp app dir, optionally with an app-level .env. */
function tmpApp(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-secrets-'));
  if (env !== undefined) fs.writeFileSync(path.join(dir, '.env'), env);
  return dir;
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

test('filter: UPPER_SNAKE keys with non-empty values only, quotes stripped (UJM setup.js:419-428)', () => {
  const parsed = parseEnvFile([
    '# ========== Default Values ==========',
    '# GH_TOKEN=',
    '',
    'GH_TOKEN=ghp_abc',
    'OPENAI_API_KEY="sk-quoted"',
    "SINGLE='sq'",
    'EMPTY=',
    'ALSO_EMPTY=""',
    'lowercase=nope',
    'Mixed_Case=nope',
    '1BAD=nope',
    'NO_EQUALS_SIGN',
    'WITH_NUMBERS_2=ok',
  ].join('\n'));

  assert.deepStrictEqual(parsed, {
    GH_TOKEN: 'ghp_abc',
    OPENAI_API_KEY: 'sk-quoted',
    SINGLE: 'sq',
    WITH_NUMBERS_2: 'ok',
  });
});

test('collect: the app .env is the key set; empty values never claim a key', () => {
  const dir = tmpApp('A=1\nB=\n# C=3\nD=4\n');
  assert.deepStrictEqual(collectEnvSecrets({ appDir: dir, env: {} }), { A: '1', D: '4' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('collect: the shell overrides a file value, but a shell-only key is never published', () => {
  const dir = tmpApp('GH_TOKEN=from-file\nOPENAI_API_KEY=from-file\n');
  const secrets = collectEnvSecrets({
    appDir: dir,
    env: { GH_TOKEN: 'from-shell', AWS_SECRET_ACCESS_KEY: 'not-ours', OPENAI_API_KEY: '   ' },
  });

  assert.deepStrictEqual(secrets, { GH_TOKEN: 'from-shell', OPENAI_API_KEY: 'from-file' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('collect: the brand .env layers under the app .env (cascade precedence)', () => {
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-brand-'));
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), '{ brand: { id: "b" } }');
  fs.writeFileSync(path.join(brand, '.env'), 'GH_TOKEN=brand-token\nBRAND_ONLY=brand-value\n');

  const app = path.join(brand, 'apps', 'website');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, '.env'), 'GH_TOKEN=app-token\nAPP_ONLY=app-value\n');

  assert.deepStrictEqual(collectEnvSecrets({ appDir: app, env: {} }), {
    GH_TOKEN: 'app-token',
    BRAND_ONLY: 'brand-value',
    APP_ONLY: 'app-value',
  });

  fs.rmSync(brand, { recursive: true, force: true });
});

test('block: one `KEY: ${{ secrets.KEY }}` line per key, sorted, template-owned keys dropped', () => {
  assert.strictEqual(
    renderSecretsBlock(['B_KEY', 'A_KEY']),
    'A_KEY: ${{ secrets.A_KEY }}\n  B_KEY: ${{ secrets.B_KEY }}',
  );

  // GH_TOKEN/NODE_* are already in the workflow's env: block — a second
  // mapping key there would be invalid YAML.
  assert.strictEqual(
    renderSecretsBlock(['GH_TOKEN', 'NODE_ENV', 'NODE_VERSION', 'X_KEY', 'X_KEY']),
    'X_KEY: ${{ secrets.X_KEY }}',
  );

  assert.strictEqual(renderSecretsBlock([]), EMPTY_BLOCK);
  assert.strictEqual(renderSecretsBlock(['GH_TOKEN']), EMPTY_BLOCK);
});

test('workflow: the scaffolded block is exactly the .env keys, and regenerates in place', () => {
  const dir = tmpApp('CLOUDFLARE_TOKEN=cf\nOPENAI_API_KEY=sk\nGH_TOKEN=ghp\n');
  const workflowPath = path.join(dir, '.github', 'workflows', 'build.yml');

  scaffoldDefaults({ outputDir: dir, logger: quiet });
  let workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.ok(workflow.includes('\n  CLOUDFLARE_TOKEN: ${{ secrets.CLOUDFLARE_TOKEN }}'), 'CLOUDFLARE_TOKEN injected');
  assert.ok(workflow.includes('\n  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}'), 'OPENAI_API_KEY injected');
  assert.ok(!workflow.includes('{{ githubSecrets }}'), 'the token is consumed');
  assert.strictEqual(
    (workflow.match(/^ {2}GH_TOKEN:/gm) || []).length,
    1,
    'GH_TOKEN stays a single env key (the template already declares it)',
  );

  // Re-run with a CHANGED .env: the block regenerates rather than accreting.
  fs.writeFileSync(path.join(dir, '.env'), 'STRIPE_KEY=sk_live\n');
  const second = scaffoldDefaults({ outputDir: dir, logger: quiet });
  workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.ok(workflow.includes('\n  STRIPE_KEY: ${{ secrets.STRIPE_KEY }}'), 'the new key is in');
  assert.ok(!workflow.includes('OPENAI_API_KEY: ${{'), 'the dropped key is gone — regenerated, not appended');
  assert.ok(second.written.includes('.github/workflows/build.yml'), 'the workflow rewrote');

  // Same .env twice → byte-identical render, so the engine reports no write.
  const third = scaffoldDefaults({ outputDir: dir, logger: quiet });
  assert.ok(!third.written.includes('.github/workflows/build.yml'), 'idempotent: identical block is not a write');
  assert.strictEqual(fs.readFileSync(workflowPath, 'utf8'), workflow);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('setup step: publishes the collected keys to the origin repo, values on stdin', () => {
  const dir = tmpApp('GH_TOKEN=ghp_abc\nOPENAI_API_KEY=sk-1\n');
  declareRepo(dir, 'acme/site');
  const gh = [];

  const result = publishEnvSecrets({
    appDir: dir,
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

  const remoteless = tmpApp('A=1\n');
  const warnings = [];
  const loud = { log: (m) => warnings.push(m), warn: (m) => warnings.push(m), error: (m) => warnings.push(m) };

  assert.deepStrictEqual(
    publishEnvSecrets({
      appDir: remoteless,
      logger: loud,
      env: {},
      execFn: noGh,
      gitExecFn: () => { throw new Error('fatal: no such remote'); },
    }),
    { skipped: 'no-remote' },
  );
  assert.match(warnings.join('\n'), /no GitHub remote/);
  fs.rmSync(remoteless, { recursive: true, force: true });

  const empty = tmpApp('# nothing but comments\nEMPTY=\n');
  warnings.length = 0;
  assert.deepStrictEqual(
    publishEnvSecrets({ appDir: empty, logger: loud, env: {}, execFn: noGh, gitExecFn: noGh }),
    { skipped: 'no-secrets' },
  );
  assert.match(warnings.join('\n'), /no \.env values found/);

  warnings.length = 0;
  assert.deepStrictEqual(
    publishEnvSecrets({ appDir: empty, logger: loud, env: { CI: 'true' }, execFn: noGh, gitExecFn: noGh }),
    { skipped: 'ci' },
  );
  assert.match(warnings.join('\n'), /CI already has the repo secrets/);
  fs.rmSync(empty, { recursive: true, force: true });
});

test('setup step: no declared brand repo skips loudly — an inferred remote is never trusted', () => {
  const dir = tmpApp('A=1\n');
  const messages = [];
  const loud = { log: (m) => messages.push(m), warn: (m) => messages.push(m), error: (m) => messages.push(m) };

  // No config/omega.json5 at all: the enclosing checkout's remote (here the
  // framework monorepo) must NOT become the publish target.
  assert.deepStrictEqual(
    publishEnvSecrets({
      appDir: dir,
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
  const dir = tmpApp('A=1\n');
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
      appDir: dir,
      logger: loud,
      env: {},
      gitExecFn: () => 'git@github.com:Omega-JS-Stack/omega.git\n',
      execFn: () => { throw new Error('gh must not run'); },
    }),
    { skipped: 'repo-mismatch' },
  );
  assert.match(messages.join('\n'), /remote here is Omega-JS-Stack\/omega, but this brand's repo is acme\/my-brand/);

  // Same brand, checked out as its own repo → publishes.
  const published = publishEnvSecrets({
    appDir: dir,
    logger: quiet,
    env: {},
    gitExecFn: () => 'git@github.com:acme/my-brand.git\n',
    execFn: () => '',
  });
  assert.deepStrictEqual(published.published, ['A']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('setup step: a missing/signed-out gh throws instructions — never a silent skip', () => {
  const dir = tmpApp('A=1\n');
  declareRepo(dir, 'acme/site');

  assert.throws(
    () => publishEnvSecrets({
      appDir: dir,
      logger: quiet,
      env: {},
      gitExecFn: () => 'https://github.com/acme/site.git',
      execFn: () => { throw new Error('spawnSync gh ENOENT'); },
    }),
    /GitHub CLI is required[\s\S]*gh auth login[\s\S]*--no-secrets/,
  );

  fs.rmSync(dir, { recursive: true, force: true });
});
