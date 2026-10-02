/**
 * The brand-template first run, end to end: a copy of the template's two files,
 * `npm start -- --id=acme --targets=web --no-dev`, and a generated brand at the
 * end. npm appends what follows `--` to the start script, which chains two
 * commands (`npm install && omega onboard`), so the flags reach onboard.
 *
 * Real files, real process: the real npm runs the script, and the copy's own
 * `omega` bin is the manager's, linked from this monorepo as npm would link it.
 * Its `npm install` is a fake that records the call and installs nothing, so no
 * registry is ever reached. The manager runs from its built dist/, so a monorepo
 * checkout needs its `npm run prepare` before this case is meaningful.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const JSON5 = require('json5');

require('../src/test/temp-home.js');
const { scrubCredentialEnv } = require('../src/test/journey-harness.js');

const PACKAGES = path.join(__dirname, '..', '..');
const MANAGER_PKG = path.join(PACKAGES, 'manager');
const MANAGER_VERSION = require(path.join(MANAGER_PKG, 'package.json')).version;
const { stageTemplate } = require(path.join(MANAGER_PKG, 'test', 'lib', 'brand-template.js'));

// The npm that ships with the node running this test
const NPM_CLI = path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

function executable(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

/**
 * A template copy with the manager installed the way npm installs it, a fake
 * `npm` wherever a script could find one, and a fake `gh` and `claude` ahead of
 * any real one.
 * @returns {{ root: string, clone: string, fakeBin: string, npmLog: string }}
 */
function stageTemplateCopy() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-first-run-')));
  const clone = stageTemplate(path.join(root, 'template-copy'));
  assert.equal(spawnSync('git', ['-C', clone, 'init', '-q']).status, 0, 'git init');

  fs.mkdirSync(path.join(clone, 'node_modules', '@omega.js'), { recursive: true });
  fs.symlinkSync(MANAGER_PKG, path.join(clone, 'node_modules', '@omega.js', 'manager'), 'dir');
  fs.mkdirSync(path.join(clone, 'node_modules', '.bin'), { recursive: true });
  fs.symlinkSync(path.join(MANAGER_PKG, 'bin', 'omega'), path.join(clone, 'node_modules', '.bin', 'omega'));

  const npmLog = path.join(root, 'npm.log');
  const fakeNpm = 'printf "%s|%s\\n" "$(pwd -P)" "$*" >> "$OMEGA_TEST_NPM_LOG"\nexit 0';
  const fakeBin = path.join(root, 'bin');
  executable(path.join(fakeBin, 'npm'), fakeNpm);
  executable(path.join(clone, 'node_modules', '.bin', 'npm'), fakeNpm);
  executable(path.join(fakeBin, 'gh'), 'echo "To get started with GitHub CLI, please run:  gh auth login" >&2\nexit 4');
  executable(path.join(fakeBin, 'claude'), 'exit 127');

  return { root, clone, fakeBin, npmLog };
}

test('first run: npm start -- --id=acme --targets=web --no-dev in a template copy ends on a generated brand (#1023 case 10)', () => {
  assert.ok(fs.existsSync(NPM_CLI), `npm ships beside node at ${NPM_CLI}`);
  const { root, clone, fakeBin, npmLog } = stageTemplateCopy();

  const env = {
    ...scrubCredentialEnv(process.env),
    PATH: [fakeBin, path.dirname(process.execPath), process.env.PATH].join(path.delimiter),
    OMEGA_TEST_NPM_LOG: npmLog,
    // The local-dist freshness heal can rebuild and re-exec; a monorepo-dev
    // convenience, not part of this contract.
    OMEGA_SKIP_FRESHNESS: '1',
    CLAUDE_CONFIG_DIR: path.join(root, 'claude'),
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
  };

  const out = spawnSync(process.execPath, [NPM_CLI, 'start', '--', '--id=acme', '--targets=web', '--no-dev'], {
    cwd: clone,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
  });
  const said = `${out.stdout}\n${out.stderr}`;

  assert.equal(out.status, 0, `npm start exited ${out.status}\n${said}`);
  assert.doesNotMatch(said, /Unknown command/);

  // The template's package.json was taken over by the generated one
  const pkg = JSON.parse(fs.readFileSync(path.join(clone, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'acme', '--id reached onboard');
  assert.deepEqual(pkg.workspaces, ['targets/*']);
  assert.deepEqual(pkg.devDependencies, { '@omega.js/manager': MANAGER_VERSION });
  assert.equal(pkg.scripts.start, 'omega dev', 'every later npm start is the dev stack');
  assert.ok(!('omega' in pkg), 'no template marker left');

  // And so was its README
  const readme = fs.readFileSync(path.join(clone, 'README.md'), 'utf8');
  assert.ok(!readme.includes('<!-- omega:template -->'), 'the template README is gone');

  const config = JSON5.parse(fs.readFileSync(path.join(clone, 'config', 'omega.json5'), 'utf8'));
  assert.equal(config.brand.id, 'acme');
  assert.deepEqual(config.targets, { web: { type: 'web' } }, '--targets reached onboard');
  assert.ok(fs.existsSync(path.join(clone, 'targets', 'web', 'package.json')));

  // The script's own install ran first; --no-dev stopped short of the dev stack
  const npmCalls = fs.readFileSync(npmLog, 'utf8').trim().split('\n');
  assert.equal(npmCalls[0], `${clone}|install`, `the start script installed first: ${npmCalls.join(', ')}`);
  assert.ok(npmCalls.every((line) => !/\|(start|run dev)\b/.test(line)), `no dev stack through npm: ${npmCalls.join(', ')}`);
  assert.equal(fs.existsSync(path.join(clone, 'logs', 'dev.log')), false, '--no-dev reached onboard: no dev stack ran');

  fs.rmSync(root, { recursive: true, force: true });
});
