/**
 * The shared `.env` → Actions secrets publisher (#627 review) — web's and the
 * extension's ONE copy of derive → collect → guard → publish.
 *
 * Offline by construction: the brand and target are temp dirs, and the `gh`/
 * `git` boundaries are injected in every test — the suite never touches a real
 * repo. What it pins is the orchestration each framework binds: the SCHEMA
 * decides the key set, the COMPOSED env supplies the values, the brand's
 * DECLARED repo gates the send, and every skip is loud.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { collectTargetSecrets, declaredBrandRepo, publishTargetSecrets } = require('../src/target-secrets.js');

const quiet = { log() {}, warn() {}, error() {} };
const noExec = () => { throw new Error('the boundary must not run'); };

/**
 * A brand root with one target under targets/<target>, the brand .env holding
 * `brandEnv`, and the brand's own repo declared when `repo` is given.
 */
function tmpBrand({ target, brandEnv, repo }) {
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-target-secrets-'));
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), [
    '{',
    "  brand: { id: 'my-brand', name: 'My Brand', url: 'https://my.brand' },",
    ...(repo ? [`  repo: { providers: { github: { repo: '${repo}' } } },`] : []),
    `  targets: { ${target}: {} },`,
    '}',
  ].join('\n'));
  if (brandEnv !== undefined) fs.writeFileSync(path.join(brand, '.env'), brandEnv);

  const targetDir = path.join(brand, 'targets', target);
  fs.mkdirSync(targetDir, { recursive: true });
  // The manifests a brand really has: what makes the walk find this root as the
  // brand root, which is what the lane reasons from (#872).
  fs.writeFileSync(path.join(brand, 'package.json'), JSON.stringify({ name: 'my-brand', private: true, workspaces: ['targets/*'] }));
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({ name: `my-brand-${target}`, private: true }));

  return { brand, targetDir };
}

/**
 * The `git` boundary, answering PER COMMAND. A single-answer stub hands the
 * `rev-parse --show-toplevel` probe a remote URL, which reads as a NESTED brand
 * and skips the very guard a test means to exercise (#872).
 * @param {string} brandRoot - What `--show-toplevel` answers (the repo's root).
 * @param {string} remote - What `git config --get remote.origin.url` answers.
 * @returns {Function} The stub to inject as `gitExecFn`.
 */
function gitStub(brandRoot, remote) {
  return (command) => (command.includes('--show-toplevel') ? `${brandRoot}\n` : `${remote}\n`);
}

