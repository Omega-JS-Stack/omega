/**
 * The temp-home test helper: one require at the top of a test file points the
 * machine home at a temp dir, so a fixture's loadConfig() never writes a line
 * into the developer's real registry (`~/.omega/brands.json`).
 *
 * Each run is a child with its own fake HOME, so "the real file" here is a
 * file this test owns: hashing the developer's registry would race every other
 * process on the machine.
 *
 * Run: node --test test/temp-home.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HELPER = path.join(__dirname, '..', 'src', 'test', 'temp-home.js');
const CONFIG = require.resolve('@omega.js/config');

const hash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

// Record a brand from a child whose HOME is `home`, with or without the helper.
// The child reports the registry it wrote, since the helper's temp home goes at exit.
function recordFrom(home, brandRoot, withHelper) {
  const script = `
    ${withHelper ? `require(${JSON.stringify(HELPER)});` : ''}
    const { recordBrand, registryFile } = require(${JSON.stringify(CONFIG)});
    recordBrand({ id: 'fixture-brand', root: ${JSON.stringify(brandRoot)} });
    const fs = require('node:fs');
    process.stderr.write(JSON.stringify({ file: registryFile(), registry: JSON.parse(fs.readFileSync(registryFile(), 'utf8')) }));
  `;
  const env = { ...process.env, HOME: home };
  delete env.OMEGA_HOME;

  const result = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stderr);
}

test('the helper redirects the registry: the real file keeps its hash, the temp home gets the line', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-temp-home-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const home = path.join(root, 'home');
  const brandRoot = path.join(root, 'brand');
  const real = path.join(home, '.omega', 'brands.json');
  fs.mkdirSync(brandRoot, { recursive: true });
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, '{\n  "itw-creative-works": { "root": "/nowhere" }\n}\n');
  const before = hash(real);

  const { file: redirected, registry } = recordFrom(home, brandRoot, true);

  assert.equal(hash(real), before, 'the real registry is untouched');
  assert.notEqual(redirected, real);
  assert.ok(redirected.startsWith(fs.realpathSync(os.tmpdir())) || redirected.startsWith(os.tmpdir()), redirected);
  assert.equal(registry['fixture-brand'].root, brandRoot);

  // The control: the same run without the helper lands in the real file.
  assert.equal(recordFrom(home, brandRoot, false).file, real);
  assert.notEqual(hash(real), before, 'without the helper the run writes the real registry');
});

test('the temp home is removed when the process that required the helper exits', () => {
  const script = `
    const { OMEGA_HOME } = require(${JSON.stringify(HELPER)});
    require('node:fs').writeFileSync(require('node:path').join(OMEGA_HOME, 'brands.json'), '{}');
    process.stdout.write(OMEGA_HOME);
  `;
  const env = { ...process.env };
  delete env.OMEGA_HOME;

  const result = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('omega-test-home-'), result.stdout);
  assert.equal(fs.existsSync(result.stdout), false, `${result.stdout} is left behind`);
});
