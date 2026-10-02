/**
 * Root `npm run test:plugin`: the plugin-delivery matrix on REAL Claude Code, its own lane outside root `npm test`.
 * Each row is one headless session (`claude -p`) in a throwaway config folder under `.temp/plugin-lane-e2e/`,
 * never the real ~/.claude. A probe plugin under the real names (`omega@omega`, `omega@omega-local`)
 * logs from its SessionStart hook which copy loaded; a row passes when exactly the expected copy did.
 * Offline: a lane-only git config sends the real GitHub source to a local repo standing in for GitHub,
 * and allows the file protocol alone, so a fetch it misses fails instead of going online. So nothing is
 * swapped: brand settings are the real writer's, both machines are set up by the real helpers (the
 * consumer install, and the switch `omega i local` runs), and the fixture monorepo carries this repo's
 * own committed omega keys. Projects sit in the OS temp dir: a session under this repo also reads its
 * .claude/settings.json. Skips, exit 0, without `claude`. Verdicts: `.temp/plugin-lane-e2e/steps.log`.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { ensureClaudeSettings } = require('../packages/manager/src/lib/claude-settings.js');
const { ensureMachinePlugin, ensureLocalDefault } = require('../packages/manager/src/lib/claude-machine.js');
const { createStepsLog } = require('./steps-log');

const ROOT = path.join(__dirname, '..');
const LANE = path.join(ROOT, '.temp', 'plugin-lane-e2e');
const LOADS = path.join(LANE, 'loads.log');
const HOMES = path.join(LANE, 'homes');
const GITCONFIG = path.join(LANE, 'gitconfig');
const SESSION_TIMEOUT_MS = 180000;
const PROBE_VERSION = '1.0.0';
const PUB = 'published';
const LOC = 'local';
let FIXTURES = null;

const stepsLog = createStepsLog(LANE);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Run a command; a non-zero exit throws with its output. */
function must(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout}${result.stderr}${result.error || ''}`);
  }
  return result.stdout;
}

/** A git repo rooted exactly here, so no command or session walks up into the monorepo. */
function gitRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  must('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  const top = must('git', ['-C', dir, 'rev-parse', '--show-toplevel']).trim();
  if (fs.realpathSync(top) !== fs.realpathSync(dir)) throw new Error(`git root of ${dir} is ${top}, refusing to commit`);
}

function commit(dir, message) {
  const identity = ['-c', 'user.email=plugin-lane@omega.invalid', '-c', 'user.name=plugin lane', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
  must('git', ['-C', dir, ...identity, 'add', '-A']);
  must('git', ['-C', dir, ...identity, 'commit', '-q', '--no-verify', '-m', message]);
}

/** The env every claude call gets: this lane's config folder and git config, and nothing of an outer session. */
function claudeEnv(home) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: home, GIT_CONFIG_GLOBAL: GITCONFIG, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file' };
  for (const key of ['CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_ENV_FILE']) delete env[key];
  return env;
}

/** Run a real helper on its own default exec, with this process pointed at one lane machine. */
async function onMachine(home, cwd, helper) {
  const saved = { cwd: process.cwd(), env: { ...process.env } };
  const env = claudeEnv(home);
  process.chdir(cwd);
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  try {
    return await helper();
  } finally {
    process.chdir(saved.cwd);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved.env);
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A marketplace laid out like this repo: the manifest, and the plugin in agent-plugins/claude. */
function probeMarketplace(dir, { manifest, name, label }) {
  writeJson(path.join(dir, '.claude-plugin', manifest), {
    name,
    owner: { name: 'plugin lane' },
    plugins: [{ name: 'omega', source: './agent-plugins/claude', description: `probe plugin (${label})` }],
  });
  const plugin = path.join(dir, 'agent-plugins', 'claude');
  writeJson(path.join(plugin, '.claude-plugin', 'plugin.json'), { name: 'omega', description: `probe plugin (${label})`, version: PROBE_VERSION });
  writeJson(path.join(plugin, 'hooks', 'hooks.json'), {
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `printf '%s\\n' ${label} >> "${LOADS}"` }] }] },
  });
}

/** The published copy: a git repo with one Conventional commit, which every GitHub URL for this repo reaches. */
function publishedRepo() {
  const src = path.join(FIXTURES, 'published-src');
  const bare = path.join(FIXTURES, 'published.git');
  gitRepo(src);
  probeMarketplace(src, { manifest: 'marketplace.json', name: 'omega', label: PUB });
  commit(src, 'chore(fixture): publish the probe plugin');
  must('git', ['init', '-q', '--bare', bare]);
  must('git', ['-C', src, 'push', '-q', bare, 'HEAD:refs/heads/main']);

  const github = ['https://github.com/Omega-JS-Stack/omega.git', 'https://github.com/Omega-JS-Stack/omega', 'git@github.com:Omega-JS-Stack/omega.git', 'ssh://git@github.com/Omega-JS-Stack/omega.git'];
  fs.writeFileSync(GITCONFIG, `[url "${pathToFileURL(bare).href}"]\n${github.map((url) => `\tinsteadOf = ${url}\n`).join('')}`);
}

/** The fixture monorepo: shaped like this one (so a brand links into it), both manifests, this repo's omega keys. */
function monorepo() {
  const dir = path.join(FIXTURES, 'monorepo');
  gitRepo(dir);
  writeJson(path.join(dir, 'package.json'), { name: 'omega', private: true, workspaces: ['packages/*'] });
  writeJson(path.join(dir, 'packages', 'devkit', 'package.json'), { name: '@omega.js/devkit', version: PROBE_VERSION });
  writeJson(path.join(dir, 'packages', 'manager', 'package.json'), { name: '@omega.js/manager', version: PROBE_VERSION });
  probeMarketplace(dir, { manifest: 'marketplace.json', name: 'omega', label: LOC });
  probeMarketplace(dir, { manifest: 'marketplace.local.json', name: 'omega-local', label: LOC });

  const real = readJson(path.join(ROOT, '.claude', 'settings.json'));
  const local = real.extraKnownMarketplaces && real.extraKnownMarketplaces['omega-local'];
  if (!local) throw new Error('this repo\'s .claude/settings.json declares no omega-local marketplace');
  writeJson(path.join(dir, '.claude', 'settings.json'), {
    extraKnownMarketplaces: { 'omega-local': local },
    enabledPlugins: { 'omega@omega-local': real.enabledPlugins['omega@omega-local'], 'omega@omega': real.enabledPlugins['omega@omega'] },
  });
  return dir;
}

/** A brand exactly as the settings writer leaves it; a linked one has its manager linked into the fixture monorepo. */
function brand(name, linkedTo) {
  const dir = path.join(FIXTURES, name);
  gitRepo(dir);
  // The manifest onboarding scaffolds: a declared manager is what tells a linked brand from a live one
  writeJson(path.join(dir, 'package.json'), { name, private: true, devDependencies: { '@omega.js/manager': PROBE_VERSION } });
  if (linkedTo) {
    fs.mkdirSync(path.join(dir, 'node_modules', '@omega.js'), { recursive: true });
    fs.symlinkSync(path.join(linkedTo, 'packages', 'manager'), path.join(dir, 'node_modules', '@omega.js', 'manager'));
  }
  const verdict = ensureClaudeSettings(dir);

  const privateFile = path.join(dir, '.claude', 'settings.local.json');
  const manifest = linkedTo && path.join(linkedTo, '.claude-plugin', 'marketplace.local.json');
  if (linkedTo && (!fs.existsSync(privateFile) || readJson(privateFile).extraKnownMarketplaces['omega-local'].source.path !== manifest)) {
    throw new Error(`the writer did not point ${name}'s private file at ${manifest}: ${JSON.stringify(verdict)}`);
  }
  return dir;
}

