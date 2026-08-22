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

const build = require('../src/commands/build.js');

const PKG = path.resolve(__dirname, '..');

// A temp consumer whose config carries ONE retired key (payment.processors was
// renamed to payment.providers in #428) — the rest of the tree is a valid
// consumer, so nothing but that finding can fail the build. The package.json
// declares the framework so the bin dispatches straight to this one.
function consumer(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-build-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const files = {
    'config/omega.json5': `{
  brand: { id: 'fixture', name: 'Fixture', url: 'https://fixture.example.com' },
  payment: { processors: { stripe: {} } },
  targets: { web: {} },
}`,
    'package.json': JSON.stringify({
      name: 'fixture-website',
      private: true,
      dependencies: { '@omega.js/web': '*' },
    }),
    'src/index.md': '# home',
  };

  for (const [relative, contents] of Object.entries(files)) {
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
    /config\/omega\.json5 is invalid:[\s\S]*payment\.processors is retired/,
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
  assert.match(output, /payment\.processors is retired/, 'the finding is printed');
  assert.notStrictEqual(run.status, 0, 'CI and scripted callers must read the run as a failure');
  assert.strictEqual(fs.existsSync(path.join(root, 'dist')), false, 'a refused build writes no output');
});
