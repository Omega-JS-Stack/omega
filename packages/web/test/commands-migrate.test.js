/**
 * `omega migrate` — the command layer over runMigration(). The pipeline
 * itself is proven in migrate.test.js; what only the COMMAND decides is
 * (a) which flags mean "preview" — `--check` AND the `--dry-run` alias — and
 * (b) that a report carrying errors exits non-zero instead of printing them
 * and claiming success.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const migrate = require('../src/commands/migrate.js');

const COMMAND = path.resolve(__dirname, '..', 'src', 'commands', 'migrate.js');

// The smallest tree runMigration accepts: one legacy config + one legacy file.
function legacyConsumer(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-migrate-cmd-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', '_config.yml'), 'title: Legacy Site\nurl: https://legacy.example.com\n');
  fs.writeFileSync(path.join(root, 'src', 'pages', 'index.html'), '{{ page.resolved.meta.title }}\n');
  fs.writeFileSync(path.join(root, 'Gemfile'), "source 'https://rubygems.org'\n");
  return root;
}

// Run the command with cwd pointed at the consumer (it migrates process.cwd()).
async function runIn(t, root, options) {
  const previous = process.cwd();
  process.chdir(root);
  t.after(() => process.chdir(previous));

  await migrate(options);
  process.chdir(previous);
}

test('--check previews: the report is produced and NOTHING is written', async (t) => {
  const root = legacyConsumer(t);

  await runIn(t, root, { check: true });

  assert.strictEqual(fs.existsSync(path.join(root, 'config', 'omega.json5')), false);
  assert.strictEqual(fs.existsSync(path.join(root, 'Gemfile')), true);
  assert.match(fs.readFileSync(path.join(root, 'src', 'pages', 'index.html'), 'utf8'), /page\.resolved/);
});

test('--dry-run is the same preview as --check', async (t) => {
  const root = legacyConsumer(t);

  await runIn(t, root, { 'dry-run': true });

  assert.strictEqual(fs.existsSync(path.join(root, 'config', 'omega.json5')), false);
  assert.strictEqual(fs.existsSync(path.join(root, 'Gemfile')), true);
  assert.match(fs.readFileSync(path.join(root, 'src', 'pages', 'index.html'), 'utf8'), /page\.resolved/);
});

test('no flags means a REAL migration — config written, legacy files gone', async (t) => {
  const root = legacyConsumer(t);

  await runIn(t, root, {});

  assert.strictEqual(fs.existsSync(path.join(root, 'config', 'omega.json5')), true);
  assert.strictEqual(fs.existsSync(path.join(root, 'Gemfile')), false);
  assert.match(fs.readFileSync(path.join(root, 'src', 'pages', 'index.html'), 'utf8'), /\{\{ resolved\.meta\.title \}\}/);
});

test('a pre-converted target exits ZERO so scripted pipelines survive (#297)', (t) => {
  // The fleet-standard order: the brand root config landed first and the UJM
  // configs are already gone, so only the codemods are left.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-migrate-converted-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: {} } }\n");
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'pages', 'index.html'), '<h1>{{ page.resolved.meta.title }}</h1>\n');

  const result = spawnSync(process.execPath, [
    '-e',
    `require(${JSON.stringify(COMMAND)})({})`,
  ], { cwd: root, encoding: 'utf8' });
  const output = result.stdout + result.stderr;

  assert.strictEqual(result.status, 0, 'already converted is success');
  assert.match(output, /already converted/, 'says why the config step was skipped');
  assert.match(output, /Next steps:/, 'the runbook still prints');
  assert.match(fs.readFileSync(path.join(root, 'src', 'pages', 'index.html'), 'utf8'), /\{\{ resolved\.meta\.title \}\}/, 'the codemods still ran');
});

test('--check names the legacy test files `omega test` will never discover (#248)', (t) => {
  const root = legacyConsumer(t);
  fs.mkdirSync(path.join(root, 'test', 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test', 'build', 'xp-curve.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(root, 'test', 'build', 'quiz-grading.js'), 'module.exports = {};\n');

  const result = spawnSync(process.execPath, [
    '-e',
    `require(${JSON.stringify(COMMAND)})({ check: true })`,
  ], { cwd: root, encoding: 'utf8' });
  const output = result.stdout + result.stderr;

  assert.strictEqual(result.status, 0, 'an undiscoverable suite is a warning, not a failed check');
  assert.match(output, /2 legacy test files will not be discovered/);
  assert.match(output, /test\/build\/xp-curve\.js/, 'the files are named, like every other per-file report line');
});

test('a report carrying errors exits non-zero and skips the next-steps block', (t) => {
  // A tree with no legacy configs at all — runMigration reports the error.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-migrate-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });

  const result = spawnSync(process.execPath, [
    '-e',
    `require(${JSON.stringify(COMMAND)})({})`,
  ], { cwd: root, encoding: 'utf8' });
  const output = result.stdout + result.stderr;

  assert.strictEqual(result.status, 1);
  assert.match(output, /no legacy configs found/);
  assert.doesNotMatch(output, /Next steps:/, 'a failed migration never prints the success runbook');
});
