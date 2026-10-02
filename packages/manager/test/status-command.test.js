/**
 * `omega status` through the real bin: `--json` prints the folder's state as
 * one JSON object and nothing else on stdout, the plain form ends on the one
 * next command. Folders with nothing installed, so the manager answers as the
 * bin's own CLI.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Before the source loads: no real npm install, dev stack or GitHub call
const { folder, quietly, pluginInstalled } = require('./lib/onboard-seams.js');
// The machine registry is per-machine state: this file's fixtures record into a temp home.
require('@omega.js/devkit/test/temp-home');

const { ENV_SCHEMA } = require('@omega.js/config');
const { runOnboard } = require('../src/onboard.js');
const { stageTemplate } = require('./lib/brand-template.js');
const { install } = require('./lib/brand-install.js');

pluginInstalled();

const BIN = path.join(__dirname, '..', 'bin', 'omega');
const FIELDS = ['brand', 'brandRoot', 'inTarget', 'missing', 'next', 'state', 'targets'];
const OPERATOR_ONLY_KEYS = ['SLAPFORM_SERVICE_ACCOUNT', 'CHATSY_SERVICE_ACCOUNT', 'REPLYIFY_SERVICE_ACCOUNT', 'SERVER_SERVICE_ACCOUNT'];

/** Run `omega status` with `args` in `cwd`, the freshness heal held off and no schema key in its env. */
function status(cwd, args = []) {
  const env = { ...process.env, OMEGA_SKIP_FRESHNESS: '1' };
  for (const { name } of ENV_SCHEMA) if (name) delete env[name];
  return spawnSync(process.execPath, [BIN, 'status', ...args], { cwd, encoding: 'utf8', env });
}

/** A finished website-alone brand: onboarded with flags and no terminal, installed, its .env empty. */
async function websiteBrand() {
  const root = folder('acme');
  await quietly(() => runOnboard(root, { id: 'acme', name: 'Acme', url: 'https://acme.test', contactName: 'Jane Doe', manage: false, dev: false, targets: 'web' }));
  fs.writeFileSync(path.join(root, '.env'), '');
  return install(root);
}

const scratch = (name) => {
  const dir = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-status-'))), name);
  fs.mkdirSync(dir);
  return dir;
};

test('#1031 case 8: --json prints one JSON object with the report\'s fields, and nothing else on stdout', () => {
  const out = status(stageTemplate(scratch('acme-omega')), ['--json']);

  let report;
  assert.doesNotThrow(() => { report = JSON.parse(out.stdout); }, `all of stdout is one JSON value:\n${out.stdout}\n${out.stderr}`);
  assert.equal(typeof report, 'object');
  assert.deepEqual(Object.keys(report).sort(), FIELDS);
  assert.equal(report.state, 'template');
  assert.equal(report.next, 'npm start');

  const empty = status(scratch('empty'), ['--json']);
  assert.equal(JSON.parse(empty.stdout).state, 'empty', `${empty.stdout}\n${empty.stderr}`);
});

test('#1031 status: the plain report names the state and ends on the one next command', () => {
  const out = status(stageTemplate(scratch('acme-omega')));

  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /template/);
  const last = out.stdout.trim().split('\n').pop();
  assert.match(last, /npm start/, `the last line is the next command: ${out.stdout}`);
});

test('#1031 status: a finished brand with missing keys names npm run manage once for going live, prints the operator-only keys as optional, and ends on npm start', async () => {
  const root = await websiteBrand();

  const out = status(root);
  assert.equal(out.status, 0, out.stderr);
  const lines = out.stdout.trim().split('\n');
  assert.equal(lines.filter((line) => line.includes('npm run manage')).length, 1, `one line names npm run manage:\n${out.stdout}`);
  assert.match(lines[lines.length - 1], /npm start/, `the last line is the next command:\n${out.stdout}`);
  const optionalAt = out.stdout.indexOf('optional, for later');
  assert.notEqual(optionalAt, -1, `an optional line is printed:\n${out.stdout}`);
  for (const key of OPERATOR_ONLY_KEYS) {
    assert.ok(out.stdout.indexOf(key) > optionalAt, `${key} is printed under the optional line:\n${out.stdout}`);
  }

  const report = JSON.parse(status(root, ['--json']).stdout);
  assert.equal(report.state, 'brand');
  assert.equal(report.next, 'npm start');
  const optional = report.missing.env.filter((entry) => entry.optional === true).map((entry) => entry.key);
  assert.deepEqual(OPERATOR_ONLY_KEYS.filter((key) => !optional.includes(key)), []);
});

test('#1031 status: a brand missing only optional keys prints no going-live header, only the optional line', async () => {
  const root = await websiteBrand();
  const owed = JSON.parse(status(root, ['--json']).stdout).missing.env.filter((entry) => !entry.optional);
  assert.notEqual(owed.length, 0, 'the fixture starts owing a going-live key');
  fs.writeFileSync(path.join(root, '.env'), owed.map(({ key }) => `${key}="placeholder"\n`).join(''));

  const report = JSON.parse(status(root, ['--json']).stdout);
  assert.deepEqual(report.missing.env.filter((entry) => !entry.optional), [], 'only optional keys are left missing');

  const out = status(root);
  assert.equal(out.status, 0, out.stderr);
  assert.doesNotMatch(out.stdout, /Env keys for going live/, `no going-live header:\n${out.stdout}`);
  const optionalLine = out.stdout.split('\n').find((line) => line.includes('optional, for later'));
  assert.ok(optionalLine, `an optional line is printed:\n${out.stdout}`);
  assert.match(optionalLine, /SLAPFORM_SERVICE_ACCOUNT/);
});
