/**
 * ensure-target + deploy-precheck — the two halves `omega setup` used to be
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)): the local half
 * runs on every verb and is idempotent, the network half is a deploy precheck
 * with one opt-out flag.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { ensureTarget, PROJECT_SCRIPTS } = require('../src/commands/lib/ensure-target.js');
const { deployPrecheck } = require('../src/commands/lib/deploy-precheck.js');
const Main = require('../src/cli.js');

const quiet = { log() {}, warn() {}, error() {} };

function tmpConsumer() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-ensure-'));
}

test('ensureTarget: writes on a fresh target, no-op on the rerun', () => {
  const root = tmpConsumer();

  const first = ensureTarget({ projectDir: root });
  assert.ok(first.written.length > 0, 'a fresh target gets the defaults tree');
  assert.ok(first.changed.some((line) => line.startsWith('package.json')), 'package.json is synced');
  assert.ok(fs.existsSync(path.join(root, '.github/workflows/build.yml')), 'CI workflow scaffolded');

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepStrictEqual(
    Object.fromEntries(Object.keys(PROJECT_SCRIPTS).map((key) => [key, manifest.scripts[key]])),
    PROJECT_SCRIPTS,
    'the omega verb scripts are synced',
  );
  assert.ok(!('setup' in manifest.scripts), 'no `setup` script — the verbs run ensureTarget themselves');

  // The rerun adds nothing and syncs nothing. (One caveat, pre-existing and
  // named in `merged`: the omega.json5 seed is written verbatim on the fresh
  // pass and re-stringified by its JSON5 defaults-merge on the next one, so it
  // converges on pass three. Everything else is stable from pass two.)
  const second = ensureTarget({ projectDir: root });
  assert.deepStrictEqual(second.written, [], 'a converged target writes nothing new');
  assert.deepStrictEqual(second.changed, [], 'a converged target syncs no manifest');

  const third = ensureTarget({ projectDir: root });
  assert.deepStrictEqual(third, { written: [], merged: [], changed: [] }, 'a converged target is a total no-op');
});

test('ensureTarget: refuses a workspace root, loudly, without writing a single file (#699)', () => {
  // The accident: `omega deploy` at a workspace root scaffolded a whole website
  // target into it — src/, workflows, rewritten root scripts — before failing
  // anyway. Parity with the same case in @omega.js/desktop's suite (#706).
  const root = tmpConsumer();
  const manifestPath = path.join(root, 'package.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify({ name: 'acme', private: true, workspaces: ['targets/*'] }, null, 2)}\n`);
  const before = fs.readFileSync(manifestPath, 'utf8');

  assert.throws(() => ensureTarget({ projectDir: root }), (error) => {
    assert.match(error.message, /refusing to scaffold into/);
    assert.match(error.message, /declares "workspaces"/);
    assert.ok(error.message.includes(root), `names the directory: ${error.message}`);
    return true;
  });

  assert.deepStrictEqual(fs.readdirSync(root), ['package.json'], 'nothing was scaffolded');
  assert.strictEqual(fs.readFileSync(manifestPath, 'utf8'), before, 'the manifest is byte-identical');
});

test('deploy precheck: --no-secrets skips every step, bare deploy runs them in order', async () => {
  const ran = [];
  const steps = ['push-secrets'].map((name) => ({ name, run: () => { ran.push(name); } }));

  const skipped = await deployPrecheck({ projectDir: '/tmp/x', options: { secrets: false }, logger: quiet, steps });
  assert.deepStrictEqual(skipped, { skipped: 'opt-out' });
  assert.deepStrictEqual(ran, [], '--no-secrets publishes nothing');

  const result = await deployPrecheck({ projectDir: '/tmp/x', options: {}, logger: quiet, steps });
  assert.deepStrictEqual(ran, ['push-secrets'], 'the precheck runs by default');
  assert.deepStrictEqual(result.ran, ran);
});

test('cli: no `setup` command, and a bare invocation resolves to help', () => {
  const { commandsDir, aliases, defaultCommand } = Main.config;

  assert.strictEqual(defaultCommand, 'help', 'bare `omega` prints help (#675)');
  assert.ok(!('setup' in aliases), 'the setup alias is gone');
  assert.ok(!fs.existsSync(path.join(commandsDir, 'setup.js')), 'commands/setup.js is deleted');
});
