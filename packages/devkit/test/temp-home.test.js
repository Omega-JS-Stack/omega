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
const defineCases = require('@omega.js/devkit/test/define-cases');
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
function recordFrom(expect, home, brandRoot, withHelper) {
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
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stderr);
}

module.exports = defineCases({
  type: 'group',
  description: 'temp-home',
  tests: [
    {
      name: 'the helper redirects the registry: the real file keeps its hash, the temp home gets the line',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-temp-home-'));
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

        const home = path.join(root, 'home');
        const brandRoot = path.join(root, 'brand');
        const real = path.join(home, '.omega', 'brands.json');
        fs.mkdirSync(brandRoot, { recursive: true });
        fs.mkdirSync(path.dirname(real), { recursive: true });
        fs.writeFileSync(real, '{\n  "itw-creative-works": { "root": "/nowhere" }\n}\n');
        const before = hash(real);

        const { file: redirected, registry } = recordFrom(ctx.expect, home, brandRoot, true);

        ctx.expect(hash(real), 'the real registry is untouched').toBe(before);
        ctx.expect(redirected).not.toBe(real);
        ctx.expect(redirected.startsWith(fs.realpathSync(os.tmpdir())) || redirected.startsWith(os.tmpdir()), redirected).toBeTruthy();
        ctx.expect(registry['fixture-brand'].root).toBe(brandRoot);

        // The control: the same run without the helper lands in the real file.
        ctx.expect(recordFrom(ctx.expect, home, brandRoot, false).file).toBe(real);
        ctx.expect(hash(real), 'without the helper the run writes the real registry').not.toBe(before);
      },
    },

    {
      name: 'the temp home is removed when the process that required the helper exits',
      run: (ctx) => {
        const script = `
    const { OMEGA_HOME } = require(${JSON.stringify(HELPER)});
    require('node:fs').writeFileSync(require('node:path').join(OMEGA_HOME, 'brands.json'), '{}');
    process.stdout.write(OMEGA_HOME);
  `;
        const env = { ...process.env };
        delete env.OMEGA_HOME;

        const result = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
        ctx.expect(result.status, result.stderr).toBe(0);
        ctx.expect(result.stdout.includes('omega-test-home-'), result.stdout).toBeTruthy();
        ctx.expect(fs.existsSync(result.stdout), `${result.stdout} is left behind`).toBe(false);
      },
    },
  ],
});
