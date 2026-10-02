/**
 * The seams the onboard wizard's tests drive it through. Require this BEFORE
 * the onboard source, so every binding it takes from child_process is the seam's.
 *
 * - The process seam: an `npm install` and any `dev` verb never really run;
 *   each is recorded and answers success. Every other child runs for real.
 * - The fake `gh` (fake-gh.js) first on PATH, signed out until a test says
 *   otherwise, so no test ever reaches the real GitHub.
 * - The fixture folders, console capture, and the prompt drivers.
 */
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const JSON5 = require('json5');

const { createMachine } = require('./fake-claude.js');
const { activate: activateGh } = require('./fake-gh.js');

// ─── The process seam ────────────────────────────────────────────────────────

/** Every intercepted child: `{ kind: 'install'|'dev', argv, cwd, packageJson }`. */
const calls = [];

const isNpm = (word) => /(^|\/)npm(-cli\.js)?$/.test(word);

/** The words a call runs, shell strings split, so `sh -c "npm install"` reads the same. */
function words(command, args) {
  const raw = Array.isArray(args) ? [command, ...args] : [command];
  return raw.flatMap((word) => String(word).split(/\s+/)).filter(Boolean);
}

function classify(argv) {
  if (argv.some(isNpm)) {
    if (argv.some((word) => ['install', 'i', 'ci'].includes(word))) return 'install';
    return argv.includes('start') || argv.includes('dev') ? 'dev' : null;
  }
  if (path.basename(argv[0]) === 'git') return null;
  return argv.includes('dev') ? 'dev' : null;
}

function record(kind, argv, options) {
  const cwd = (options && options.cwd) || process.cwd();
  const manifest = path.join(cwd, 'package.json');
  const packageJson = fs.existsSync(manifest) ? fs.readFileSync(manifest, 'utf8') : null;
  calls.push({ kind, argv, cwd, packageJson });
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.pid = 0;
  child.exitCode = null;
  child.kill = () => true;
  setImmediate(() => {
    child.stdout.end();
    child.stderr.end();
    child.exitCode = 0;
    child.emit('spawn');
    child.emit('exit', 0, null);
    child.emit('close', 0, null);
  });
  return child;
}

const emptyOutput = (options) => ((options && options.encoding && options.encoding !== 'buffer') ? '' : Buffer.alloc(0));

const FAKES = {
  spawn: () => fakeChild(),
  fork: () => fakeChild(),
  spawnSync: (options) => {
    const out = emptyOutput(options);
    return { pid: 0, status: 0, signal: null, stdout: out, stderr: out, output: [null, out, out] };
  },
  execFileSync: (options) => emptyOutput(options),
  execSync: (options) => emptyOutput(options),
  execFile: (options, callback) => {
    if (callback) setImmediate(() => callback(null, '', ''));
    return fakeChild();
  },
  exec: (options, callback) => {
    if (callback) setImmediate(() => callback(null, '', ''));
    return fakeChild();
  },
};

for (const [name, fake] of Object.entries(FAKES)) {
  const real = childProcess[name];
  const seam = function seam(command, ...rest) {
    const args = rest.find(Array.isArray);
    const options = rest.find((arg) => arg && typeof arg === 'object' && !Array.isArray(arg));
    const argv = words(command, args);
    const kind = classify(argv);
    if (!kind) return real.call(this, command, ...rest);
    record(kind, argv, options);
    return fake(options, rest.find((arg) => typeof arg === 'function'));
  };
  if (real[util.promisify.custom]) {
    seam[util.promisify.custom] = (command, ...rest) => {
      const argv = words(command, rest.find(Array.isArray));
      const kind = classify(argv);
      if (!kind) return real[util.promisify.custom](command, ...rest);
      record(kind, argv, rest.find((arg) => arg && typeof arg === 'object' && !Array.isArray(arg)));
      return Promise.resolve({ stdout: '', stderr: '' });
    };
  }
  childProcess[name] = seam;
}

// Loaded after the seam, since it reaches devkit modules that bind child_process.
// A run that falls into the manage handoff inherits this env: no machine credential rides along.
const { scrubCredentialEnv } = require('@omega.js/devkit/test/journey-harness');
const scrubbed = scrubCredentialEnv(process.env);
Object.keys(process.env).filter((name) => !(name in scrubbed)).forEach((name) => { delete process.env[name]; });

