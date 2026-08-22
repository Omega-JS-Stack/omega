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
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadEnv, resolveEnvChain, loadEnvChain, readCompanyRoot } = require('../src/index.js');

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