// #586 — the `.env.<environment>` overlay reaches this lane too. What a runner
// builds is a RELEASE, so the publish composes PRODUCTION: a developer machine's
// `.env.development` values must never become the repo's Actions secrets, and
// the composed set must not depend on which shell ran the publish.
test('collect: the publish composes PRODUCTION, never this shell\'s environment', () => {
  const { brand, targetDir } = tmpBrand({
    target: 'extension',
    brandEnv: 'CHROME_CLIENT_ID=live-id\n',
  });
  const saved = { ENVIRONMENT: process.env.ENVIRONMENT, OMEGA_TEST_MODE: process.env.OMEGA_TEST_MODE };

  fs.writeFileSync(path.join(brand, '.env.development'), 'CHROME_CLIENT_ID=dev-id\n');
  fs.writeFileSync(path.join(brand, '.env.production'), 'CHROME_CLIENT_ID=prod-id\n');

  try {
    for (const environment of ['development', 'testing', 'production']) {
      delete process.env.OMEGA_TEST_MODE;
      process.env.ENVIRONMENT = environment;

      assert.deepStrictEqual(collectTargetSecrets({ targetDir, target: 'extension' }), {
        CHROME_CLIENT_ID: 'prod-id',
      }, `a publish run under ${environment} still publishes the production value`);
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(brand, { recursive: true, force: true });
  }
});

test('collect: the SCHEMA names the keys, the composed env supplies the values', () => {
  const { brand, targetDir } = tmpBrand({
    target: 'extension',
    brandEnv: 'CHROME_CLIENT_ID=chrome-id\nGOOGLE_ANALYTICS_SECRET_EXTENSION=mp-secret\nMY_CUSTOM_THING=custom\n',
  });

  try {
    // The brand-level GOOGLE_ANALYTICS_SECRET_EXTENSION arrives under its
    // DELIVERED name; the undeclared key is nobody's secret.
    assert.deepStrictEqual(collectTargetSecrets({ targetDir, target: 'extension' }), {
      CHROME_CLIENT_ID: 'chrome-id',
      GOOGLE_ANALYTICS_SECRET: 'mp-secret',
    });

    // The same cascade read for a different target answers THAT target's set —
    // the target string is the only thing a framework binds, and none of these
    // keys is web's.
    assert.deepStrictEqual(collectTargetSecrets({ targetDir, target: 'web' }), {});
  } finally {
    fs.rmSync(brand, { recursive: true, force: true });
  }
});

test('declaredBrandRepo: the brand\'s own config, never an inferred remote', () => {
  const declared = tmpBrand({ target: 'web', repo: 'acme/site' });
  const silent = tmpBrand({ target: 'web' });

  try {
    assert.strictEqual(declaredBrandRepo({ targetDir: declared.targetDir, target: 'web' }), 'acme/site');
    // No repo declared and no brand.id-shaped owner — nothing to trust.
    assert.strictEqual(declaredBrandRepo({ targetDir: silent.targetDir, target: 'web' }), null);
    // An unloadable dir is a null, never a throw: the caller skips loudly.
    assert.strictEqual(declaredBrandRepo({ targetDir: os.tmpdir(), target: 'web' }), null);
  } finally {
    fs.rmSync(declared.brand, { recursive: true, force: true });
    fs.rmSync(silent.brand, { recursive: true, force: true });
  }
});

test('publish: the collected keys go to the declared repo, values on stdin', () => {
  const { brand, targetDir } = tmpBrand({
    target: 'web',
    brandEnv: 'OPENAI_API_KEY=sk-fixture\nGOOGLE_ANALYTICS_SECRET_WEB=mp-secret\n',
    repo: 'acme/site',
  });
  const gh = [];

  try {
    const result = publishTargetSecrets({
      targetDir,
      target: 'web',
      logger: quiet,
      env: {},
      gitExecFn: gitStub(brand, 'git@github.com:acme/site.git'),
      execFn: (file, args, options) => { gh.push({ file, args, input: options.input }); return ''; },
    });

    assert.deepStrictEqual(result.published, ['GOOGLE_ANALYTICS_SECRET', 'OPENAI_API_KEY']);
    assert.deepStrictEqual(gh.map((call) => call.args.join(' ')), [
      'auth status',
      'secret set GOOGLE_ANALYTICS_SECRET --repo acme/site',
      'secret set OPENAI_API_KEY --repo acme/site',
    ]);
    // Values travel on stdin, never in argv.
    assert.deepStrictEqual(gh.slice(1).map((call) => call.input), ['mp-secret', 'sk-fixture']);
    assert.ok(gh.every((call) => !call.args.join(' ').includes('sk-fixture')));
  } finally {
    fs.rmSync(brand, { recursive: true, force: true });
  }
});

// #682 — desktop's signing secrets are named by PATH in the cascade
// (CSC_LINK=config/certs/dev-id.p12) and CI needs the FILE, so the one shape
// difference between the three binds is a resolver applied before the send.
test('publish: a resolveValue seam transforms each value, and a falsy return drops the key', () => {
  const { brand, targetDir } = tmpBrand({
    target: 'web',
    brandEnv: 'OPENAI_API_KEY=sk-fixture\nGOOGLE_ANALYTICS_SECRET_WEB=mp-secret\n',
    repo: 'acme/site',
  });
  const gh = [];

  try {
    // The seam sees the composed value and its DELIVERED key.
    assert.deepStrictEqual(
      collectTargetSecrets({ targetDir, target: 'web', resolveValue: (value, key) => `${key}:${value}` }),
      { GOOGLE_ANALYTICS_SECRET: 'GOOGLE_ANALYTICS_SECRET:mp-secret', OPENAI_API_KEY: 'OPENAI_API_KEY:sk-fixture' },
    );

    const result = publishTargetSecrets({
      targetDir,
      target: 'web',
      logger: quiet,
      env: {},
      resolveValue: (value, key) => (key === 'OPENAI_API_KEY' ? Buffer.from(value).toString('base64') : null),
      gitExecFn: gitStub(brand, 'git@github.com:acme/site.git'),
      execFn: (file, args, options) => { gh.push({ args, input: options.input }); return ''; },
    });

    // The dropped key never reaches gh; the kept one travels transformed.
    assert.deepStrictEqual(result.published, ['OPENAI_API_KEY']);
    assert.deepStrictEqual(gh.map((call) => call.args.join(' ')), [
      'auth status',
      'secret set OPENAI_API_KEY --repo acme/site',
    ]);
    assert.deepStrictEqual(gh.slice(1).map((call) => call.input), [Buffer.from('sk-fixture').toString('base64')]);
  } finally {
    fs.rmSync(brand, { recursive: true, force: true });
  }
});

test('publish: the five skips are loud, and none of them touches gh', () => {
  const said = [];
  const loud = { log: (m) => said.push(m), warn: (m) => said.push(m), error: (m) => said.push(m) };

  const empty = tmpBrand({ target: 'web', brandEnv: 'MY_CUSTOM_THING=custom\n', repo: 'acme/site' });
  const keyed = tmpBrand({ target: 'web', brandEnv: 'OPENAI_API_KEY=sk-fixture\n', repo: 'acme/site' });
  const undeclared = tmpBrand({ target: 'web', brandEnv: 'OPENAI_API_KEY=sk-fixture\n' });

  try {
    // 1. CI already has the repo secrets, and the runner token can't write them.
    assert.deepStrictEqual(
      publishTargetSecrets({ targetDir: keyed.targetDir, target: 'web', logger: loud, env: { CI: 'true' }, execFn: noExec, gitExecFn: noExec }),
      { skipped: 'ci' },
    );

    // 2. Nothing composed for this target.
    assert.deepStrictEqual(
      publishTargetSecrets({ targetDir: empty.targetDir, target: 'web', logger: loud, env: {}, execFn: noExec, gitExecFn: noExec }),
      { skipped: 'no-secrets' },
    );

    // 3. No GitHub remote to publish to.
    assert.deepStrictEqual(
      publishTargetSecrets({
        targetDir: keyed.targetDir, target: 'web', logger: loud, env: {}, execFn: noExec,
        gitExecFn: () => { throw new Error('fatal: no such remote'); },
      }),
      { skipped: 'no-remote' },
    );

    // 4. The brand names no repo — an inferred remote is never proof.
    assert.deepStrictEqual(
      publishTargetSecrets({
        targetDir: undeclared.targetDir, target: 'web', logger: loud, env: {}, execFn: noExec,
        gitExecFn: gitStub(undeclared.brand, 'git@github.com:acme/site.git'),
      }),
      { skipped: 'no-declared-repo' },
    );

    // 5. The enclosing checkout is a stranger's — never arm its Actions with
    // this brand's credentials. The brand root IS that checkout's toplevel, so
    // this is a brand that could have been its own and is not (#872).
    assert.deepStrictEqual(
      publishTargetSecrets({
        targetDir: keyed.targetDir, target: 'web', logger: loud, env: {}, execFn: noExec,
        gitExecFn: gitStub(keyed.brand, 'git@github.com:Omega-JS-Stack/omega.git'),
      }),
      { skipped: 'repo-mismatch' },
    );

    const heard = said.join('\n');
    assert.match(heard, /CI already has the repo secrets/);
    assert.match(heard, /no keys composed for this target/);
    assert.match(heard, /no GitHub remote/);
    assert.match(heard, /names no GitHub repo in config/);
    assert.match(heard, /this brand's repo is acme\/site/);
  } finally {
    for (const { brand } of [empty, keyed, undeclared]) fs.rmSync(brand, { recursive: true, force: true });
  }
});

// #872: a NESTED brand (a brand that is a folder of a bigger repo, the way
// this monorepo's playground is) has a remote that answers the ENCLOSING repo
// by construction, and its deploy snapshots the folder to the DECLARED repo.
// The mismatch guard would skip every one of those publishes, so it does not
// run there; the run's secrets have to be on the repo the workflow runs from.
test('publish: a NESTED brand publishes to its DECLARED repo, remote mismatch and all', () => {
  const { brand, targetDir } = tmpBrand({
    target: 'web',
    brandEnv: 'OPENAI_API_KEY=sk-fixture\n',
    repo: 'Omega-JS-Stack/playground-omega',
  });
  const gh = [];

  try {
    const result = publishTargetSecrets({
      targetDir,
      target: 'web',
      logger: quiet,
      env: {},
      // The brand folder sits inside a bigger checkout, whose remote is the
      // monorepo's: exactly the shape the guard used to read as a stranger's.
      gitExecFn: gitStub(path.dirname(brand), 'git@github.com:Omega-JS-Stack/omega.git'),
      execFn: (file, args, options) => { gh.push({ args, input: options.input }); return ''; },
    });

    assert.deepStrictEqual(result.published, ['OPENAI_API_KEY']);
    assert.deepStrictEqual(gh.map((call) => call.args.join(' ')), [
      'auth status',
      'secret set OPENAI_API_KEY --repo Omega-JS-Stack/playground-omega',
    ]);
  } finally {
    fs.rmSync(brand, { recursive: true, force: true });
  }
});

// #872: a key with no `.env` home rides the publish too, since backend's deploy
// credential is a FILE the firebase service mints (never an env value), and the
// runner needs it as a repo secret like everything else. The seam is separate
// from `resolveValue` on purpose: an extra arrives already valued.
test('publish: extraSecrets ride the publish, over the composed values and past the resolveValue seam', () => {
  const { brand, targetDir } = tmpBrand({
    target: 'web',
    brandEnv: 'OPENAI_API_KEY=sk-fixture\nGOOGLE_ANALYTICS_SECRET_WEB=mp-secret\n',
    repo: 'acme/site',
  });
  const gh = [];

  try {
    const result = publishTargetSecrets({
      targetDir,
      target: 'web',
      logger: quiet,
      env: {},
      extraSecrets: {
        // No schema key, no composed value: it exists only here
        OMEGA_SERVICE_ACCOUNT_JSON: '{"type":"service_account"}',
        // A composed key an extra OVERRIDES, and one an empty extra never claims
        OPENAI_API_KEY: 'sk-from-the-caller',
        GOOGLE_ANALYTICS_SECRET: '',
      },
      // The value seam is the COMPOSED half's: an extra is published verbatim
      resolveValue: (value) => `resolved:${value}`,
      gitExecFn: gitStub(brand, 'git@github.com:acme/site.git'),
      execFn: (file, args, options) => { gh.push({ args, input: options.input }); return ''; },
    });

    assert.deepStrictEqual(result.published, ['GOOGLE_ANALYTICS_SECRET', 'OPENAI_API_KEY', 'OMEGA_SERVICE_ACCOUNT_JSON']);
    assert.deepStrictEqual(gh.slice(1).map((call) => call.args.join(' ')), [
      'secret set GOOGLE_ANALYTICS_SECRET --repo acme/site',
      'secret set OPENAI_API_KEY --repo acme/site',
      'secret set OMEGA_SERVICE_ACCOUNT_JSON --repo acme/site',
    ]);
    assert.deepStrictEqual(gh.slice(1).map((call) => call.input), [
      'resolved:mp-secret',
      'sk-from-the-caller',
      '{"type":"service_account"}',
    ]);
  } finally {
    fs.rmSync(brand, { recursive: true, force: true });
  }
});

test('publish: an extra secret ALONE is a publish, never the empty-set skip', () => {
  const { brand, targetDir } = tmpBrand({ target: 'web', brandEnv: 'MY_CUSTOM_THING=custom\n', repo: 'acme/site' });
  const gh = [];

  try {
    const result = publishTargetSecrets({
      targetDir,
      target: 'web',
      logger: quiet,
      env: {},
      extraSecrets: { OMEGA_SERVICE_ACCOUNT_JSON: '{"type":"service_account"}' },
      gitExecFn: gitStub(brand, 'git@github.com:acme/site.git'),
      execFn: (file, args, options) => { gh.push({ args, input: options.input }); return ''; },
    });

    assert.deepStrictEqual(result.published, ['OMEGA_SERVICE_ACCOUNT_JSON']);
    assert.deepStrictEqual(gh.map((call) => call.args.join(' ')), [
      'auth status',
      'secret set OMEGA_SERVICE_ACCOUNT_JSON --repo acme/site',
    ]);
  } finally {
    fs.rmSync(brand, { recursive: true, force: true });
  }
});