/** A fresh config folder that trusts every project, with the published copy installed by the real helper. */
async function consumerMachine(name, projects, emptyDir) {
  const home = path.join(HOMES, name);
  writeJson(path.join(home, '.claude.json'), {
    hasCompletedOnboarding: true,
    projects: Object.fromEntries(projects.map((dir) => [fs.realpathSync(dir), { hasTrustDialogAccepted: true }])),
  });
  await onMachine(home, emptyDir, () => ensureMachinePlugin({ familyVersion: PROBE_VERSION }));

  const installed = JSON.parse(must('claude', ['plugin', 'list', '--json'], { cwd: emptyDir, env: claudeEnv(home) }));
  if (!installed.some((entry) => entry.id === 'omega@omega' && entry.scope === 'user' && entry.enabled)) {
    throw new Error(`the install did not leave omega@omega installed and on for the user: ${JSON.stringify(installed)}`);
  }
  return home;
}

/** The real switch `omega i local` runs, on top of a consumer machine. */
async function developerMachine(home, monorepoDir, emptyDir) {
  await onMachine(home, emptyDir, () => ensureLocalDefault({ monorepoRoot: monorepoDir }));

  // The switch warns instead of throwing, so the lane checks what it left behind
  const records = JSON.parse(must('claude', ['plugin', 'marketplace', 'list', '--json'], { cwd: emptyDir, env: claudeEnv(home) }));
  const local = records.find((record) => record.name === 'omega-local');
  const manifest = path.join(monorepoDir, '.claude-plugin', 'marketplace.local.json');
  const enabled = readJson(path.join(home, 'settings.json')).enabledPlugins || {};
  if (!local || local.path !== manifest || enabled['omega@omega-local'] !== true || enabled['omega@omega'] !== false) {
    throw new Error(`the switch did not leave omega-local registered and on, omega@omega off: ${JSON.stringify({ records, enabled })}`);
  }
  return home;
}

