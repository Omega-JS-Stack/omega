// The signing box's OWN configuration: `<runner home>\.env`.
//
// The Windows signing runner is a MACHINE, not a brand: the EV token, its PIN,
// the signtool path, the GitHub token that registers the runner and the orgs it
// serves all belong to the box. They live in one file beside the install —
// `%LOCALAPPDATA%\omega-runner\.env` — which `omega runner` and `omega
// sign-windows` read from whatever directory they run in: this monorepo, a
// consumer brand, a bare `npm i -g @omega.js/desktop`. No brand's `.env` ever
// holds the box's PIN ([#337](https://github.com/Omega-JS-Stack/omega/issues/337)).
//
// Precedence: a value the shell already carries, or a CI job delivers, WINS over
// the file (an empty delivered value counts as absent, the same rule
// sanitize-signing-env applies). The file survives `runner uninstall`: it is
// configuration, not install state.
//
// A required key that is still missing is asked for — in an interactive
// terminal, through the one prompt wrapper every OMEGA package uses — and the
// answer is written back to the file. Off a TTY, or when the answer is empty,
// the command REFUSES, naming the file and the keys: a runner never boots half
// configured.
//
// `install` and `config` run the SAME walk: every key of both scopes, in
// schema order, each question DEFAULTING to the current value — the file's,
// else what the shell or CI delivered, else the key's suggestion. A shell
// value never skips a question (that is how Ian's box registered against an
// exported org list it was never shown, 2026-09-04). A secret never echoes:
// an empty answer keeps what is saved.
//
// The orgs are the one answer nobody types from memory, so they are PICKED:
// a checkbox of every org the token administers, ticked to what this box
// already answered — the saved list, else the orgs it registered, else
// NOTHING. A token that administers 35 orgs must never register 35 runners
// on one Enter.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// Runner files live under %LOCALAPPDATA%\omega-runner — a per-user path that
// doesn't need admin to read/write. Set OMEGA_RUNNER_HOME to override.
function defaultRunnerHome(platform, env) {
  platform = platform || process.platform;
  env      = env || process.env;
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'omega-runner');
  }
  return path.join(process.cwd(), '.gh-runners');
}

function runnerEnvFile(home) {
  return path.join(home, '.env');
}

// The env schema (@omega.js/config) owns each key's secrecy and its one-line
// meaning; the runner adds what is required HERE and how to ask for it. The
// two runner-only keys (the org list, the timestamp server) are not delivery
// keys of any target, so they carry their own text.
function schemaEntry(name) {
  try {
    return require('@omega.js/config/env-schema').ENV_SCHEMA.find((e) => e.name === name) || null;
  } catch (e) {
    return null;
  }
}

const RUNNER_ENV_SCHEMA = [
  {
    key:      'GH_TOKEN',
    required: true,
    secret:   true,
    scope:    'runner',
    prompt:   'GitHub classic PAT (repo + workflow + admin:org) that registers this box as a runner',
    comment:  'GitHub classic PAT with repo + workflow + admin:org (registers the runner).',
  },
  {
    key:      'OMEGA_RUNNER_ORGS',
    required: false,
    secret:   false,
    scope:    'runner',
    prompt:   'Orgs to register against, comma-separated (empty = EVERY org the token administers)',
    comment:  'Orgs to register against, comma-separated. Empty = every org the token administers.',
  },
  {
    key:      'WIN_EV_TOKEN_PATH',
    required: true,
    secret:   false,
    scope:    'signing',
    prompt:   'EV cert: SHA1 thumbprint (SafeNet/eToken) or path to a .pfx',
    comment:  'The EV cert: its SHA1 thumbprint (SafeNet/eToken) or a path to a .pfx.',
  },
  {
    key:      'WIN_CSC_KEY_PASSWORD',
    required: true,
    secret:   true,
    scope:    'signing',
    prompt:   'Token PIN (typed into the SafeNet Token Logon dialog for you)',
    comment:  'The token PIN — typed into the SafeNet Token Logon dialog for you.',
  },
  {
    key:      'SIGNTOOL_PATH',
    required: true,
    secret:   false,
    scope:    'signing',
    prompt:   'Full path to signtool.exe',
    comment:  'Full path to signtool.exe (Windows SDK / VS Build Tools).',
    suggest:  () => detectSigntool(),
  },
  {
    key:      'WIN_TIMESTAMP_URL',
    required: false,
    secret:   false,
    scope:    'signing',
    prompt:   'RFC 3161 timestamp server',
    comment:  'RFC 3161 timestamp server. Default: http://timestamp.sectigo.com',
    optionalComment: true,
  },
].map((entry) => {
  const schema = schemaEntry(entry.key);
  return { ...entry, secret: schema ? schema.secret : entry.secret, description: schema?.description || entry.comment };
});

