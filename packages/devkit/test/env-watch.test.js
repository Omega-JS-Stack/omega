/**
 * env-watch RELOAD tests — what a reload actually delivers
 * ([#681](https://github.com/Omega-JS-Stack/omega/issues/681),
 * [#724](https://github.com/Omega-JS-Stack/omega/issues/724)).
 *
 * The per-framework suites (web `dev-env-watch`, desktop/extension
 * `build/env-watch`) pin the PATH RESOLUTION — which files are watched. Nobody
 * pinned what a fired reload changes in process.env, which is where the
 * contract's real edge lives:
 *
 *   - a NEW key lands on the next rebuild;
 *   - an EDITED value lands too (#724 — `reloadEnv` drops what a file layer
 *     owns before re-reading the cascade);
 *   - a key DROPPED from the file is dropped from the process;
 *   - a SHELL-set key is never touched by any of the three.
 *
 * The last case is the one the mechanism exists to protect: ownership is
 * REMEMBERED (the key set process.env carried before the first file read),
 * never inferred from presence, so the shell keeps winning over every file.
 * That is why the shell key below is set at module load — before anything here
 * reads a `.env`, which is exactly what a shell export is.
 *
 * Offline by construction: temp dirs, and every key it touches is deleted from
 * process.env before the case returns.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadEnv } = require('@omega.js/config');
const { watchEnvChain } = require('../src/env-watch.js');

// Short enough to keep the case fast, long enough to still collapse the write
// burst the fixture itself makes.
const DEBOUNCE_MS = 20;

// The reload itself is the signal a case waits on (the watcher's `log` fires
// once per reload). macOS starts the fs.watch event stream on another thread,
// so a write that lands before the stream is live is never seen — on a loaded
// machine (the root battery runs every workspace at once) that was every
// other case. A dev lane arms at boot and edits seconds later, so only the
// fixture is exposed: it re-applies its idempotent write every RETRY_MS until
// the watcher reports, and the ceiling only keeps a dead watcher from hanging
// the run.
const RETRY_MS = 100;
const RELOAD_CEILING_MS = 5000;

// THE SHELL: in process.env before this file reads its first `.env`, so the
// cascade's ownership snapshot counts it as shell-owned forever.
const SHELL_KEY = `OMEGA_ENV_WATCH_SHELL_${process.pid}`;
process.env[SHELL_KEY] = 'shell';
after(() => { delete process.env[SHELL_KEY]; });

/**
 * A standalone target dir with a `.env` — the smallest chain that reloads
 * (nothing above it, so nothing else can claim a key).
 */
function targetFixture(t, contents) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-env-watch-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, '.env'), contents);

  return root;
}

/** Arm a watcher, apply `mutate` (idempotent), and resolve once the watcher has reloaded. */
async function afterReload(t, root, mutate) {
  let reloaded = false;
  let onReload = () => {};
  const watcher = watchEnvChain({ projectDir: root, debounceMs: DEBOUNCE_MS, log: () => { reloaded = true; onReload(); } });
  t.after(() => watcher.close());

  const deadline = Date.now() + RELOAD_CEILING_MS;
  while (!reloaded && Date.now() < deadline) {
    mutate();
    await new Promise((resolve) => {
      onReload = resolve;
      setTimeout(resolve, RETRY_MS);
    });
  }
}

test('a NEW key lands after the debounce', async (t) => {
  const key = `OMEGA_ENV_WATCH_NEW_${process.pid}`;
  const seed = `OMEGA_ENV_WATCH_SEED_${process.pid}`;
  t.after(() => { delete process.env[key]; delete process.env[seed]; });

  const root = targetFixture(t, `${seed}="seed"\n`);
  assert.equal(process.env[key], undefined, 'the key must not exist before the reload, or the case proves nothing');

  await afterReload(t, root, () => {
    fs.writeFileSync(path.join(root, '.env'), `${seed}="seed"\n${key}="landed"\n`);
  });

  assert.equal(process.env[key], 'landed', 'a key process.env did not already carry is claimed by the reload');
});

test('an EDITED value lands — the file layer owns the key, so the reload rewrites it', async (t) => {
  const key = `OMEGA_ENV_WATCH_EDITED_${process.pid}`;
  t.after(() => { delete process.env[key]; });

  const root = targetFixture(t, `${key}="original"\n`);

  // The boot load: what every dev lane's CLI/gulp start already did, and what
  // puts the key in process.env — as a FILE-owned key — in the first place.
  loadEnv(root);
  assert.equal(process.env[key], 'original', 'the boot load must have claimed the key, or the case proves nothing');

  await afterReload(t, root, () => {
    fs.writeFileSync(path.join(root, '.env'), `${key}="edited"\n`);
  });

  assert.equal(process.env[key], 'edited', 'a file layer owns what it loaded, so the reload drops it and re-reads the edit');
});

test('a SHELL-set key survives an edited file value untouched', async (t) => {
  const root = targetFixture(t, `${SHELL_KEY}="from-file"\n`);

  // The boot load: the file loses to the shell, the same no-override rule that
  // has always made an exported value win.
  loadEnv(root);
  assert.equal(process.env[SHELL_KEY], 'shell', 'the shell must still win at boot, or the case proves nothing');

  await afterReload(t, root, () => {
    fs.writeFileSync(path.join(root, '.env'), `${SHELL_KEY}="edited-in-file"\n`);
  });

  assert.equal(process.env[SHELL_KEY], 'shell', 'the reload rewrites only file-owned keys — the shell owns this one forever');
});

test('a key DROPPED from the file is dropped from the process', async (t) => {
  const key = `OMEGA_ENV_WATCH_REMOVED_${process.pid}`;
  const kept = `OMEGA_ENV_WATCH_KEPT_${process.pid}`;
  t.after(() => { delete process.env[key]; delete process.env[kept]; });

  const root = targetFixture(t, `${key}="original"\n${kept}="kept"\n`);

  loadEnv(root);
  assert.equal(process.env[key], 'original', 'the boot load must have claimed the key, or the case proves nothing');

  await afterReload(t, root, () => {
    fs.writeFileSync(path.join(root, '.env'), `${kept}="kept"\n`);
  });

  assert.equal(process.env[key], undefined, 'a file-owned key the file no longer declares is gone — the reload re-reads the file, it does not merge onto the old set');
});