// ─── The matrix ──────────────────────────────────────────────────────────────

/** One headless session: which copy (or copies) its SessionStart hook reported, and how claude exited. */
function session(home, dir) {
  fs.writeFileSync(LOADS, '');
  const run = spawnSync('claude', ['-p', 'hi'], { cwd: dir, env: claudeEnv(home), encoding: 'utf8', timeout: SESSION_TIMEOUT_MS });
  const labels = [...new Set(fs.readFileSync(LOADS, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean))];
  const exit = run.error ? `${run.error.code || run.error.message}` : `${run.status ?? run.signal}`;
  return { loaded: labels.length ? labels.sort().join(' + ') : 'nothing', exit };
}

function walk(machine, home, rows) {
  const results = [];
  rows.forEach(([where, dir, expected], index) => {
    const { loaded, exit } = session(home, dir);
    const pass = loaded === expected;
    results.push({ machine, row: index + 1, where, expected, loaded, exit, pass });
    const name = `${machine} row ${index + 1}, ${where}`;
    if (pass) stepsLog.pass(name, `loaded ${loaded}`);
    else stepsLog.fail(name, `expected ${expected}, loaded ${loaded}, claude exit ${exit}`);
    console.log(`  [${index + 1}/${rows.length}] ${pass ? '✓' : '✗'} ${where}: ${loaded}`);
  });
  return results;
}

function table(title, results) {
  console.log(`\n${title}\n`);
  console.log('| # | Session in | Expected | Loaded at session start |');
  console.log('|---|---|---|---|');
  for (const r of results) console.log(`| ${r.row} | ${r.where} | ${r.expected} | ${r.pass ? r.loaded : `**${r.loaded}** (claude exit ${r.exit})`} |`);
}

async function main() {
  if (spawnSync('claude', ['--version'], { encoding: 'utf8' }).status !== 0) {
    console.log('⏭ SKIPPED: claude is not on this machine');
    console.log('   install it with `npm install -g @anthropic-ai/claude-code`\n');
    return;
  }

  // Every machine starts from a fresh config folder; the steps log is already this run's
  fs.rmSync(HOMES, { recursive: true, force: true });
  FIXTURES = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-plugin-lane-')));
  console.log(`\nPlugin lane on ${spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim()}, config folders in ${path.relative(ROOT, LANE)}/, projects in ${FIXTURES}`);

  publishedRepo();
  const mono = monorepo();
  const live1 = brand('live-brand-1');
  const live2 = brand('live-brand-2');
  const linked = brand('linked-brand', mono);
  const empty = path.join(FIXTURES, 'empty-folder');
  gitRepo(empty);
  const projects = [empty, live1, live2, linked, mono];

  // A consumer machine never runs `omega i local`, so it has no linked brand and no monorepo
  console.log('\nConsumer machine (the published copy installed for the user)');
  const consumer = walk('consumer', await consumerMachine('consumer', projects, empty), [
    ['an empty folder', empty, PUB],
    ['live brand 1', live1, PUB],
    ['live brand 1 again', live1, PUB],
    ['live brand 2', live2, PUB],
    ['the empty folder again', empty, PUB],
  ]);

  console.log('\nDeveloper machine (the real switch: the local copy is the user default)');
  const developerHome = await developerMachine(await consumerMachine('developer', projects, empty), mono, empty);
  const developer = walk('developer', developerHome, [
    ['an empty folder', empty, LOC],
    ['live brand 1', live1, PUB],
    ['a linked brand', linked, LOC],
    ['live brand 1 again', live1, PUB],
    ['the monorepo', mono, LOC],
    ['live brand 2', live2, PUB],
    ['the empty folder again', empty, LOC],
  ]);

  table('Consumer machine', consumer);
  table('Developer machine', developer);

  const failed = [...consumer, ...developer].filter((r) => !r.pass);
  if (failed.length) {
    console.log(`\n✗ Plugin lane: ${failed.length} row(s) loaded the wrong copy:`);
    for (const r of failed) console.log(`  ${r.machine} row ${r.row}, ${r.where}: expected ${r.expected}, loaded ${r.loaded}, claude exit ${r.exit}`);
    console.log(`  the projects are kept for a look: ${FIXTURES}`);
    process.exitCode = 1;
    return;
  }
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  console.log('\n✓ Plugin lane: every session loaded the expected copy\n');
}

main().catch((error) => {
  stepsLog.abort(error);
  console.error(`\nPlugin lane crashed: ${error.stack}\n${FIXTURES ? `the projects are kept for a look: ${FIXTURES}\n` : ''}`);
  process.exitCode = 1;
});