const RUNNER_ENV_KEYS = RUNNER_ENV_SCHEMA.map((e) => e.key);

// The file `runner install` lays down when the box has none yet.
const RUNNER_ENV_TEMPLATE = [
  '# omega-runner — THIS BOX\'s signing configuration. Never a brand\'s .env.',
  '# Read by `omega runner` and `omega sign-windows` from any directory. A value',
  '# already set in the shell, or delivered by a CI job, wins over this file.',
  '# Survives `omega runner uninstall`. A missing required key is asked for.',
  '',
  ...RUNNER_ENV_SCHEMA.flatMap((e) => [`# ${e.comment}`, `${e.optionalComment ? '# ' : ''}${e.key}=""`]),
  '',
].join('\n');

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

// The ONE reading of OMEGA_RUNNER_ORGS — comma or space separated — shared by
// the question, install's filter and the drift check, so the three can never
// disagree about what the key says.
function parseRunnerOrgs(value) {
  return String(value || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

// Two org lists naming the same orgs. GitHub org names are case-insensitive,
// and the order a checkbox returns is not meaningful.
function sameRunnerOrgs(a, b) {
  const set = (list) => new Set((list || []).map((o) => String(o).toLowerCase()));
  const [x, y] = [set(a), set(b)];
  return x.size === y.size && [...x].every((o) => y.has(o));
}

// The newest signtool.exe the Windows SDK installed, or null. Only a SUGGESTION
// for the prompt — the file names the one the box uses.
function detectSigntool(env) {
  env = env || process.env;
  if (process.platform !== 'win32') return null;
  const root = path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  let versions;
  try {
    versions = fs.readdirSync(root).filter((name) => /^\d+(\.\d+)+$/.test(name));
  } catch (e) {
    return null;
  }
  const byVersion = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    }
    return 0;
  };
  for (const version of versions.sort(byVersion)) {
    const candidate = path.join(root, version, 'x64', 'signtool.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Read the file into `env` (process.env by default) — only keys the environment
// does not already carry a value for, and only non-empty values from the file.
// Returns what happened, so callers can say which file was read and what it set.
function loadRunnerEnv(options) {
  const { home, env = process.env, platform } = options || {};
  const root = home || env.OMEGA_RUNNER_HOME || defaultRunnerHome(platform, env);
  const file = runnerEnvFile(root);

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { file, present: false, applied: [], skipped: [] };
  }

  const parsed = require('dotenv').parse(raw);
  const applied = [];
  const skipped = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (isBlank(value)) continue;
    if (!isBlank(env[key])) { skipped.push(key); continue; }   // shell / CI wins
    env[key] = value;
    applied.push(key);
  }
  return { file, present: true, applied, skipped };
}

// The file's OWN values, whatever the environment carries. The walk defaults
// each question to what the BOX saved, not to what this shell exported, so it
// needs the file read apart from the merge loadRunnerEnv does. Same reader
// (dotenv) either way — quoting lives in one place.
function readRunnerEnvValues(home) {
  try {
    return require('dotenv').parse(fs.readFileSync(runnerEnvFile(home), 'utf8'));
  } catch (e) {
    return {};
  }
}

// Where the box records what its runner commands did — beside the install, not
// in whatever directory the command was typed in.
function runnerLogFile(home) {
  return path.join(home, 'logs', 'runner.log');
}

// Is this process a TEST run? `OMEGA_TEST_RUNNER` is set by `omega test` for the
// whole run (and inherited by the electron/boot children); `OMEGA_TEST_MODE` is
// the canonical signal those children already carried. Either one means: no
// command here may touch the machine's real runner home.
//
// It reads process.env, ALWAYS, and takes no environment argument. An injected
// env is a fixture for the config walk — a case that passed `{}` would be
// handing the safety check an environment with no marker in it and disarming
// the very guard that exists because a case did something like that.
function isTestRun() {
  return process.env.OMEGA_TEST_RUNNER === '1' || process.env.OMEGA_TEST_MODE === 'true';
}

// A home a test is allowed to act on: a `.temp` directory (the desktop suites'
// per-run scratch) or one under the OS temp dir (`mkdtemp`, what most cases use).
// Neither can ever be `%LOCALAPPDATA%\omega-runner`.
//
// A path rule, not a home rule: `assertTestSafeRunnerHome` asks it about the
// Startup folder too, and the same two shapes are the safe answer there.
function isScratchRunnerHome(home) {
  const resolved = path.resolve(String(home || ''));
  if (resolved.split(path.sep).includes('.temp')) return true;
  return safeRealpath(resolved).startsWith(`${safeRealpath(os.tmpdir())}${path.sep}`);
}

// realpath so /var/folders/… and its /private/var/… twin (macOS) compare equal;
// a path that does not exist yet answers as itself.
function safeRealpath(target) {
  try {
    return fs.realpathSync(target);
  } catch (e) {
    return path.resolve(target);
  }
}

// The refusal that makes 2026-09-04 impossible to repeat: a test process asked a
// MUTATING box command to act on a surface that is not a scratch. It happened —
// `runner install` from the suite, with no home of its own, tore the signing
// box's runner down and registered 34 orgs — so this is a hard stop, not a warn.
//
// EVERY surface the command could reach is checked, and the refusal names the
// one that is real. There are THREE:
//   1. the passed `_home`,
//   2. the module-level `RUNNER_HOME` — every subcommand honours a passed
//      `_home` now, but the command module's `loadRunnerEnv({ home: RUNNER_HOME })`
//      runs at REQUIRE time, so a process whose RUNNER_HOME is the box's already
//      has the box's token and PIN in its environment and a scratch `_home`
//      alone proves nothing,
//   3. the Startup folder (`STARTUP_DIR`) — added after the SECOND incident,
//      2026-09-04: the round-4 `uninstall` case ran with both homes scratch, and
//      `uninstall` swept the REAL Startup folder anyway, deleting the box's three
//      `omega-runner-*.cmd` shortcuts. A home scopes nothing machine-wide, so the
//      folder needs its own scratch seam (`OMEGA_RUNNER_STARTUP_DIR`) and its own
//      place in this check.
//
// It is checked before the platform gate: "a test may not touch this machine"
// is true on every platform, and the box is the one machine where the platform
// gate would have let it through.
//
// @param {string} verb - The subcommand, for the message.
// @param {...string} surfaces - Every home + Startup folder this run could act on.
function assertTestSafeRunnerHome(verb, ...surfaces) {
  if (!isTestRun()) return;

  const offender = surfaces.filter(Boolean).find((surface) => !isScratchRunnerHome(surface));
  if (!offender) return;

  throw new Error(
    `Refusing \`runner ${verb}\` against ${offender}: this process is a test run (OMEGA_TEST_RUNNER / OMEGA_TEST_MODE), `
    + 'and a test may only act on scratch surfaces — the runner home AND the Startup folder, each under a `.temp` directory or the OS temp dir. '
    + 'Point OMEGA_RUNNER_HOME and OMEGA_RUNNER_STARTUP_DIR at scratch ones before the command module is required.',
  );
}

// Lay the template down when the box has no file yet. Returns true when written.
function ensureRunnerEnvFile(home) {
  const file = runnerEnvFile(home);
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(file, RUNNER_ENV_TEMPLATE);
  return true;
}

// Write values into the file IN PLACE: an existing `KEY=` line (commented or
// not) is replaced, a key the file never had is appended. Comments and order
// survive, so the file stays the one a person reads.
function writeRunnerEnvValues(home, values) {
  // Every value double-quoted, the one .env quoting rule this repo writes
  // everywhere. dotenv reads a double-quoted value back verbatim and has no
  // escape for a `"` inside one, so a value carrying one cannot be written at
  // all: refuse it — naming the key and the character — before the file is
  // touched, rather than save a value that reads back wrong.
  const serialize = (key, value) => `${key}="${value}"`;
  for (const [key, value] of Object.entries(values)) {
    if (String(value).includes('"')) {
      throw new Error(`${key} contains a double quote (") — a .env value cannot carry one. Remove it, then set ${key} again.`);
    }
  }

  ensureRunnerEnvFile(home);
  const file  = runnerEnvFile(home);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const seen  = new Set();

  const out = lines.map((line) => {
    const m = /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (!m || !(m[1] in values) || seen.has(m[1])) return line;
    seen.add(m[1]);
    return serialize(m[1], String(values[m[1]]));
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) out.push(serialize(key, String(value)));
  }
  fs.writeFileSync(file, out.join('\n').replace(/\n*$/, '\n'));
  return file;
}

// ─── the runner's private HOME (#807) ───────────────────────────────────────────
//
// `actions/checkout` copies `path.join(process.env.HOME || os.homedir(),
// '.gitconfig')` into the temporary HOME it runs git under, with `@actions/io`,
// which recreates a SYMLINK source as a Windows JUNCTION. A junction to a FILE
// is invalid, so on a box whose `~/.gitconfig` is a symlink (dotfiles, and it
// must stay one) the copied file is unreadable and every git call in the job
// dies on "unknown error occurred while reading the configuration files".
//
// HOME wins in that lookup, so the runner is given a home of its OWN, inside
// RUNNER_HOME, holding a real `.gitconfig`. Nothing outside RUNNER_HOME is
// touched and the user's dotfiles symlink is left exactly as it is.
function runnerPrivateHome(home) {
  return path.join(home, 'home');
}

// The one setting the workflows rely on, and the only one this file carries:
// checkouts must not rewrite line endings on the way in.
const RUNNER_PRIVATE_GITCONFIG = '[core]\n\tautocrlf = false\n';

// Create the private home and its `.gitconfig`. A file that is already there
// with different content is KEPT and named in a log line: a person may have
// edited it on the box, and delivering one setting is never worth overwriting
// someone's file. Returns the home, the file, and whether it was written.
function ensureRunnerPrivateHome(home, options) {
  const { logger } = options || {};
  const root = runnerPrivateHome(home);
  const file = path.join(root, '.gitconfig');
  fs.mkdirSync(root, { recursive: true });

  let existing;
  try {
    existing = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fs.writeFileSync(file, RUNNER_PRIVATE_GITCONFIG);
    return { home: root, file, written: true };
  }

  if (existing !== RUNNER_PRIVATE_GITCONFIG && logger) {
    logger.log(`Kept ${file} as it is: it is not the file this command writes, so it is someone's own. Add \`[core] autocrlf = false\` to it by hand if a checkout ever rewrites line endings.`);
  }
  return { home: root, file, written: false };
}

// The runner's OWN environment file, `<runner dir>\.env`: the file GitHub
// documents for proxy settings, one `KEY=value` per line, which the listener
// reads at startup and applies to every job it runs. One write therefore
// reaches the detached spawn and the Startup shortcut alike.
//
// The value is written BARE, not in the double-quoted form the box's own `.env`
// uses: the listener takes the rest of the line verbatim, so quotes would end
// up inside the value. An existing `KEY=` line is rewritten in place and every
// other line survives, in the endings the file already uses (LF for a new one),
// so running it twice is running it once.
function ensureRunnerDirEnv(runnerDir, values) {
  const file = path.join(runnerDir, '.env');

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    raw = '';
  }

  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const seen = new Set();
  // The file's REAL lines. An empty file has none at all (splitting one yields
  // a single empty string, which would push the first key onto a second line),
  // and a written file ends with a newline, whose trailing empty element an
  // append would land below: a blank line before the new key, one more on
  // every rewrite. The terminator is put back by the write below.
  const lines = raw === '' ? [] : raw.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();

  const out = lines.map((line) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (!m || !(m[1] in values) || seen.has(m[1])) return line;
    seen.add(m[1]);
    return `${m[1]}=${values[m[1]]}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }

  fs.mkdirSync(runnerDir, { recursive: true });
  fs.writeFileSync(file, out.join(newline).replace(/(\r?\n)*$/, newline));
  return file;
}

// Which of the box's keys currently carry a value — names only, never values.
function runnerEnvReport(env) {
  env = env || process.env;
  return RUNNER_ENV_SCHEMA.map(({ key, required, scope }) => ({ key, required, scope, set: !isBlank(env[key]) }));
}

// The ONE refusal a half-configured box gets, wherever it is caught: the keys,
// the file to fill them in, and whether there was a terminal to ask in.
function missingKeysError(keys, file, isTTY) {
  const one   = keys.length === 1;
  const noTTY = isTTY ? '' : ' (no terminal to ask in)';
  return new Error(
    `${keys.join(', ')} ${one ? 'is' : 'are'} not set. Fill ${one ? 'it' : 'them'} in ${file}${noTTY} — the runner does not start half configured.`,
  );
}

// Make sure every required key of `scopes` has a value, asking for the missing
// ones in an interactive terminal and writing the answers to the file. Throws
// — naming the file and the keys — when any is still missing afterwards, so no
// caller ever runs half configured.
//
// This is the step for the commands that only need the box to WORK — `start`,
// `register-org`, `sign-windows`. The commands that CONFIGURE it (`install`,
// `config`) run reconfigureRunnerEnv below, which asks for everything.
//
// `prompt` and `interactive` are injected by the tests; the real ones are the
// devkit prompt wrapper (input / password) and its TTY check.
async function ensureRunnerConfig(options) {
  const {
    home,
    env = process.env,
    scopes = ['runner', 'signing'],
    logger,
    interactive,
    prompt,
  } = options || {};
  const root = home || env.OMEGA_RUNNER_HOME || defaultRunnerHome(undefined, env);
  const file = runnerEnvFile(root);

  if (ensureRunnerEnvFile(root) && logger) {
    logger.log(`Wrote ${file} — this box's signing configuration. It survives uninstall.`);
  }
  loadRunnerEnv({ home: root, env });

  const wanted  = RUNNER_ENV_SCHEMA.filter((e) => scopes.includes(e.scope));
  const missing = () => wanted.filter((e) => e.required && isBlank(env[e.key]));

  const prompts = prompt || require('@omega.js/devkit/prompt');
  const isTTY   = interactive === undefined ? prompts.isInteractive() : interactive;
  const asked   = [];

  if (isTTY && missing().length > 0) {
    if (logger) logger.log(`This box's signing configuration (${file}) is missing ${missing().map((e) => e.key).join(', ')} — asking now. Answers are saved to that file.`);
    const answers = {};
    for (const entry of wanted) {
      if (!entry.required || !isBlank(env[entry.key])) continue;
      const suggestion = entry.suggest ? entry.suggest() : undefined;
      const message    = `${entry.key} — ${entry.prompt}:`;
      const validate   = (v) => (isBlank(v) ? `${entry.key} is required` : true);
      const answer = entry.secret
        ? await prompts.password({ message, mask: '*', validate })
        : await prompts.input({ message, default: suggestion || undefined, validate });
      const value = String(answer || '').trim();
      if (isBlank(value)) continue;
      answers[entry.key] = value;
      env[entry.key] = value;
      asked.push(entry.key);
    }
    if (asked.length > 0) writeRunnerEnvValues(root, answers);
  }

  const still = missing();
  if (still.length > 0) throw missingKeysError(still.map((e) => e.key), file, isTTY);

  return { file, asked };
}

