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

  return { brand, targetDir };
}

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
      gitExecFn: () => 'git@github.com:acme/site.git\n',
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
        gitExecFn: () => 'git@github.com:acme/site.git\n',
      }),
      { skipped: 'no-declared-repo' },
    );

    // 5. The enclosing checkout is a stranger's — never arm its Actions with
    // this brand's credentials.
    assert.deepStrictEqual(
      publishTargetSecrets({
        targetDir: keyed.targetDir, target: 'web', logger: loud, env: {}, execFn: noExec,
        gitExecFn: () => 'git@github.com:Omega-JS-Stack/omega.git\n',
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