// ─── The fake gh ─────────────────────────────────────────────────────────────

const { useGh, withoutGh, ghCalls } = activateGh();

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A fresh folder named `name` inside its own temp parent, its real path. */
function folder(name) {
  const dir = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-onboard-'))), name);
  fs.mkdirSync(dir);
  return dir;
}

/** Run git in `dir`; a failure fails the test. */
function git(dir, ...args) {
  const result = childProcess.spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** Make `dir` a work tree whose origin is `slug` on GitHub, so onboard skips its own git init. */
function withOrigin(dir, slug) {
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', `https://github.com/${slug}.git`);
  return dir;
}

/** Point git at an empty global config (and no system one) for this test, so no machine's user name leaks in. */
function emptyGitConfig(t) {
  const previous = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
  const empty = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-gitconfig-')), 'config');
  fs.writeFileSync(empty, '');
  process.env.GIT_CONFIG_GLOBAL = empty;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const readConfig = (root) => JSON5.parse(fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8'));

/** Point this process at a fake `claude` that already has the plugin, so no run meets the install offer. */
function pluginInstalled() {
  const version = require('../../package.json').version;
  createMachine({
    marketplaces: { omega: { source: 'github', repo: 'Omega-JS-Stack/omega' } },
    installed: { 'omega@omega': version },
    published: version,
  }).activate();
}

// ─── Output and prompts ──────────────────────────────────────────────────────

/** Capture every console line from now on; `text()` reads them, `restore()` ends it. */
function captureConsole() {
  const lines = [];
  const methods = ['log', 'info', 'warn', 'error'];
  const originals = methods.map((method) => console[method]);
  methods.forEach((method) => {
    console[method] = (...args) => lines.push(args.map(String).join(' '));
  });
  return {
    text: () => lines.join('\n'),
    restore: () => methods.forEach((method, i) => { console[method] = originals[i]; }),
  };
}

/** Run onboard with the console captured; resolves `{ report, output }`. */
async function quietly(run) {
  const capture = captureConsole();
  try {
    const report = await run();
    return { report, output: capture.text() };
  } finally {
    capture.restore();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The questions a run with every identity flag still asks, each answered with Enter
const ENTER_THE_REST = {
  'Company brand id': '\r',
  'Brand description': '\r',
  'Brand tagline': '\r',
  'Contact person headshot URL': '\r',
  'Contact person link URL': '\r',
  'Keep this account list?': '\r',
};

/**
 * Answer every prompt a run may ask, whenever it shows, in any order. A value is
 * the keys to type, or an async step that types them itself. Resolves once the
 * wizard does.
 */
async function driveWizard(tty, run, answers) {
  const asked = [];
  let settled = false;
  run.then(() => { settled = true; }, () => { settled = true; });
  const start = Date.now();
  while (!settled) {
    if (Date.now() - start > 15000) throw new Error(`the wizard stalled on an unanswered prompt; answered: ${asked.join(', ')}`);
    for (const [match, keys] of Object.entries(answers)) {
      if (asked.includes(match)) continue;
      try {
        await tty.waitFor(match, 0);
      } catch {
        continue; // not rendered yet
      }
      asked.push(match);
      await (typeof keys === 'function' ? keys() : tty.answer(match, keys, 0));
    }
    await sleep(10);
  }
  return { report: await run, asked };
}

/** Press Enter at every question until the run ends. */
async function pressEnterThrough(tty, run) {
  let settled = false;
  run.then(() => { settled = true; }, () => { settled = true; });
  const start = Date.now();
  while (!settled) {
    if (Date.now() - start > 15000) throw new Error('the wizard never finished on Enter alone');
    await tty.answer('', '\r', 0);
    await sleep(40);
  }
  return run;
}

module.exports = {
  calls,
  useGh,
  withoutGh,
  ghCalls,
  folder,
  emptyGitConfig,
  git,
  withOrigin,
  readConfig,
  pluginInstalled,
  captureConsole,
  quietly,
  driveWizard,
  pressEnterThrough,
  sleep,
  ENTER_THE_REST,
};