// The orgs question itself: a checkbox of every org the token administers,
// ticked to what this box already answered — the saved list, else the orgs it
// registered, else nothing. Nothing ticked by default is the point: a token
// that administers 35 orgs would otherwise register 35 runners on one Enter.
// Zero chosen is still refused — a runner registered against no org signs
// nothing. A token that administers nothing gets one warn line and no
// question. Returns `{ admin, chosen }` — the walk the caller can reuse, and
// the picked orgs (null when nothing was asked).
async function askRunnerOrgs(options) {
  const { current = [], prompts, logger, discoverOrgs } = options || {};
  // Asking without a way to LIST them is a wiring bug, never a runtime case:
  // the octokit call lives in runner.js, so every asking caller passes it in.
  if (typeof discoverOrgs !== 'function') {
    throw new Error('The orgs question needs a discoverOrgs function — the caller wires it (runner.js passes discoverAdminOrgs).');
  }
  const admin = await discoverOrgs();
  if (admin.length === 0) {
    if (logger) logger.warn('GH_TOKEN administers no orgs — skipping the OMEGA_RUNNER_ORGS question. Fix the token\'s admin:org scope, then run `npx omega runner config`.');
    return { admin, chosen: null };
  }
  const ticked = new Set(current.map((o) => String(o).toLowerCase()));

  // An org this box already answered for that the token cannot admin any more
  // never appears in the list below, so say why it is gone before it silently
  // disappears: admin lost, the org renamed, or a different token in the shell.
  const adminSet = new Set(admin.map((o) => o.toLowerCase()));
  const dropped  = current.filter((o) => !adminSet.has(String(o).toLowerCase()));
  if (dropped.length > 0 && logger) {
    logger.warn(`Not offered below: ${dropped.join(', ')} — this GH_TOKEN no longer administers ${dropped.length === 1 ? 'it' : 'them'} (admin lost, or the org was renamed).`);
  }

  const chosen = await prompts.checkbox({
    message: 'OMEGA_RUNNER_ORGS — which orgs does this box sign for? (space toggles, Enter confirms)',
    // Alphabetical, case-insensitively: GitHub returns membership order, which
    // is no order at all when scanning 35 names for the three you want.
    choices: [...admin]
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
      .map((org) => ({ name: org, value: org, checked: ticked.has(org.toLowerCase()) })),
  });
  if (!chosen || chosen.length === 0) {
    throw new Error('OMEGA_RUNNER_ORGS: pick at least one org — a runner registered against nothing is not a runner.');
  }
  return { admin, chosen };
}

