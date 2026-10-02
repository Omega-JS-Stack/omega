/**
 * The build's config contract: a FATAL config-validation finding stops
 * `omega build`, and the process it ran in exits NON-ZERO. A retired key is
 * the canonical fatal — renamed outright, so nothing reads the old name and
 * the settings under it are silently lost — and a build that printed the
 * findings, produced no usable output and still exited 0 reads as SUCCESS to
 * CI and to every scripted caller
 * ([#426](https://github.com/Omega-JS-Stack/omega/issues/426)).
 *
 * Driven against a real temp consumer with the real command, and once through
 * the real bin as its own process — the exit code IS the contract, and only a
 * spawned process can prove it.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

// Every temp consumer's config load records its brand: keep that off the real ~/.omega
require('@omega.js/devkit/test/temp-home');

const build = require('../src/commands/build.js');

const PKG = path.resolve(__dirname, '..');
const MINT_MESSAGE = 'No minted logo set for a brand that has logo sources. Run: npx omega manage --service=assets, then deploy again.';

// A temp consumer whose config carries ONE retired key (payment.processors was
// renamed to payment.providers in #428) — the rest of the tree is a valid
// consumer, so nothing but that finding can fail the build. The package.json
// declares the framework so the bin dispatches straight to this one.
function consumer(t, extraFiles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-build-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const files = {
    'config/omega.json5': `{
  brand: { id: 'fixture', name: 'Fixture', url: 'https://fixture.example.com' },
  payment: { processors: { stripe: {} } },
  targets: { web: { type: 'web' } },
}`,
    'package.json': JSON.stringify({
      name: 'fixture-website',
      private: true,
      dependencies: { '@omega.js/web': '*' },
    }),
    'src/index.md': '# home',
  };

  for (const [relative, contents] of Object.entries({ ...files, ...extraFiles })) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

test('build: a retired config key is fatal — the command refuses, it never warns and builds', async (t) => {
  const root = consumer(t);
  const previous = process.cwd();
  process.chdir(root);
  t.after(() => process.chdir(previous));

  await assert.rejects(
    build({ logFile: false }),
    /config\/omega\.json5 is invalid:[\s\S]*payment\.processors\.stripe is not a key the schema declares/,
    'the finding comes back as a thrown fatal, not a printed warning',
  );

  assert.strictEqual(fs.existsSync(path.join(root, 'dist')), false, 'a refused build writes no output');
});

test('bin: `omega build` exits non-zero on a fatal config finding (real process, real bin)', (t) => {
  const root = consumer(t);

  const run = spawnSync(process.execPath, [path.join(PKG, 'bin', 'omega'), 'build'], {
    cwd: root,
    stdio: 'pipe',
    encoding: 'utf8',
  });

  const output = `${run.stdout}${run.stderr}`;
  assert.match(output, /payment\.processors\.stripe is not a key the schema declares/, 'the finding is printed');
  assert.notStrictEqual(run.status, 0, 'CI and scripted callers must read the run as a failure');
  assert.strictEqual(fs.existsSync(path.join(root, 'dist')), false, 'a refused build writes no output');
});

// The minted-asset gate: on a CI runner, a brand with a brandmark source and
// no minted favicon set stops the real build command with one line.
test('build: a CI build with a brandmark source and no minted favicon set refuses with the one line', async (t) => {
  const root = consumer(t, {
    'config/omega.json5': `{
  brand: { id: 'fixture', name: 'Fixture', url: 'https://fixture.example.com' },
  targets: { web: { type: 'web' } },
}`,
    'assets/logo/brandmark.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'targets/web/package.json': JSON.stringify({ name: 'fixture-web', private: true, dependencies: { '@omega.js/web': '*' } }),
  });
  const previous = process.cwd();
  process.chdir(path.join(root, 'targets', 'web'));
  t.after(() => process.chdir(previous));

  const saved = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = 'true';
  t.after(() => {
    if (saved === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = saved;
  });

  await assert.rejects(build({ logFile: false }), (error) => {
    assert.ok(error.message.includes(MINT_MESSAGE), `the message names the fix: ${error.message}`);
    assert.ok(!error.message.includes('\n'), 'one line');
    return true;
  });
  assert.strictEqual(fs.existsSync(path.join(root, 'targets', 'web', 'dist')), false, 'a refused build writes no output');
});

/**
 * The environment overlay is part of the build's config
 * ([#856](https://github.com/Omega-JS-Stack/omega/issues/856)): `omega build`
 * IS the production build, so it names `production` and the
 * `config/omega.production.json5` beside the base composes, on a machine whose
 * own ambient answer is `development`. Proven the way this file proves
 * everything else about the build's config: a retired key in the file that
 * composes is fatal, and the base here is clean, so only the overlay can throw.
 */
test('build: the PRODUCTION overlay composes, never the machine ambient one (#856)', async (t) => {
  const root = consumer(t, {
    'config/omega.json5': `{
  brand: { id: 'fixture', name: 'Fixture', url: 'https://fixture.example.com' },
  targets: { web: { type: 'web' } },
}`,
    'config/omega.production.json5': `{ payment: { processors: { stripe: {} } } }`,
    'config/omega.development.json5': `{ theme: { id: 'classy' } }`,
  });
  const previous = process.cwd();
  process.chdir(root);
  t.after(() => process.chdir(previous));

  // This machine says `development`, the way a terminal running a local build
  // does. The lane still builds for production, which is the whole point.
  const saved = [['ENVIRONMENT', process.env.ENVIRONMENT], ['OMEGA_TEST_MODE', process.env.OMEGA_TEST_MODE]];
  delete process.env.OMEGA_TEST_MODE;
  process.env.ENVIRONMENT = 'development';
  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  await assert.rejects(
    build({ logFile: false }),
    /config\/omega\.json5 is invalid:[\s\S]*payment\.processors\.stripe is not a key the schema declares/,
    'the production overlay is a layer of the build config, so its retired key refuses the build',
  );
});
