/**
 * `omega status` through the real bin: `--json` prints the folder's state as
 * one JSON object and nothing else on stdout, the plain form ends on the one
 * next command. Folders with nothing installed, so the manager answers as the
 * bin's own CLI.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Before the source loads: no real npm install, dev stack or GitHub call
const { folder, quietly, pluginInstalled } = require('./lib/onboard-seams.js');
// The machine registry is per-machine state: this file's fixtures record into a temp home.
require('@omega.js/devkit/test/temp-home');

const { ENV_SCHEMA } = require('@omega.js/config');
const { commandOnPath } = require('@omega.js/devkit/command-path');
const { MACHINE_TOOLS } = require('@omega.js/devkit/machine-tools');
const { runOnboard } = require('../src/onboard.js');
const { stageTemplate } = require('./lib/brand-template.js');
const { install } = require('./lib/brand-install.js');
const { toolProbe } = require('./lib/tool-probe.js');

pluginInstalled();

const BIN = path.join(__dirname, '..', 'bin', 'omega');
const FIELDS = ['brand', 'brandRoot', 'inTarget', 'missing', 'next', 'state', 'targets'];
const OPERATOR_ONLY_KEYS = ['SLAPFORM_SERVICE_ACCOUNT', 'CHATSY_SERVICE_ACCOUNT', 'REPLYIFY_SERVICE_ACCOUNT', 'SERVER_SERVICE_ACCOUNT'];

/** Run `omega status` with `args` in `cwd`, the freshness heal held off, no schema key in its env, `overrides` on top. */
function status(cwd, args = [], overrides = {}) {
  const env = { ...process.env, OMEGA_SKIP_FRESHNESS: '1', ...overrides };
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

/** A PATH holding only node and git, so every machine-tool probe the bin runs finds nothing. */
function pathWithoutMachineTools() {
  const bin = scratch('bin');
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  fs.symlinkSync(commandOnPath('git'), path.join(bin, 'git'));
  return bin;
}

module.exports = defineCases({
  type: 'group',
  description: 'status-command',
  tests: [
    {
      name: '#1031 case 8: --json prints one JSON object with the report\'s fields, and nothing else on stdout',
      run: (ctx) => {
        const out = status(stageTemplate(scratch('acme-omega')), ['--json']);

        let report;
        ctx.expect(() => { report = JSON.parse(out.stdout); }, `all of stdout is one JSON value:\n${out.stdout}\n${out.stderr}`).not.toThrow();
        ctx.expect(typeof report).toBe('object');
        ctx.expect(Object.keys(report).sort()).toEqual(FIELDS);
        ctx.expect(report.state).toBe('template');
        ctx.expect(report.next).toBe('npm start');

        const empty = status(scratch('empty'), ['--json']);
        ctx.expect(JSON.parse(empty.stdout).state, `${empty.stdout}\n${empty.stderr}`).toBe('empty');
      },
    },

    {
      name: '#1031 status: the plain report names the state and ends on the one next command',
      run: (ctx) => {
        const out = status(stageTemplate(scratch('acme-omega')));

        ctx.expect(out.status, out.stderr).toBe(0);
        ctx.expect(out.stdout).toMatch(/template/);
        const last = out.stdout.trim().split('\n').pop();
        ctx.expect(last, `the last line is the next command: ${out.stdout}`).toMatch(/npm start/);
      },
    },

    {
      name: '#1031 status: a finished brand with missing keys names npm run manage once for going live, prints the operator-only keys as optional, and ends on npm start',
      run: async (ctx) => {
        const root = await websiteBrand();

        const out = status(root);
        ctx.expect(out.status, out.stderr).toBe(0);
        const lines = out.stdout.trim().split('\n');
        ctx.expect(lines.filter((line) => line.includes('npm run manage')).length, `one line names npm run manage:\n${out.stdout}`).toBe(1);
        ctx.expect(lines[lines.length - 1], `the last line is the next command:\n${out.stdout}`).toMatch(/npm start/);
        const optionalAt = out.stdout.indexOf('optional, for later');
        ctx.expect(optionalAt, `an optional line is printed:\n${out.stdout}`).not.toBe(-1);
        for (const key of OPERATOR_ONLY_KEYS) {
          ctx.expect(out.stdout.indexOf(key) > optionalAt, `${key} is printed under the optional line:\n${out.stdout}`).toBeTruthy();
        }

        const report = JSON.parse(status(root, ['--json']).stdout);
        ctx.expect(report.state).toBe('brand');
        ctx.expect(report.next).toBe('npm start');
        const optional = report.missing.env.filter((entry) => entry.optional === true).map((entry) => entry.key);
        ctx.expect(OPERATOR_ONLY_KEYS.filter((key) => !optional.includes(key))).toEqual([]);
      },
    },

    {
      name: '#1031 status: a brand missing only optional keys prints no going-live header, only the optional line',
      run: async (ctx) => {
        const root = await websiteBrand();
        const owed = JSON.parse(status(root, ['--json']).stdout).missing.env.filter((entry) => !entry.optional);
        ctx.expect(owed.length, 'the fixture starts owing a going-live key').not.toBe(0);
        fs.writeFileSync(path.join(root, '.env'), owed.map(({ key }) => `${key}="placeholder"\n`).join(''));

        const report = JSON.parse(status(root, ['--json']).stdout);
        ctx.expect(report.missing.env.filter((entry) => !entry.optional), 'only optional keys are left missing').toEqual([]);

        const out = status(root);
        ctx.expect(out.status, out.stderr).toBe(0);
        ctx.expect(out.stdout, `no going-live header:\n${out.stdout}`).not.toMatch(/Env keys for going live/);
        const optionalLine = out.stdout.split('\n').find((line) => line.includes('optional, for later'));
        ctx.expect(optionalLine, `an optional line is printed:\n${out.stdout}`).toBeTruthy();
        ctx.expect(optionalLine).toMatch(/SLAPFORM_SERVICE_ACCOUNT/);
      },
    },

    {
      name: '#1032 case 9: on a brand whose backend misses the Firebase CLI, status lists it under Machine tools',
      run: async (ctx) => {
        const root = folder('acme');
        const flags = { id: 'acme', name: 'Acme', url: 'https://acme.test', contactName: 'Jane Doe', manage: false, dev: false, targets: 'web,backend' };
        // The onboarding itself finds every tool present, so it never probes this machine's own
        await quietly(() => runOnboard(root, { ...flags, execFn: toolProbe() }));
        install(root);
        const firebase = MACHINE_TOOLS.backend.find((tool) => tool.name === 'firebase');
        const env = { PATH: pathWithoutMachineTools() };

        const out = status(root, [], env);
        ctx.expect(out.status, out.stderr).toBe(0);
        const lines = out.stdout.split('\n');
        const header = lines.findIndex((line) => line.includes('Machine tools'));
        ctx.expect(header, `a Machine tools gap is printed:\n${out.stdout}`).not.toBe(-1);
        ctx.expect(lines.slice(header).some((line) => line.includes(firebase.name)), `firebase is listed under it:\n${out.stdout}`).toBeTruthy();

        const report = JSON.parse(status(root, ['--json'], env).stdout);
        const names = report.missing.tools.map((tool) => (typeof tool === 'string' ? tool : tool.name));
        ctx.expect(names.includes(firebase.name), JSON.stringify(report.missing.tools)).toBeTruthy();
      },
    },
  ],
});