// The walk `install` and `config` share: the whole file, asked. Every key of
// both scopes in schema order, each question defaulting to the CURRENT value —
// the file's, else what the shell or CI delivered, else the key's suggestion —
// then the orgs checkbox. An empty answer KEEPS that current value (which is
// how a saved secret survives a walk it never echoes, and how a shell-only
// value gets written into the file); every key the walk ends with a value for
// is written, kept or typed, and it is written before the orgs question, which
// can refuse.
//
// Off a TTY nothing can be asked: `config` exists only to ask, so it says so
// (`requireTerminal`); install's walk falls back to the same required-key
// check every other command makes, so a CI box that carries its values in the
// shell still installs.
async function reconfigureRunnerEnv(options) {
  const {
    home,
    env = process.env,
    logger,
    interactive,
    prompt,
    discoverOrgs,
    registeredOrgs = [],
    requireTerminal = false,
  } = options || {};
  const root = home || env.OMEGA_RUNNER_HOME || defaultRunnerHome(undefined, env);
  const file = runnerEnvFile(root);

  if (ensureRunnerEnvFile(root) && logger) {
    logger.log(`Wrote ${file} — this box's signing configuration. It survives uninstall.`);
  }
  loadRunnerEnv({ home: root, env });
  const saved = readRunnerEnvValues(root);

  const prompts = prompt || require('@omega.js/devkit/prompt');
  const isTTY   = interactive === undefined ? prompts.isInteractive() : interactive;

  if (!isTTY) {
    if (requireTerminal) {
      throw new Error(`No terminal to ask in — edit ${file} directly, or run \`npx omega runner config\` in an interactive terminal.`);
    }
    const missing = RUNNER_ENV_SCHEMA.filter((e) => e.required && isBlank(env[e.key]));
    if (missing.length > 0) throw missingKeysError(missing.map((e) => e.key), file, false);
    return { file, answers: [], orgs: null, adminOrgs: null };
  }

  if (logger) logger.log(`This box's signing configuration (${file}) — every key, with what is saved as the default.`);

  // What a question DEFAULTS to. The file first: a value the shell exported is
  // this session's, not the box's answer, and taking it as the default is how
  // a brand's token would end up configuring the box.
  const currentOf = (entry) => {
    const value = isBlank(saved[entry.key]) ? env[entry.key] : saved[entry.key];
    return isBlank(value) ? '' : String(value).trim();
  };

  const answers = {};
  const empty   = [];
  for (const entry of RUNNER_ENV_SCHEMA) {
    if (entry.key === 'OMEGA_RUNNER_ORGS') continue;             // the checkbox below IS its question
    const current  = currentOf(entry);
    const validate = (v) => (current || !entry.required || !isBlank(v) ? true : `${entry.key} is required`);
    const answer   = entry.secret
      ? await prompts.password({ message: `${entry.key} — ${entry.prompt}${current ? ' (Enter keeps the current value)' : ''}:`, mask: '*', validate })
      : await prompts.input({ message: `${entry.key} — ${entry.prompt}:`, default: current || (entry.suggest ? entry.suggest() || undefined : undefined), validate });
    let value = String(answer || '').trim();

    // Enter KEEPS the current value — which is the answer, so it takes the same
    // path a typed one does. That matters for a value only the shell carries:
    // keeping it saves it to the box's file, secret or not (the non-secret
    // prompts already did, by handing their default back).
    if (isBlank(value)) {
      if (!current) {
        if (entry.required) empty.push(entry.key);
        continue;
      }
      value = current;
    }
    env[entry.key] = value;
    answers[entry.key] = value;
  }

  // Save EVERY answer, the kept ones included, BEFORE anything that can refuse —
  // the required-key check right below, and the orgs question after it (nothing
  // ticked, a token that cannot list, a Ctrl-C). A refusal must never cost the
  // operator the keys they just typed. Writing the kept values too is what
  // brings a file the pre-quoting code wrote up to the rule: the writer
  // serializes `KEY="value"` and is idempotent, so a walk of Enters rewrites
  // every line quoted without changing one value.
  if (Object.keys(answers).length > 0) writeRunnerEnvValues(root, answers);
  if (empty.length > 0) throw missingKeysError(empty, file, true);

  const savedOrgs = parseRunnerOrgs(saved.OMEGA_RUNNER_ORGS);
  const { admin, chosen } = await askRunnerOrgs({
    current: savedOrgs.length > 0 ? savedOrgs : registeredOrgs,
    prompts,
    logger,
    discoverOrgs,
  });
  if (chosen) {
    const value = chosen.join(',');
    if (value !== (saved.OMEGA_RUNNER_ORGS || '')) {
      answers.OMEGA_RUNNER_ORGS = value;
      writeRunnerEnvValues(root, { OMEGA_RUNNER_ORGS: value });
    }
    env.OMEGA_RUNNER_ORGS = value;
  }

  return { file, answers: Object.keys(answers), orgs: chosen, adminOrgs: admin };
}

module.exports = {
  defaultRunnerHome,
  runnerEnvFile,
  runnerLogFile,
  isTestRun,
  isScratchRunnerHome,
  assertTestSafeRunnerHome,
  detectSigntool,
  loadRunnerEnv,
  ensureRunnerEnvFile,
  writeRunnerEnvValues,
  runnerPrivateHome,
  ensureRunnerPrivateHome,
  ensureRunnerDirEnv,
  ensureRunnerConfig,
  reconfigureRunnerEnv,
  runnerEnvReport,
  parseRunnerOrgs,
  sameRunnerOrgs,
  RUNNER_ENV_SCHEMA,
  RUNNER_ENV_KEYS,
  RUNNER_ENV_TEMPLATE,
};
