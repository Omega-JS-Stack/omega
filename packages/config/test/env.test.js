/**
 * .env cascade tests for @omega.js/config — chain resolution (local/brand/
 * company via the .omega/company.json marker), precedence (shell > local >
 * brand > company), and loading tolerances (missing files, malformed
 * markers, vanished company roots).
 *
 * Fixtures are built under packages/config/.temp/ (gitignored), matching the
 * devkit test convention. Tests mutate process.env through dotenv, so every
 * test uses its own key prefix and clears its keys when done.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadEnv, reloadEnv, resolveEnvChain, loadEnvChain, loadEnvRoots, readCompanyRoot, composeTargetEnv, serializeEnv, ENV_ENVIRONMENTS, envEnvironment } = require('../src/index.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

// Build a fixture tree ({ 'relative/path': contents }) and return its root.
function makeFixture(name, files) {
  const root = path.join(TEMP_ROOT, `${name}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

function cleanup(t, root, envKeys = []) {
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    envKeys.forEach((key) => delete process.env[key]);
  });
}

// ─── Full cascade ───

test('local in a company-stamped brand: shell > local .env > brand .env > company .env', (t) => {
  const root = makeFixture('env-full', {
    'company/.env': 'ENVT1_B=company\nENVT1_C=company\nENVT1_S=company\n',
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'ENVT1_A=brand\nENVT1_B=brand\nENVT1_S=brand\n',
    'brand/targets/site/.env': 'ENVT1_A=local\nENVT1_S=local\n',
  });
  cleanup(t, root, ['ENVT1_A', 'ENVT1_B', 'ENVT1_C', 'ENVT1_S']);

  const brandRoot = path.join(root, 'brand');
  const companyRoot = path.join(root, 'company');
  fs.mkdirSync(path.join(brandRoot, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, '.omega', 'company.json'), JSON.stringify({ root: companyRoot }));

  process.env.ENVT1_S = 'shell';

  const { chain, loaded } = loadEnv(path.join(brandRoot, 'targets', 'site'));

  assert.deepStrictEqual(chain, {
    local: path.join(brandRoot, 'targets', 'site', '.env'),
    brand: path.join(brandRoot, '.env'),
    company: path.join(companyRoot, '.env'),
  });
  assert.deepStrictEqual(loaded, [chain.local, chain.brand, chain.company]);

  assert.strictEqual(process.env.ENVT1_A, 'local');      // local beats brand
  assert.strictEqual(process.env.ENVT1_B, 'brand');    // brand beats company
  assert.strictEqual(process.env.ENVT1_C, 'company');  // company fills the gaps
  assert.strictEqual(process.env.ENVT1_S, 'shell');    // shell beats every file
});

test('backend functions dir: functions/.env is the local layer, brand discovered through the functions/ normalization', (t) => {
  const root = makeFixture('env-functions', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'ENVT2_X=brand\nENVT2_Y=brand\n',
    'brand/targets/backend/functions/.env': 'ENVT2_X=functions\n',
  });
  cleanup(t, root, ['ENVT2_X', 'ENVT2_Y']);

  const functionsDir = path.join(root, 'brand', 'targets', 'backend', 'functions');
  const { chain, loaded } = loadEnv(functionsDir);

  assert.strictEqual(chain.local, path.join(functionsDir, '.env'));
  assert.strictEqual(chain.brand, path.join(root, 'brand', '.env'));
  assert.strictEqual(chain.company, null);
  assert.strictEqual(loaded.length, 2);

  assert.strictEqual(process.env.ENVT2_X, 'functions');
  assert.strictEqual(process.env.ENVT2_Y, 'brand');
});

test('backend dist dir: dist/.env is the local layer, brand discovered through the dist/ normalization', (t) => {
  // `omega test` resolves the cascade from the staged dist/ (the runner's
  // functions dir for the run). Without the dist/ normalization the walk
  // looked for targets/ one level too low, so the brand layer came back null and
  // the run died on a missing secret that was sitting at the brand root —
  // exactly where the D15 cascade says to keep it
  // ([#257](https://github.com/Omega-JS-Stack/omega/issues/257)).
  const root = makeFixture('env-dist', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'ENVT2D_X=brand\nENVT2D_Y=brand\n',
    'brand/targets/backend/dist/.env': 'ENVT2D_X=dist\n',
  });
  cleanup(t, root, ['ENVT2D_X', 'ENVT2D_Y']);

  const distDir = path.join(root, 'brand', 'targets', 'backend', 'dist');
  const { chain, loaded } = loadEnv(distDir);

  assert.strictEqual(chain.local, path.join(distDir, '.env'));
  assert.strictEqual(chain.brand, path.join(root, 'brand', '.env'));
  assert.strictEqual(chain.company, null);
  assert.strictEqual(loaded.length, 2);

  assert.strictEqual(process.env.ENVT2D_X, 'dist');
  assert.strictEqual(process.env.ENVT2D_Y, 'brand');
});

// ─── Partial chains ───

test('standalone project: local .env only; a project with no .env at all loads nothing and never throws', (t) => {
  const root = makeFixture('env-standalone', {
    'proj/.env': 'ENVT3_X=local\n',
    'bare/README.md': 'no env here',
  });
  cleanup(t, root, ['ENVT3_X']);

  const withEnv = loadEnv(path.join(root, 'proj'));
  assert.strictEqual(withEnv.chain.brand, null);
  assert.strictEqual(withEnv.chain.company, null);
  assert.deepStrictEqual(withEnv.loaded, [path.join(root, 'proj', '.env')]);
  assert.strictEqual(process.env.ENVT3_X, 'local');

  const bare = loadEnv(path.join(root, 'bare'));
  assert.deepStrictEqual(bare.loaded, []);
});

test('brand root as startDir (the manager shape): its own .env is the local layer, its marker supplies the company layer', (t) => {
  const root = makeFixture('env-brand-root', {
    'company/.env': 'ENVT4_B=company\nENVT4_C=company\n',
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'ENVT4_B=brand\n',
  });
  cleanup(t, root, ['ENVT4_B', 'ENVT4_C']);

  const brandRoot = path.join(root, 'brand');
  fs.mkdirSync(path.join(brandRoot, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, '.omega', 'company.json'), JSON.stringify({ root: path.join(root, 'company') }));

  const { chain } = loadEnv(brandRoot);

  assert.strictEqual(chain.local, path.join(brandRoot, '.env'));
  assert.strictEqual(chain.brand, null);
  assert.strictEqual(chain.company, path.join(root, 'company', '.env'));

  assert.strictEqual(process.env.ENVT4_B, 'brand');
  assert.strictEqual(process.env.ENVT4_C, 'company');
});

// ─── Marker tolerances ───

test('marker pointing at a vanished company root: the chain names it, loading skips it silently', (t) => {
  const root = makeFixture('env-vanished', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/targets/site/.env': 'ENVT5_X=local\n',
  });
  cleanup(t, root, ['ENVT5_X']);

  const brandRoot = path.join(root, 'brand');
  const gone = path.join(root, 'company-gone');
  fs.mkdirSync(path.join(brandRoot, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, '.omega', 'company.json'), JSON.stringify({ root: gone }));

  const { chain, loaded } = loadEnv(path.join(brandRoot, 'targets', 'site'));

  assert.strictEqual(chain.company, path.join(gone, '.env'));
  assert.deepStrictEqual(loaded, [chain.local]);
  assert.strictEqual(process.env.ENVT5_X, 'local');
});

test('malformed or rootless markers read as unstamped', (t) => {
  const root = makeFixture('env-bad-marker', {
    'a/.omega/company.json': 'not json{{{',
    'b/.omega/company.json': JSON.stringify({ something: 'else' }),
    'c/.omega/company.json': JSON.stringify({ root: '' }),
  });
  cleanup(t, root);

  assert.strictEqual(readCompanyRoot(path.join(root, 'a')), null);
  assert.strictEqual(readCompanyRoot(path.join(root, 'b')), null);
  assert.strictEqual(readCompanyRoot(path.join(root, 'c')), null);
  assert.strictEqual(readCompanyRoot(path.join(root, 'missing')), null);
});

// ─── loadEnvChain directly ───

test('loadEnvChain: explicit paths load strongest-first, nulls and missing files skip, shell still wins', (t) => {
  const root = makeFixture('env-chain', {
    'one/.env': 'ENVT6_X=one\nENVT6_S=one\n',
    'two/.env': 'ENVT6_X=two\nENVT6_Y=two\n',
  });
  cleanup(t, root, ['ENVT6_X', 'ENVT6_Y', 'ENVT6_S']);

  process.env.ENVT6_S = 'shell';

  const loaded = loadEnvChain([
    path.join(root, 'one', '.env'),
    null,
    path.join(root, 'missing', '.env'),
    path.join(root, 'two', '.env'),
  ]);

  assert.deepStrictEqual(loaded, [path.join(root, 'one', '.env'), path.join(root, 'two', '.env')]);
  assert.strictEqual(process.env.ENVT6_X, 'one');   // first file wins
  assert.strictEqual(process.env.ENVT6_Y, 'two');   // later files fill gaps
  assert.strictEqual(process.env.ENVT6_S, 'shell'); // shell beats all files
});

// ─── loadEnvRoots: the known-layers loader (the manager's walks) ───

test('loadEnvRoots: each root contributes .env + its named overlay, strongest root first', (t) => {
  const root = makeFixture('env-roots', {
    'brand/.env': 'ENVT16_X=brand\nENVT16_Y=brand\n',
    'brand/.env.production': 'ENVT16_X=brand-production\n',
    'brand/.env.development': 'ENVT16_X=brand-development\n',
    'company/.env': 'ENVT16_X=company\nENVT16_Y=company\nENVT16_Z=company\n',
    'company/.env.production': 'ENVT16_Z=company-production\n',
  });
  cleanup(t, root, ['ENVT16_X', 'ENVT16_Y', 'ENVT16_Z']);

  const loaded = loadEnvRoots(
    [path.join(root, 'brand'), null, path.join(root, 'company')],
    { environment: 'production' },
  );

  assert.deepStrictEqual(loaded, [
    path.join(root, 'brand', '.env.production'),
    path.join(root, 'brand', '.env'),
    path.join(root, 'company', '.env.production'),
    path.join(root, 'company', '.env'),
  ]);
  assert.strictEqual(process.env.ENVT16_X, 'brand-production'); // the strongest root's overlay
  assert.strictEqual(process.env.ENVT16_Y, 'brand');            // its base still beats the company layer
  assert.strictEqual(process.env.ENVT16_Z, 'company-production'); // a gap the company overlay fills
});

// ─── resolveEnvChain is read-only ───

test('resolveEnvChain resolves paths without touching process.env', (t) => {
  const root = makeFixture('env-resolve-only', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'ENVT7_X=brand\n',
    'brand/targets/site/.env': 'ENVT7_X=local\n',
  });
  cleanup(t, root, ['ENVT7_X']);

  const chain = resolveEnvChain(path.join(root, 'brand', 'targets', 'site'));

  assert.strictEqual(chain.brand, path.join(root, 'brand', '.env'));
  assert.strictEqual(process.env.ENVT7_X, undefined);
});

// ─── Empty file-layer values never claim a key (dogfood friction #20) ───

test('empty local-layer values (KEY= / KEY="") never shadow the brand layer; shell empties still win', (t) => {
  const root = makeFixture('env-empty', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'ENVT9_A=brand-real\nENVT9_B=brand-real\nENVT9_S=brand-real\n',
    'brand/targets/site/.env': 'ENVT9_A=\nENVT9_B=""\nENVT9_S=""\nENVT9_ONLY=""\n',
  });
  cleanup(t, root, ['ENVT9_A', 'ENVT9_B', 'ENVT9_S', 'ENVT9_ONLY']);

  process.env.ENVT9_S = '';

  loadEnv(path.join(root, 'brand', 'targets', 'site'));

  assert.strictEqual(process.env.ENVT9_A, 'brand-real', 'unquoted-empty local line must not shadow the brand value');
  assert.strictEqual(process.env.ENVT9_B, 'brand-real', 'quoted-empty local line must not shadow the brand value');
  assert.strictEqual(process.env.ENVT9_S, '', 'a deliberately empty SHELL var still beats every file');
  assert.strictEqual(process.env.ENVT9_ONLY, undefined, 'empty in every layer = key stays unset');
});

// ─── composeTargetEnv: the dist/.env composition (#678) ───

test('composeTargetEnv: the schema filters the company + brand layers by target', (t) => {
  const root = makeFixture('env-compose-filter', {
    'company/.env': 'ANTHROPIC_API_KEY=company-anthropic\n',
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'GH_TOKEN=brand-gh\nRECAPTCHA_SITE_KEY=brand-site-key\nANTHROPIC_API_KEY=brand-anthropic\n',
  });
  cleanup(t, root);

  const brandRoot = path.join(root, 'brand');
  fs.mkdirSync(path.join(brandRoot, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, '.omega', 'company.json'), JSON.stringify({ root: path.join(root, 'company') }));

  const { values, sources } = composeTargetEnv({
    targetDir: path.join(brandRoot, 'targets', 'backend'),
    target: 'backend',
  });

  assert.strictEqual(values.GH_TOKEN, 'brand-gh', 'a key the schema names for backend is delivered');
  assert.strictEqual(sources.GH_TOKEN, 'brand');
  assert.strictEqual(values.ANTHROPIC_API_KEY, 'brand-anthropic', 'the brand layer beats the company layer');
  assert.strictEqual(sources.ANTHROPIC_API_KEY, 'brand');
  assert.strictEqual(values.RECAPTCHA_SITE_KEY, undefined, 'a key the schema names for web only never reaches the backend');
});

test('composeTargetEnv: the company layer fills the gaps the brand layer leaves', (t) => {
  const root = makeFixture('env-compose-company', {
    'company/.env': 'ANTHROPIC_API_KEY=company-anthropic\nRECAPTCHA_SITE_KEY=company-site-key\n',
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'GH_TOKEN=brand-gh\n',
  });
  cleanup(t, root);

  const brandRoot = path.join(root, 'brand');
  fs.mkdirSync(path.join(brandRoot, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, '.omega', 'company.json'), JSON.stringify({ root: path.join(root, 'company') }));

  const { values, sources } = composeTargetEnv({
    targetDir: path.join(brandRoot, 'targets', 'backend'),
    target: 'backend',
  });

  assert.strictEqual(values.ANTHROPIC_API_KEY, 'company-anthropic');
  assert.strictEqual(sources.ANTHROPIC_API_KEY, 'company');
  assert.strictEqual(values.RECAPTCHA_SITE_KEY, undefined, 'the company layer is filtered by the same schema');
});

test('composeTargetEnv: the target layer wins per key, and an empty value never claims one', (t) => {
  const root = makeFixture('env-compose-override', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'GH_TOKEN=brand-gh\nOPENAI_API_KEY=brand-openai\n',
    'brand/targets/backend/.env': 'GH_TOKEN=target-gh\nOPENAI_API_KEY=""\n',
  });
  cleanup(t, root);

  const { values, sources } = composeTargetEnv({
    targetDir: path.join(root, 'brand', 'targets', 'backend'),
    target: 'backend',
  });

  assert.strictEqual(values.GH_TOKEN, 'target-gh', "the target's own .env is the per-key override");
  assert.strictEqual(sources.GH_TOKEN, 'target');
  assert.strictEqual(values.OPENAI_API_KEY, 'brand-openai', 'an empty target value never claims the key');
  assert.strictEqual(sources.OPENAI_API_KEY, 'brand');
});

test('composeTargetEnv: the target layer passes through unfiltered — placement IS the targeting', (t) => {
  const root = makeFixture('env-compose-passthrough', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'SOME_BESPOKE_KEY=brand-value\n',
    'brand/targets/backend/.env': 'SOME_BESPOKE_KEY=target-value\nRECAPTCHA_SITE_KEY=target-site-key\n',
  });
  cleanup(t, root);

  const { values, sources } = composeTargetEnv({
    targetDir: path.join(root, 'brand', 'targets', 'backend'),
    target: 'backend',
  });

  assert.strictEqual(values.SOME_BESPOKE_KEY, 'target-value', 'a key the schema does not know still passes through');
  assert.strictEqual(sources.SOME_BESPOKE_KEY, 'target');
  assert.strictEqual(values.RECAPTCHA_SITE_KEY, 'target-site-key', 'a web-named key placed in the backend .env by hand is delivered');
});

test('composeTargetEnv: a pattern entry composes (CONNECTIONS_<PROVIDER>_CLIENT_*)', (t) => {
  const root = makeFixture('env-compose-pattern', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'CONNECTIONS_GOOGLE_CLIENT_ID=brand-client-id\nCONNECTIONS_GOOGLE_CLIENT_SECRET=brand-client-secret\n',
  });
  cleanup(t, root);

  const { values, sources } = composeTargetEnv({
    targetDir: path.join(root, 'brand', 'targets', 'backend'),
    target: 'backend',
  });

  assert.strictEqual(values.CONNECTIONS_GOOGLE_CLIENT_ID, 'brand-client-id');
  assert.strictEqual(values.CONNECTIONS_GOOGLE_CLIENT_SECRET, 'brand-client-secret');
  assert.strictEqual(sources.CONNECTIONS_GOOGLE_CLIENT_ID, 'brand');
});

test('composeTargetEnv: deliverAs renames the per-target GA4 secret on delivery', (t) => {
  const root = makeFixture('env-compose-deliver-as', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'GOOGLE_ANALYTICS_SECRET_BACKEND=backend-stream\nGOOGLE_ANALYTICS_SECRET_WEB=web-stream\n',
  });
  cleanup(t, root);

  const backend = composeTargetEnv({ targetDir: path.join(root, 'brand', 'targets', 'backend'), target: 'backend' });

  assert.strictEqual(backend.values.GOOGLE_ANALYTICS_SECRET, 'backend-stream', "the backend's stream secret arrives under the runtime name");
  assert.strictEqual(backend.sources.GOOGLE_ANALYTICS_SECRET, 'brand');
  assert.strictEqual(backend.values.GOOGLE_ANALYTICS_SECRET_BACKEND, undefined, 'the brand-level name never ships');
  assert.strictEqual(backend.values.GOOGLE_ANALYTICS_SECRET_WEB, undefined, "another target's stream secret never ships");

  const web = composeTargetEnv({ targetDir: path.join(root, 'brand', 'targets', 'website'), target: 'web' });
  assert.strictEqual(web.values.GOOGLE_ANALYTICS_SECRET, 'web-stream', 'each target gets its own stream secret');
});

test('composeTargetEnv: a runtime-group key in the brand root never composes', (t) => {
  const root = makeFixture('env-compose-runtime', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'CLAUDE_CODE_OAUTH_TOKEN=brand-token\nGOOGLE_ANALYTICS_SECRET=brand-secret\n',
  });
  cleanup(t, root);

  const { values } = composeTargetEnv({
    targetDir: path.join(root, 'brand', 'targets', 'backend'),
    target: 'backend',
  });

  assert.strictEqual(values.CLAUDE_CODE_OAUTH_TOKEN, undefined, 'the runtime group is resolved some other way, never composed');
  assert.strictEqual(values.GOOGLE_ANALYTICS_SECRET, undefined, 'the runtime name is delivered by deliverAs, never from a brand key of the same name');
});

test('composeTargetEnv: no .env anywhere composes nothing and never throws', (t) => {
  const root = makeFixture('env-compose-empty', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
  });
  cleanup(t, root);

  const { values, sources } = composeTargetEnv({
    targetDir: path.join(root, 'brand', 'targets', 'backend'),
    target: 'backend',
  });

  assert.deepStrictEqual(values, {});
  assert.deepStrictEqual(sources, {});
});

// ─── deliverAs delivery (#678) ───

// The GA4 stream secrets are the schema's only `deliverAs` family: a brand
// holds one per stream (GOOGLE_ANALYTICS_SECRET_<TARGET>), a target only ever
// reads GOOGLE_ANALYTICS_SECRET. The backend gets the rename through
// composeTargetEnv's dist/.env; every other target gets it through loadEnv.

const GA_KEYS = ['GOOGLE_ANALYTICS_SECRET', 'GOOGLE_ANALYTICS_SECRET_EXTENSION', 'GOOGLE_ANALYTICS_SECRET_BACKEND'];

function clearGaKeys() {
  GA_KEYS.forEach((key) => delete process.env[key]);
}

test('loadEnv with a target: the brand-level GA4 secret lands under the runtime name', (t) => {
  const root = makeFixture('env-deliver-load', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'GOOGLE_ANALYTICS_SECRET_EXTENSION=ext-stream\n',
  });
  cleanup(t, root, GA_KEYS);
  clearGaKeys();

  loadEnv(path.join(root, 'brand', 'targets', 'extension'), { target: 'extension' });

  assert.strictEqual(process.env.GOOGLE_ANALYTICS_SECRET, 'ext-stream', 'the extension reads the one runtime name');
  assert.strictEqual(process.env.GOOGLE_ANALYTICS_SECRET_EXTENSION, undefined, 'the brand-level name is consumed by the rename');
});

test('loadEnv with a target: a value already under the delivered name wins', (t) => {
  const root = makeFixture('env-deliver-explicit', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'GOOGLE_ANALYTICS_SECRET_EXTENSION=ext-stream\n',
  });
  cleanup(t, root, GA_KEYS);
  clearGaKeys();

  process.env.GOOGLE_ANALYTICS_SECRET = 'shell-secret';
  loadEnv(path.join(root, 'brand', 'targets', 'extension'), { target: 'extension' });

  assert.strictEqual(process.env.GOOGLE_ANALYTICS_SECRET, 'shell-secret', 'an explicit answer is never overridden');
});

test('loadEnv without a target: nothing is renamed', (t) => {
  const root = makeFixture('env-deliver-none', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'GOOGLE_ANALYTICS_SECRET_EXTENSION=ext-stream\n',
  });
  cleanup(t, root, GA_KEYS);
  clearGaKeys();

  loadEnv(path.join(root, 'brand', 'targets', 'extension'));

  assert.strictEqual(process.env.GOOGLE_ANALYTICS_SECRET_EXTENSION, 'ext-stream', 'the cascade still loads the brand-level name');
  assert.strictEqual(process.env.GOOGLE_ANALYTICS_SECRET, undefined, 'no target, no rename');
});

test('composeTargetEnv: the target layer renames too, and overrides the brand', (t) => {
  const root = makeFixture('env-deliver-target-layer', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'GOOGLE_ANALYTICS_SECRET_BACKEND=brand-stream\n',
    'brand/targets/backend/.env': 'GOOGLE_ANALYTICS_SECRET_BACKEND=target-stream\n',
  });
  cleanup(t, root);

  const { values, sources } = composeTargetEnv({
    targetDir: path.join(root, 'brand', 'targets', 'backend'),
    target: 'backend',
  });

  assert.strictEqual(values.GOOGLE_ANALYTICS_SECRET, 'target-stream', "the target's own answer wins");
  assert.strictEqual(sources.GOOGLE_ANALYTICS_SECRET, 'target');
  assert.strictEqual(values.GOOGLE_ANALYTICS_SECRET_BACKEND, undefined, 'one key ships, under the delivered name');
});

// ─── reloadEnv: a delivered name inherits its SOURCE key's ownership (#724) ───

// A rename CONSUMES its source key, so after the boot load nothing can see that
// the value came from the shell — the delivered name has to carry that ownership
// itself, or the reload drops a shell value (gone entirely when no file declares
// the source name, replaced by the file's when one does).
//
// THE SHELL: exported before this file reads its first `.env`, so the cascade's
// ownership snapshot counts the source name as shell-owned forever, exactly as a
// real `export GOOGLE_ANALYTICS_SECRET_WEB=…` would be. Each case re-sets it
// because delivery consumed it, the way the shell still holds it.
const WEB_SOURCE_KEY = 'GOOGLE_ANALYTICS_SECRET_WEB';
process.env[WEB_SOURCE_KEY] = 'shell-web-stream';
after(() => { delete process.env[WEB_SOURCE_KEY]; });

test('reloadEnv: a shell-set source key keeps the delivered name, with no file declaring it', (t) => {
  const root = makeFixture('env-deliver-reload-shell', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'ENVT17_X=brand\n',
  });
  cleanup(t, root, [...GA_KEYS, WEB_SOURCE_KEY, 'ENVT17_X']);
  clearGaKeys();

  process.env[WEB_SOURCE_KEY] = 'shell-web-stream';
  const websiteDir = path.join(root, 'brand', 'targets', 'website');

  loadEnv(websiteDir, { target: 'web' });
  assert.strictEqual(process.env.GOOGLE_ANALYTICS_SECRET, 'shell-web-stream', 'the boot load delivers the shell value, or the case proves nothing');

  reloadEnv(websiteDir, { target: 'web' });

  assert.strictEqual(process.env.GOOGLE_ANALYTICS_SECRET, 'shell-web-stream', "a delivered name inherits its source key's SHELL ownership — a reload never drops it");
});

test('reloadEnv: a shell-set source key still beats the file that declares the same name', (t) => {
  const root = makeFixture('env-deliver-reload-shell-vs-file', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': `${WEB_SOURCE_KEY}=file-web-stream\n`,
  });
  cleanup(t, root, [...GA_KEYS, WEB_SOURCE_KEY]);
  clearGaKeys();

  process.env[WEB_SOURCE_KEY] = 'shell-web-stream';
  const websiteDir = path.join(root, 'brand', 'targets', 'website');

  loadEnv(websiteDir, { target: 'web' });
  assert.strictEqual(process.env.GOOGLE_ANALYTICS_SECRET, 'shell-web-stream', 'the shell beats the file at boot, or the case proves nothing');

  reloadEnv(websiteDir, { target: 'web' });

  assert.strictEqual(process.env.GOOGLE_ANALYTICS_SECRET, 'shell-web-stream', 'the reload re-reads the file, and the shell keeps winning');
});

// ─── Environment overlays (#586) ───

// `.env.<environment>` overlays the `.env` beside it, the widespread standard.
// The environment names are exactly what envEnvironment() returns — one
// vocabulary with the runtime's own (`development` | `testing` | `production`).

test('envEnvironment(): one vocabulary — testing wins, then production, else development, and no signal is production', (t) => {
  const saved = { OMEGA_TEST_MODE: process.env.OMEGA_TEST_MODE, ENVIRONMENT: process.env.ENVIRONMENT, FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR, TERM_PROGRAM: process.env.TERM_PROGRAM };
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const only = (vars) => {
    for (const key of Object.keys(saved)) delete process.env[key];
    Object.assign(process.env, vars);
    return envEnvironment();
  };

  assert.strictEqual(only({ OMEGA_TEST_MODE: 'true', ENVIRONMENT: 'production' }), 'testing', 'testing wins over everything');
  assert.strictEqual(only({ ENVIRONMENT: 'production' }), 'production');
  assert.strictEqual(only({ ENVIRONMENT: 'development' }), 'development');
  assert.strictEqual(only({ FUNCTIONS_EMULATOR: 'true' }), 'development');
  assert.strictEqual(only({}), 'production', 'no signal is production — a deployed function carries none');

  // The list every overlay suffix and every scaffolded file is spelled from
  assert.deepStrictEqual(ENV_ENVIRONMENTS, ['development', 'testing', 'production']);
  for (const vars of [{ ENVIRONMENT: 'development' }, { ENVIRONMENT: 'production' }, { OMEGA_TEST_MODE: 'true' }]) {
    assert.ok(ENV_ENVIRONMENTS.includes(only(vars)), 'the resolver can only ever answer a name from the list');
  }
});

test('loadEnv: .env.<environment> overlays the .env beside it, at every layer', (t) => {
  const root = makeFixture('env-overlay-load', {
    'company/.env': 'ENVO1_C=company\nENVO1_B=company\nENVO1_L=company\n',
    'company/.env.development': 'ENVO1_C=company-dev\n',
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'ENVO1_B=brand\nENVO1_L=brand\n',
    'brand/.env.development': 'ENVO1_B=brand-dev\n',
    'brand/targets/site/.env': 'ENVO1_L=local\n',
    'brand/targets/site/.env.development': 'ENVO1_L=local-dev\n',
  });
  cleanup(t, root, ['ENVO1_C', 'ENVO1_B', 'ENVO1_L']);

  const brandRoot = path.join(root, 'brand');
  fs.mkdirSync(path.join(brandRoot, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, '.omega', 'company.json'), JSON.stringify({ root: path.join(root, 'company') }));

  const { loaded } = loadEnv(path.join(brandRoot, 'targets', 'site'), { environment: 'development' });

  assert.strictEqual(process.env.ENVO1_L, 'local-dev', "the local layer's overlay beats its own base");
  assert.strictEqual(process.env.ENVO1_B, 'brand-dev', 'a brand overlay beats the brand base — and still loses to a stronger layer');
  assert.strictEqual(process.env.ENVO1_C, 'company-dev');
  assert.deepStrictEqual(loaded, [
    path.join(brandRoot, 'targets', 'site', '.env.development'),
    path.join(brandRoot, 'targets', 'site', '.env'),
    path.join(brandRoot, '.env.development'),
    path.join(brandRoot, '.env'),
    path.join(root, 'company', '.env.development'),
    path.join(root, 'company', '.env'),
  ], 'each layer contributes its overlay first, then its base');
});

test('loadEnv: only the RUNNING environment overlays — another environment file is never read', (t) => {
  const root = makeFixture('env-overlay-other', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'ENVO2_K=base\n',
    'brand/.env.production': 'ENVO2_K=production\n',
    'brand/.env.testing': 'ENVO2_K=testing\n',
  });
  cleanup(t, root, ['ENVO2_K']);

  const { loaded } = loadEnv(path.join(root, 'brand', 'targets', 'site'), { environment: 'development' });

  assert.strictEqual(process.env.ENVO2_K, 'base', "a development run never reads another environment's file");
  assert.deepStrictEqual(loaded, [path.join(root, 'brand', '.env')]);
});

test('loadEnv: no overlay file leaves the chain exactly as it was', (t) => {
  const root = makeFixture('env-overlay-absent', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'ENVO3_K=base\n',
  });
  cleanup(t, root, ['ENVO3_K']);

  const { chain, loaded } = loadEnv(path.join(root, 'brand', 'targets', 'site'), { environment: 'development' });

  assert.deepStrictEqual(loaded, [path.join(root, 'brand', '.env')], 'a missing overlay skips silently');
  assert.deepStrictEqual(chain, {
    local: path.join(root, 'brand', 'targets', 'site', '.env'),
    brand: path.join(root, 'brand', '.env'),
    company: null,
  }, 'the chain shape is the three base layers, unchanged');
  assert.strictEqual(process.env.ENVO3_K, 'base');
});

test('composeTargetEnv: the environment overlay overrides the base within each layer', (t) => {
  const root = makeFixture('env-overlay-compose', {
    'company/.env': 'GH_TOKEN=company\nOMEGA_ADMIN_KEY=company\n',
    'company/.env.testing': 'GH_TOKEN=company-testing\n',
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'OMEGA_ADMIN_KEY=brand\nOMEGA_WEBHOOK_KEY=brand\n',
    'brand/.env.testing': 'OMEGA_ADMIN_KEY=brand-testing\n',
    'brand/targets/backend/.env': 'OMEGA_WEBHOOK_KEY=target\n',
    'brand/targets/backend/.env.testing': 'OMEGA_WEBHOOK_KEY=target-testing\n',
  });
  cleanup(t, root);

  const brandRoot = path.join(root, 'brand');
  fs.mkdirSync(path.join(brandRoot, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, '.omega', 'company.json'), JSON.stringify({ root: path.join(root, 'company') }));

  const { values, sources } = composeTargetEnv({
    targetDir: path.join(brandRoot, 'targets', 'backend'),
    target: 'backend',
    environment: 'testing',
  });

  assert.strictEqual(values.GH_TOKEN, 'company-testing');
  assert.strictEqual(sources.GH_TOKEN, 'company', 'an overlay is its layer, not a layer of its own');
  assert.strictEqual(values.OMEGA_ADMIN_KEY, 'brand-testing', "the brand's overlay beats the brand base and the company layer");
  assert.strictEqual(values.OMEGA_WEBHOOK_KEY, 'target-testing');
  assert.strictEqual(sources.OMEGA_WEBHOOK_KEY, 'target');
});

test("composeTargetEnv: another environment's overlay never rides the artifact", (t) => {
  const root = makeFixture('env-overlay-compose-other', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'OMEGA_ADMIN_KEY=base\n',
    'brand/.env.development': 'OMEGA_ADMIN_KEY=development\n',
    'brand/.env.production': 'OMEGA_ADMIN_KEY=production\n',
  });
  cleanup(t, root);

  const deployed = composeTargetEnv({
    targetDir: path.join(root, 'brand', 'targets', 'backend'),
    target: 'backend',
    environment: 'production',
  });
  assert.strictEqual(deployed.values.OMEGA_ADMIN_KEY, 'production', 'a deploy composes base + production');

  const local = composeTargetEnv({
    targetDir: path.join(root, 'brand', 'targets', 'backend'),
    target: 'backend',
    environment: 'development',
  });
  assert.strictEqual(local.values.OMEGA_ADMIN_KEY, 'development', 'the emulator composes base + development');
});

test('composeTargetEnv: the schema still filters an overlay — an unclaimed key never rides down', (t) => {
  const root = makeFixture('env-overlay-compose-filter', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
    'brand/.env': 'OMEGA_ADMIN_KEY=base\n',
    'brand/.env.development': 'OMEGA_ADMIN_KEY=dev\nCSC_KEY_PASSWORD=desktop-only\n',
  });
  cleanup(t, root);

  const { values } = composeTargetEnv({
    targetDir: path.join(root, 'brand', 'targets', 'backend'),
    target: 'backend',
    environment: 'development',
  });

  assert.strictEqual(values.OMEGA_ADMIN_KEY, 'dev');
  assert.strictEqual(values.CSC_KEY_PASSWORD, undefined, 'an overlay is filtered by the schema exactly like the base');
});

// ─── serializeEnv ───

test('serializeEnv: every value double-quoted, backslashes/quotes/newlines escaped', () => {
  const content = serializeEnv({
    PLAIN: 'value',
    QUOTED: 'say "hi"',
    SLASHED: 'C:\\keys\\file',
    MULTILINE: 'line1\nline2',
    EMPTY: '',
  });

  assert.deepStrictEqual(content.split('\n'), [
    'PLAIN="value"',
    'QUOTED="say \\"hi\\""',
    'SLASHED="C:\\\\keys\\\\file"',
    'MULTILINE="line1\\nline2"',
    'EMPTY=""',
    '',
  ]);

  // dotenv expands `\n` on read, so a multi-line blob survives the round trip
  // as itself — the quote/backslash escapes are there to keep the FILE
  // line-safe (one key per line, quotes balanced), which dotenv leaves as-is.
  const parsed = require('dotenv').parse(content);
  assert.strictEqual(parsed.MULTILINE, 'line1\nline2');
  assert.strictEqual(parsed.PLAIN, 'value');
  assert.strictEqual(parsed.EMPTY, '');
});
