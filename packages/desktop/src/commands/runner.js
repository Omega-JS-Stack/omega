// `npx omega runner <subcommand>` — Windows EV-token signing runner manager.
//
// v1.2.36+: install runs entirely at user privilege (RUNNER_HOME is in
// %LOCALAPPDATA%, no admin prompts, no UAC), and at end of install every
// registered runner is brought online detached, so the terminal it was typed
// in stays free. Auto-restart at next logon is wired up via a .cmd file in the
// user's Startup folder.
//
// Subcommands:
//   install              Idempotent setup: download actions/runner, register one
//                        runner per admin org, write each Startup shortcut. Tears
//                        down any prior install first, so re-running is safe.
//   config               Re-ask every key of the box's own .env — saved values as
//                        the defaults — and the orgs it serves. How a value that
//                        is already there gets changed.
//   register-org <org>   Register the runner against one specific GH org.
//   start                Bring EVERY registered org's runner online, detached,
//                        in Startup-shortcut order. An org already alive is
//                        named and skipped; the terminal is never taken over.
//   restart              stop, wait for every listener to go, then start.
//   stop                 Kill every Runner.Listener.exe under RUNNER_HOME.
//   status               Registered orgs, Startup shortcuts, live listeners.
//   uninstall            Remove everything — legacy services and tasks, and the
//                        electron-manager era's em-runner install, included.
//   self-update          Force an immediate self-update of @omega.js/desktop (npm i -g @omega.js/desktop@latest).
//   monitor              Tail the JSONL signing event log, pretty-printed.
//
// Every subcommand except `self-update` and `monitor` refuses on non-Windows
// (set OMEGA_RUNNER_FORCE=1 to override — testing only).

const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const jetpack  = require('fs-jetpack');

const Manager  = new (require('../build.js'));
const logger   = Manager.logger('runner');
const { safeInstall } = require('../utils/safe-install');

const RUNNER_LABELS = ['self-hosted', 'windows', 'ev-token'];

// One name, `omega-runner-<host>-<org>`, used on the GitHub side AND for the
// Startup-folder shortcut, so what you see in the org's runner list is what you
// see in the Startup folder. Capped at 64 chars — GitHub's limit on a runner name.
function ghRunnerName(org) {
  return `omega-runner-${os.hostname().toLowerCase()}-${org.toLowerCase()}`.slice(0, 64);
}
// Runner files live under %LOCALAPPDATA%\omega-runner — a per-user path that
// doesn't need admin to read/write. v1.2.16-v1.2.35 used C:\actions-runners
// (root C:) which forced UAC elevation for every install/uninstall + spawned
// the runner in a separate elevated cmd window. With per-user storage we drop
// elevation entirely: install, register-org, start, and uninstall all run in
// the user's normal terminal, and the runners they bring up are detached, so
// the terminal comes straight back. Set OMEGA_RUNNER_HOME to override.
//
// The box's own configuration — GH_TOKEN, the orgs, the cert, the PIN, signtool
// — is `<home>\.env`, read here before anything looks at process.env, so every
// subcommand works from any directory (utils/runner-env.js).
const { defaultRunnerHome, runnerEnvFile, runnerLogFile, loadRunnerEnv, ensureRunnerConfig, reconfigureRunnerEnv, runnerEnvReport, parseRunnerOrgs, sameRunnerOrgs, isTestRun, isScratchRunnerHome, assertTestSafeRunnerHome, runnerPrivateHome, ensureRunnerPrivateHome, ensureRunnerDirEnv } = require('../utils/runner-env.js');
const attachLogFile = require('../utils/attach-log-file.js');
const RUNNER_HOME = process.env.OMEGA_RUNNER_HOME || defaultRunnerHome();
loadRunnerEnv({ home: RUNNER_HOME });

// The electron-manager era of this command (`em runner`) laid the same design
// down under other names: the home was %LOCALAPPDATA%\em-runner (C:\actions-runners
// before that), and the Startup shortcuts and the GitHub-side runners were
// `em-runner-<host>-<org>`. An upgraded box still has all of it — live, and
// picking up jobs — and none of it answers to the omega names, so `status`
// names it and `uninstall` (and the teardown `install` runs first) takes it
// down through the same per-org deregistration the omega home gets
// ([#337](https://github.com/Omega-JS-Stack/omega/issues/337)).
const LEGACY_RUNNER_PREFIX = 'em-runner-';

function legacyRunnerHomes(platform, env) {
  platform = platform || process.platform;
  env      = env || process.env;
  if (platform !== 'win32') return [];
  // Windows paths whichever OS asks (the tests ask from a Mac).
  const localAppData = env.LOCALAPPDATA || path.win32.join(os.homedir(), 'AppData', 'Local');
  const systemDrive  = env.SystemDrive || 'C:';
  return [
    path.win32.join(localAppData, 'em-runner'),
    path.win32.join(`${systemDrive}${path.win32.sep}`, 'actions-runners'),
  ];
}

// The legacy homes actually on disk — never the current home, wherever
// OMEGA_RUNNER_HOME points it. `exists` is injected by the tests.
function listLegacyRunnerHomes(options) {
  const { platform, env, home, exists } = options || {};
  const current = String(home || RUNNER_HOME).toLowerCase();
  const isDir   = exists || ((p) => jetpack.exists(p) === 'dir');
  return legacyRunnerHomes(platform, env)
    .filter((dir) => dir.toLowerCase() !== current)
    .filter((dir) => isDir(dir));
}

// Each registration writes its config files at the top of its own directory, so
// one directory per org is the architecture, not a convenience.
function orgRunnerDir(org, home) {
  return path.join(home || RUNNER_HOME, `actions-runner-${org.toLowerCase()}`);
}
const ACTIONS_RUNNER_VERSION = '2.319.1';   // pinned; bump intentionally

// The subcommands, and the two of them that run on any platform: self-update is
// an npm install, monitor only reads a log file. Every other one is the box's.
const SUBCOMMANDS = {
  'install':      install,
  'config':       configureRunner,
  'register-org': registerOrg,
  'start':        startServices,
  'restart':      restartServices,
  'stop':         stopServices,
  'status':       statusServices,
  'uninstall':    uninstall,
  'self-update':  selfUpdate,
  'monitor':      monitor,
};
const ANY_PLATFORM_SUBCOMMANDS = new Set(['self-update', 'monitor']);

// The ones that CHANGE the machine: they register, deregister, download, delete,
// kill listeners, rewrite the box's own configuration, or run a global npm
// install. A test process may only point these at a scratch home
// ([#337](https://github.com/Omega-JS-Stack/omega/issues/337) — the suite once
// ran a real install against the box). `status` and `monitor` only read.
const MUTATING_SUBCOMMANDS = new Set(['install', 'config', 'register-org', 'start', 'restart', 'stop', 'uninstall', 'self-update']);

module.exports = async function (options) {
  options = options || {};
  const sub = (options._ && options._[1]) || 'status';

  const handler = SUBCOMMANDS[sub];
  if (!handler) {
    logger.error(`Unknown subcommand: "${sub}". Try one of: ${Object.keys(SUBCOMMANDS).join(', ')}.`);
    throw new Error(`Unknown runner subcommand: ${sub}`);
  }

  const home = options._home || RUNNER_HOME;

  // Before ANYTHING else, including the platform gate: a test run may not act on
  // this machine's real runner home. The box is precisely where the platform
  // gate would have let it through, which is how 34 orgs got registered by a
  // test once. The suites point OMEGA_RUNNER_HOME at a scratch; this is what
  // happens when one forgets.
  //
  // BOTH homes, even though every subcommand now honours `_home`: the
  // `loadRunnerEnv({ home: RUNNER_HOME })` at require time already read the real
  // home's `.env` into process.env, so a run whose RUNNER_HOME is the box's is
  // still carrying the box's token and PIN — a scratch `_home` alone does not
  // make that call safe.
  //
  // And the STARTUP_DIR, because a home scopes nothing machine-wide: `uninstall`
  // sweeps every `omega-runner-*.cmd` in that folder whatever home it was given,
  // which is how the round-4 case — two scratch homes, both behaving — deleted
  // the box's three real shortcuts. Off Windows it is null unless the seam names
  // one, and `.filter(Boolean)` drops it.
  if (MUTATING_SUBCOMMANDS.has(sub)) assertTestSafeRunnerHome(sub, home, RUNNER_HOME, STARTUP_DIR);

  // The platform gate BEFORE the log file: off Windows every box subcommand
  // refuses, and a refusal must not leave a runner home behind in whatever
  // directory it was typed in (off Windows that home is `<cwd>/.gh-runners`).
  // Each subcommand still calls this itself — they are also called directly.
  if (!ANY_PLATFORM_SUBCOMMANDS.has(sub)) ensureWindows();

  // The box keeps its own record of every runner command, in the runner home
  // beside the install. Its OWN tee (not the process-wide singleton): a
  // subcommand can run inside another verb's log, and an inner detach must not
  // steal the outer one's file.
  //
  // `attachInCI` because this file is the BOX's, not the workspace's: a job
  // running on the runner is exactly when the box's own record is wanted.
  // `append` because more than one process writes it: `start` returns as soon as
  // it has spawned the runners, and every `sign-windows` those listeners go on
  // to run adds to the same file.
  const tee = attachLogFile.createTee();
  tee.attach(runnerLogFile(home), { env: options._env || process.env, attachInCI: true, append: true });

  try {
    return await handler(options);
  } finally {
    tee.detach();
  }
};

// ─── install ────────────────────────────────────────────────────────────────────
async function install(options) {
  options = options || {};
  ensureWindows();
  const home = options._home || RUNNER_HOME;
  // The box's configuration comes first, and install asks for ALL of it — the
  // same walk `config` runs, every key defaulted to what the box has now, then
  // the orgs checkbox. A box that cannot answer does not install. The walk's
  // org listing comes back with it (`adminOrgs`), so step 2 below does not pay
  // for the same page of API calls twice.
  const { adminOrgs } = await reconfigureRunnerEnv({
    home,
    logger,
    prompt:         options._prompt,
    interactive:    options._interactive,
    discoverOrgs:   discoverAdminOrgs,
    registeredOrgs: readConfig(home).registeredOrgs || [],
  });
  // No admin anywhere in here: the runner home is per-user (%LOCALAPPDATA%\omega-runner),
  // config.cmd registers without --runasservice (so no SCM access), and the
  // Startup folder shortcut goes in the user's profile. Net: install runs in
  // the calling terminal at normal user privilege.

  // Idempotent by replacement: always tear down any prior install before starting —
  // the omega one, or the electron-manager one an upgraded box still runs.
  if (jetpack.exists(home) || listLegacyRunnerHomes({ home }).length > 0 || listLegacyRunnerStartupShortcuts().length > 0) {
    logger.log(`Existing runner installation detected — uninstalling first for a clean re-install...`);
    try {
      await uninstall({ ...options, _home: home });
    } catch (e) {
      logger.warn(`Pre-install uninstall hit an error (continuing anyway): ${e.message}`);
    }
  }

  logger.log(`Installing omega-runner under ${home}`);
  jetpack.dir(home);

  // 1. Download actions/runner ONCE into a template dir. Per-org dirs are cloned from this.
  // Each actions-runner directory can only register against one org (it stores config files
  // at the top of the dir), so multi-org = multi-directory + multi-service.
  const templateDir = path.join(home, '_template');
  await downloadActionsRunner(templateDir, home);

  // 2. Resolve target orgs: filter list from OMEGA_RUNNER_ORGS if set, otherwise all admin orgs.
  const allAdminOrgs = adminOrgs || await discoverAdminOrgs();   // null when the question never ran
  if (allAdminOrgs.length === 0) {
    logger.warn('Your GH_TOKEN has no orgs you can admin.');
  }

  const { orgs, filter, unmatched, filtered } = selectRunnerOrgs(allAdminOrgs, process.env.OMEGA_RUNNER_ORGS);
  if (filtered) {
    logger.log(`OMEGA_RUNNER_ORGS filter applied: ${orgs.length} matched (out of ${allAdminOrgs.length} admin orgs)`);
    if (unmatched.length > 0) logger.warn(`OMEGA_RUNNER_ORGS lists ${unmatched.length} org(s) you don't admin: ${unmatched.join(', ')}`);
  } else {
    logger.log(`Detected ${orgs.length} admin org(s) (set OMEGA_RUNNER_ORGS in .env to install against a subset): ${orgs.join(', ')}`);
  }

  // 3. For each org: clone the template dir, run config.cmd inside it, write its
  //    Startup shortcut. The runner belongs to whoever is logged in — there is no
  //    service and no task to hand a separate account to.
  logger.log(`Runners will belong to ${os.userInfo().username} (the logged-in user).`);
  const succeeded = [];
  const failedByReason = new Map();
  for (const org of orgs) {
    try {
      await registerOrg({ ...options, _home: home, _: ['runner', 'register-org', org], _templateDir: templateDir });
      succeeded.push(org);
    } catch (e) {
      const reason = e.message || String(e);
      if (!failedByReason.has(reason)) failedByReason.set(reason, []);
      failedByReason.get(reason).push(org);
    }
  }

  // 4. There is no watcher service. The one that used to auto-register new
  // admin orgs on a tick ran as NT AUTHORITY\NETWORK SERVICE in Session 0, so
  // the runners it spawned could not see the user's cert store and the Startup
  // shortcuts it wrote landed in the wrong profile. Adding a new org is a
  // `mgr runner install` away; uninstall() still tears down any leftover
  // watcher service from an older install.

  // 5. Save install metadata.
  saveConfig({
    installedAt: new Date().toISOString(),
    actionsRunnerVersion: ACTIONS_RUNNER_VERSION,
    labels: RUNNER_LABELS,
    registeredOrgs: succeeded,
    filterUsed: filter.length > 0 ? filter : null,
  }, home);

  // 6. Summarize.
  logger.log('');
  logger.log(`────── Install summary ──────`);
  logger.log(`Successfully registered: ${succeeded.length} / ${orgs.length} org(s)`);
  if (succeeded.length > 0) logger.log(`  ✓ ${succeeded.join(', ')}`);
  if (failedByReason.size > 0) {
    logger.log(`Failed: ${orgs.length - succeeded.length} org(s)`);
    for (const [reason, failedOrgs] of failedByReason) {
      logger.log(`  ✗ ${reason}`);
      logger.log(`    affected: ${failedOrgs.join(', ')}`);
    }
  }
  logger.log('');

  if (succeeded.length === 0 && orgs.length > 0) {
    logger.error(`Install failed: 0 of ${orgs.length} orgs registered. Fix the errors above, then run 'npx omega runner install' again.`);
    process.exitCode = 1;
    return;
  }

  logger.log('Install complete. Auto-restart at next logon is wired up via the Startup folder shortcut.');

  // 7. Hand off to the runner: the same all-orgs, idempotent `start` the
  // operator would run next, so an install ends with EVERY registered org
  // online and the calling terminal free. No TTY gate on it any more: a
  // detached spawn blocks nobody, so a scripted or scheduled install ends
  // online too, instead of waiting for the next interactive logon.
  if (succeeded.length > 0) {
    logger.log('');
    logger.log(`Bringing every registered runner (${succeeded.length}) online in the background. 'npx omega runner status' shows them, 'npx omega runner monitor' tails the log.`);
    logger.log('');
    await startServices({ ...options, _home: home });
  }
}

// OMEGA_RUNNER_ORGS against the orgs the token actually administers: the ones
// it names (case-insensitively), plus the names no admin org answers to. A
// blank list is not a filter — it means every admin org, which is what a box
// nobody narrowed serves.
function selectRunnerOrgs(allAdminOrgs, filterRaw) {
  const filter = parseRunnerOrgs(filterRaw);
  if (filter.length === 0) return { orgs: allAdminOrgs, filter, unmatched: [], filtered: false };
  const wanted = new Set(filter.map((o) => o.toLowerCase()));
  return {
    orgs:      allAdminOrgs.filter((o) => wanted.has(o.toLowerCase())),
    filter,
    unmatched: filter.filter((f) => !allAdminOrgs.find((a) => a.toLowerCase() === f.toLowerCase())),
    filtered:  true,
  };
}

// ─── config ─────────────────────────────────────────────────────────────────────
async function configureRunner(options) {
  options = options || {};
  ensureWindows();
  const home = options._home || RUNNER_HOME;
  const env  = options._env  || process.env;
  const log  = options._logger || logger;

  const registered = readConfig(home).registeredOrgs || [];
  const { file, orgs } = await reconfigureRunnerEnv({
    home,
    env,
    logger:          log,
    prompt:          options._prompt,
    interactive:     options._interactive,
    discoverOrgs:    options._discoverOrgs || discoverAdminOrgs,
    registeredOrgs:  registered,
    requireTerminal: true,
  });
  log.log(`Saved to ${file}.`);

  // config writes the list; only install acts on it.
  if (orgs && !sameRunnerOrgs(orgs, registered)) {
    log.log(`Run \`npx omega runner install\` to re-register against the new list.`);
  }
}

// ─── register-org ───────────────────────────────────────────────────────────────
async function registerOrg(options) {
  options = options || {};
  ensureWindows();
  const home = options._home || RUNNER_HOME;
  await ensureRunnerConfig({ home, logger, scopes: ['runner'] });
  ensureGhToken();

  const org = options._?.[2] || options.org;
  if (!org) throw new Error('Usage: npx omega runner register-org <org-name>');

  const { getOctokit } = require('../utils/github.js');
  const octokit = getOctokit();

  // Delete any existing runners on the org side that match our naming convention for
  // THIS host. Without this, re-running install accumulates orphaned runners (one per
  // failed/aborted install, one per host rename, etc.) which causes actions/runner to
  // auto-suffix the new runner's name (e.g. `-2872`) and breaks our ability to predict
  // service names. Match prefix is `omega-runner-<host>-<org>` — and the electron-manager
  // era's `em-runner-<host>-<org>`, the same box's older registration — so we never touch
  // user-created runners or runners from other hosts.
  //
  // We do this BEFORE fetching the registration token because the token is one-shot
  // and we want it fresh right before config.cmd uses it.
  const hostPrefixes  = [`omega-runner-`, LEGACY_RUNNER_PREFIX].map((p) => `${p}${os.hostname().toLowerCase()}-${org.toLowerCase()}`);
  try {
    const { data: existing } = await octokit.rest.actions.listSelfHostedRunnersForOrg({ org, per_page: 100 });
    const ours = (existing.runners || []).filter((r) => hostPrefixes.some((p) => (r.name || '').toLowerCase().startsWith(p)));
    for (const r of ours) {
      try {
        await octokit.rest.actions.deleteSelfHostedRunnerFromOrg({ org, runner_id: r.id });
        logger.log(`  Deleted stale runner ${r.name} (id=${r.id}) on ${org}`);
      } catch (e) {
        logger.warn(`  Failed to delete stale runner ${r.name} (id=${r.id}): ${e.message}`);
      }
    }
  } catch (e) {
    // 403 here means GH_TOKEN can list but not delete — surface it but continue. Worst
    // case: actions/runner auto-suffixes and the user gets a working but ugly-named runner.
    logger.warn(`  Could not list/delete existing runners for ${org}: ${e.message}`);
  }

  // Fetch a runner registration token (1-hour expiry, used immediately).
  let regToken;
  try {
    const { data } = await octokit.rest.actions.createRegistrationTokenForOrg({ org });
    regToken = data.token;
  } catch (e) {
    if (e.status === 403) {
      throw new Error(`GH_TOKEN lacks admin:org scope for ${org}. Classic PATs need 'admin:org' (full) for runner registration. Re-issue at https://github.com/settings/tokens.`);
    }
    throw e;
  }

  // Per-org actions-runner directory. Each registration writes config files at the top of
  // its dir; sharing one dir across orgs would race + clobber. Cost: ~120 MB per org on disk.
  //
  // Always nuke + re-clone from _template. Otherwise stale config (.runner, .credentials,
  // _diag/) from a prior failed/partial run sticks around — and on the next install,
  // config.cmd refuses with "Cannot configure the runner because it is already configured."
  // Reusing the dir was an attempt at idempotency that broke re-install. Fresh dir per
  // install is the only reliably-clean state.
  const runnerDir   = orgRunnerDir(org, home);
  const templateDir = options._templateDir || path.join(home, '_template');
  if (!jetpack.exists(path.join(templateDir, 'config.cmd'))) {
    throw new Error(`actions/runner template not found at ${templateDir}. Run 'npx omega runner install' first.`);
  }
  if (jetpack.exists(runnerDir)) {
    logger.log(`  Removing stale actions-runner-${org.toLowerCase()}/ before re-clone…`);
    jetpack.remove(runnerDir);
  }
  logger.log(`  Cloning actions-runner template → actions-runner-${org.toLowerCase()}/`);
  jetpack.copy(templateDir, runnerDir, { overwrite: true });

  const configCmd  = path.join(runnerDir, 'config.cmd');
  const runnerName = ghRunnerName(org);

  // config.cmd registers the runner against GH and writes .runner / .credentials
  // into the per-org dir. We do NOT pass --runasservice — service-mode runners
  // run in Session 0 (no desktop, no access to the user's CurrentUser\My cert
  // store) and signtool can't see EV certs there. The Startup-folder shortcut
  // written below is what brings the runner up, in the user's own session.
  const args = [
    '--unattended',
    '--url',          `https://github.com/${org}`,
    '--token',        regToken,
    '--name',         runnerName,
    '--labels',       RUNNER_LABELS.join(','),
    '--replace',
  ];

  // Run via `cmd.exe /c` instead of `shell: true`. .cmd files can't be spawned directly
  // by Node's CreateProcess on Windows, so we need cmd.exe as the shell — but `shell: true`
  // triggers Node 24's DEP0190 deprecation warning when args are passed as an array.
  // Explicit `cmd.exe /c <script> <args>` is the supported, warning-free path.
  //
  // stdio: 'inherit' — config.cmd's --runasservice service-install path silently
  // SKIPS service creation when stdout/stderr are piped (Node captures them and the
  // child sees no console). With inherit, the runner's banner + progress + service
  // install messages stream directly to the user's terminal and the install actually
  // happens. Discovered the hard way after several "registered but no service" rounds.
  const { spawnSync } = require('child_process');
  logger.log(`Registering against ${org} (cwd: ${runnerDir})…`);
  const r = spawnSync('cmd.exe', ['/c', configCmd, ...args], {
    cwd:      runnerDir,
    stdio:    'inherit',
    timeout:  180000,                        // 3 min — config.cmd does network + service install
  });

  if (r.error) {
    throw new Error(`Could not spawn config.cmd: ${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error(`config.cmd exited ${r.status === null ? 'null (killed)' : r.status} for ${org}. See output above.`);
  }

  // Verify config.cmd actually wrote the registration files. Without these the
  // runner can't authenticate with GH at run time.
  if (!jetpack.exists(path.join(runnerDir, '.runner')) || !jetpack.exists(path.join(runnerDir, '.credentials'))) {
    throw new Error(`config.cmd succeeded but .runner / .credentials are missing in ${runnerDir}. The runner is not configured.`);
  }

  // The runner's private HOME ([#807](https://github.com/Omega-JS-Stack/omega/issues/807)):
  // `actions/checkout` copies `$HOME\.gitconfig` into the temporary HOME it runs
  // git under, and a SYMLINK source comes back as a Windows junction, which is
  // invalid for a file. The box's `~/.gitconfig` is one, so the runner is
  // pointed at a home of its own with a real file in it. Delivered through this
  // runner's `<runner dir>\.env`, which the listener reads at startup and
  // applies to every job, so the detached spawn and the Startup shortcut both
  // get it from one write.
  const privateHome = ensureRunnerPrivateHome(home, { logger });
  ensureRunnerDirEnv(runnerDir, { HOME: privateHome.home });
  logger.log(`  HOME for ${org}: ${privateHome.home}`);

  // Write the .cmd shortcut in the user's Startup folder so Explorer auto-runs
  // it at every interactive logon (Session 1). No Task Scheduler, no admin
  // needed for the trigger.
  //
  // We do NOT spawn the runner here. install() (when invoked interactively)
  // starts every registered runner detached AFTER the registration loop
  // completes. For non-interactive invocations (e.g. someone calling
  // register-org directly from a script) the runner stays dormant until the
  // next logon fires the Startup shortcut, or until `mgr runner start` is
  // invoked.
  writeRunnerStartupShortcut({ runnerName, runnerDir });

  // Track in our config.
  const cfg = readConfig(home);
  cfg.registeredOrgs = Array.from(new Set([...(cfg.registeredOrgs || []), org]));
  saveConfig(cfg, home);

  logger.log(`✓ Registered runner '${runnerName}' for ${org} (auto-starts at logon via Startup folder)`);
}

// ─── start / stop / status ──────────────────────────────────────────────────────

// What `start` settles before it touches a listener: the box's required keys —
// asked in a terminal and refused without one, exactly like install — and then
// the orgs the .env names against the orgs this install actually registered.
// start registers nothing; it names the command that would.
async function startPreflight(options) {
  const { home, env = process.env, logger: log = logger, prompt, interactive } = options || {};
  await ensureRunnerConfig({ home, env, logger: log, prompt, interactive });

  // Heal the private HOME ([#807](https://github.com/Omega-JS-Stack/omega/issues/807)):
  // an install that predates it, or a runner dir whose `.env` was replaced, has
  // no HOME line, and the job it picks up then dies inside `actions/checkout`.
  // Every registered dir gets it here, before a single listener comes up.
  const privateHome = ensureRunnerPrivateHome(home, { logger: log });
  for (const { org, dir } of listOrgRunnerDirs(home)) {
    ensureRunnerDirEnv(dir, { HOME: privateHome.home });
    log.log(`HOME for ${org}: ${privateHome.home}`);
  }

  const named      = parseRunnerOrgs(env.OMEGA_RUNNER_ORGS);
  const registered = readConfig(home).registeredOrgs || [];
  if (named.length > 0 && !sameRunnerOrgs(named, registered)) {
    log.warn(`OMEGA_RUNNER_ORGS names ${named.join(', ')} but this install registered ${registered.join(', ') || '(none)'}. Run \`npx omega runner install\` to apply.`);
  }
}

// The shortcuts a box has, each mapped back to its org and that org's runner
// dir. The shortcut naming convention is omega-runner-<host>-<org>; the org dir
// is actions-runner-<org>. Hostname can contain dashes (e.g. desktop-ifl07vg),
// so we strip a known host prefix rather than assume the host segment is
// dash-free. `start` walks these, and `restart` waits on the same list.
function runnerStartupTargets(home) {
  const hostPrefix = `omega-runner-${os.hostname().toLowerCase()}-`;
  return listRunnerStartupShortcuts().map((runnerName) => {
    const orgName = runnerName.toLowerCase().startsWith(hostPrefix) ? runnerName.slice(hostPrefix.length) : null;
    return { runnerName, orgName, runnerDir: orgName ? orgRunnerDir(orgName, home) : null };
  });
}

// Every registered org, brought online detached, in Startup-shortcut order.
//
// A box registers one runner per org, and `start` used to bring up exactly ONE
// of them: the first shortcut, foregrounded in the calling terminal, with every
// other org left offline until the next logon
// ([#801](https://github.com/Omega-JS-Stack/omega/issues/801)). It is now the
// idempotent way to get the box online: an org whose listener is already alive
// is named and skipped (two listeners on one registration is the takeover
// storm), the rest are spawned detached, and the terminal stays free. The
// listener's own output is the JSONL log `monitor` tails, so nothing is lost by
// not foregrounding.
//
// `_spawn` and `_listeners` are injected by the tests, the same way `_home` and
// `_logger` are: neither cmd.exe nor the process scan exists off Windows.
// `_preflightDone` is `restart`'s: it settles the box config BEFORE it kills
// anything, so the walk must not run a second time here.
async function startServices(options) {
  options = options || {};
  ensureWindows();
  const home    = options._home || RUNNER_HOME;
  const log     = options._logger || logger;
  const spawnIt = options._spawn || spawnRunnerDetached;
  const listen  = options._listeners || listRunnerListenerProcessesUnder;
  if (!options._preflightDone) {
    await startPreflight({ home, env: options._env || process.env, logger: log, prompt: options._prompt, interactive: options._interactive });
  }
  const targets = runnerStartupTargets(home);
  if (targets.length === 0) {
    log.warn('No omega-runner-* Startup shortcuts installed. Run `npx omega runner install` first.');
    return;
  }
  let offline = 0;
  for (const { runnerName, orgName, runnerDir } of targets) {
    if (!runnerDir || !jetpack.exists(runnerDir)) {
      log.warn(`✗ Could not resolve runner dir from shortcut name ${runnerName}`);
      offline++;
      continue;
    }
    // Already alive: one line naming the org and its PIDs, and on to the next.
    // Not a refusal, and not a failure either, since that org IS online.
    const existing = listen(runnerDir);
    if (existing.length > 0) {
      const detail = existing.map(({ pid, sessionId }) => `PID=${pid} session=${sessionId}`).join(', ');
      // A session-0 listener is alive but useless: it fails every job it picks
      // up. Say so loudly, and name the command that replaces it. `start` still
      // skips it, because killing a listener is `stop`'s job and never a
      // start's, and the org is not counted offline for it.
      if (existing.some(({ sessionId }) => sessionId === 0)) {
        log.warn(`⚠ ${orgName} already running in SESSION 0 (${detail}): ${SESSION_0_NOTE}. Run \`npx omega runner restart\` to replace it.`);
      } else {
        log.log(`· ${orgName} already running (${detail})`);
      }
      continue;
    }
    const r = spawnIt(runnerDir, home);
    if (r.ok) {
      log.log(`✓ start ${runnerName} (PID=${r.pid})`);
    } else {
      log.warn(`✗ start ${runnerName}: ${r.message}`);
      offline++;
    }
  }
  // The exit code a script or a logon task reads: every org online, or not.
  if (offline > 0) process.exitCode = 1;
}

// stop, then start: the loop an operator ran by hand after every config change.
// The order is the point, so it is one command rather than two.
//
// Two things it settles that the two commands typed in sequence do not:
//  1. the box config walk runs FIRST, before a single listener is killed. Run
//     inside `start`, a box missing a required key would be stopped and only
//     then refused, which leaves it offline.
//  2. `taskkill` returns before the process is actually gone, so each org's dir
//     is polled until no listener stands in it. Without that wait, `start`
//     reads a dying listener as "already running" and calls a box that is on
//     its way down online.
async function restartServices(options) {
  options = options || {};
  ensureWindows();
  const home   = options._home || RUNNER_HOME;
  const log    = options._logger || logger;
  const listen = options._listeners || listRunnerListenerProcessesUnder;

  await startPreflight({ home, env: options._env || process.env, logger: log, prompt: options._prompt, interactive: options._interactive });
  await stopServices(options);

  let standing = 0;
  for (const { orgName, runnerDir } of runnerStartupTargets(home)) {
    if (!runnerDir || !jetpack.exists(runnerDir)) continue;
    const left = await waitForListenersGone({ runnerDir, listen, delay: options._delay });
    if (left.length === 0) continue;
    log.warn(`✗ ${orgName} still has a listener after stop (${left.map(({ pid }) => `PID=${pid}`).join(', ')}): not starting a second one against the same registration.`);
    standing++;
  }
  if (standing > 0) process.exitCode = 1;

  await startServices({ ...options, _preflightDone: true });
}

// How long `restart` waits for a killed listener to leave the process table:
// five seconds per org, polled. `delay` is the test's seam.
const STOP_POLL_ATTEMPTS    = 20;
const STOP_POLL_INTERVAL_MS = 250;

async function waitForListenersGone(options) {
  const { runnerDir, listen, delay, attempts = STOP_POLL_ATTEMPTS, intervalMs = STOP_POLL_INTERVAL_MS } = options || {};
  const wait = delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let left = listen(runnerDir);
  for (let attempt = 0; left.length > 0 && attempt < attempts; attempt++) {
    await wait(intervalMs);
    left = listen(runnerDir);
  }
  return left;
}

async function stopServices(options) {
  options = options || {};
  ensureWindows();
  const home = options._home || RUNNER_HOME;
  const log  = options._logger || logger;
  // Stopping = killing all Runner.Listener.exe processes whose path lives
  // under the runner home. /T also kills any Runner.Worker.exe children mid-job.
  // Startup shortcuts are left in place so a logout/login still re-spawns;
  // for a permanent stop, run `mgr runner uninstall`.
  const procs = listRunnerListenerProcessesUnder(home);
  if (procs.length === 0) {
    log.log(`No Runner.Listener.exe processes under ${home} — already stopped.`);
  } else {
    const { spawnSync } = require('child_process');
    for (const { pid, execPath } of procs) {
      const k = spawnSync('taskkill', ['/F', '/PID', String(pid), '/T'], { encoding: 'utf8' });
      if (k.status === 0) {
        log.log(`  ✓ Killed PID ${pid} (${execPath})`);
      } else {
        log.warn(`  ✗ taskkill ${pid} (exit ${k.status}): ${(k.stderr || '').trim().slice(0, 200)}`);
      }
    }
  }
}

async function statusServices(options) {
  options = options || {};
  ensureWindows();
  const home = options._home || RUNNER_HOME;
  const cfg = readConfig(home);
  logger.log(`omega-runner home: ${home}`);
  // The box's configuration — names only, never a value.
  const envFile = runnerEnvFile(home);
  // The names only, and from process.env — a passed `_home` names the FILE above
  // but its values reached this process at require time, from RUNNER_HOME's.
  const envKeys = runnerEnvReport();
  logger.log(`Box config: ${envFile}${jetpack.exists(envFile) === 'file' ? '' : ' (missing — `npx omega runner install` writes the template)'}`);
  logger.log(`  set: ${envKeys.filter((k) => k.set).map((k) => k.key).join(', ') || '(none)'}`);
  const unset = envKeys.filter((k) => !k.set).map((k) => k.key);
  if (unset.length > 0) logger.warn(`  unset: ${unset.join(', ')}`);
  // The runner's private HOME and the real `.gitconfig` it exists for
  // ([#807](https://github.com/Omega-JS-Stack/omega/issues/807)). A missing one
  // is what a job's checkout dies on, so it is named here rather than guessed.
  const privateHome = runnerPrivateHome(home);
  const gitconfig = path.join(privateHome, '.gitconfig');
  const hasGitconfig = jetpack.exists(gitconfig) === 'file';
  logger.log(`Runner HOME: ${privateHome}`);
  (hasGitconfig ? logger.log : logger.warn).call(logger, `  .gitconfig: ${hasGitconfig ? gitconfig : 'missing (`npx omega runner start` writes it)'}`);
  logger.log(`Installed: ${cfg.installedAt || '(not yet)'}`);
  logger.log(`Labels: ${(cfg.labels || RUNNER_LABELS).join(', ')}`);
  logger.log(`Registered orgs: ${(cfg.registeredOrgs || []).join(', ') || '(none)'}`);
  logger.log(`OMEGA_RUNNER_ORGS: ${parseRunnerOrgs(process.env.OMEGA_RUNNER_ORGS).join(', ') || '(blank — every admin org)'}`);
  logger.log(`Log: ${runnerLogFile(home)}`);
  logger.log('');

  // Per-org Startup shortcuts (auto-start at every logon).
  const shortcuts = listRunnerStartupShortcuts();
  if (shortcuts.length === 0) {
    logger.warn('No omega-runner-* Startup shortcuts installed.');
    logger.warn('Run `npx omega runner install` to create them — registration alone is not enough.');
  } else {
    logger.log(`Runner Startup shortcuts (${shortcuts.length}):`);
    for (const name of shortcuts) {
      logger.log(`  · ${name}.cmd → ${runnerStartupFile(name)}`);
    }
  }

  // Per-org state — the SAME derivation and rendering `monitor` prints, so the
  // two can never drift apart again.
  logger.log('');
  const report = orgRunnerReport({ home });
  if (report.length === 0) {
    logger.warn('No orgs registered. Run `npx omega runner install`.');
  } else {
    logger.log(`Per-org runner state (${report.length}):`);
    for (const { state, lines } of report) {
      const warn = state.sessionZero || state.state === 'NOT_INSTALLED';
      for (const line of lines) (warn ? logger.warn : logger.log).call(logger, line);
    }
    if (report.some((r) => r.state.sessionZero)) {
      logger.warn(`  ⚠ Kill it ('npx omega runner stop') and re-spawn from Session 1, or it will fail every job it picks up.`);
    }
    if (report.every((r) => r.state.listeners.length === 0)) {
      logger.warn('Run `npx omega runner start` to bring every registered runner online, or log out and back in.');
    }
  }

  // Machine-wide safety net: a listener under the runner home that no registered
  // org accounts for — a directory dropped from config.json, or a hand-started
  // run.cmd. `stop` and `uninstall` both reach these; nothing else names them.
  const accounted = new Set(report.flatMap((r) => r.state.listeners.map((p) => p.pid)));
  const orphans = listRunnerListenerProcessesUnder(home).filter((p) => !accounted.has(p.pid));
  if (orphans.length > 0) {
    logger.log('');
    logger.warn(`Unaccounted Runner.Listener.exe under the runner home (${orphans.length}) — no registered org claims them:`);
    for (const { pid, sessionId, execPath } of orphans) {
      logger.warn(`  · PID=${pid} session=${sessionId} ${execPath || '(path unavailable)'}`);
    }
  }

  // The electron-manager era's install (`em runner`): its home, its Startup
  // shortcuts, and any listener still running out of it. None of it answers to
  // the omega names above, so it is named here and torn down by `uninstall`.
  const legacyHomes     = listLegacyRunnerHomes({ home });
  const legacyShortcuts = listLegacyRunnerStartupShortcuts();
  if (legacyHomes.length > 0 || legacyShortcuts.length > 0) {
    logger.log('');
    logger.warn(`Legacy em-runner install detected — 'npx omega runner uninstall' (or 'install', which tears down first) deregisters and removes it:`);
    for (const legacyHome of legacyHomes) {
      const orgs = listOrgRunnerDirs(legacyHome).map((d) => d.org);
      logger.warn(`  · ${legacyHome}${orgs.length > 0 ? ` (orgs: ${orgs.join(', ')})` : ''}`);
      for (const { pid, sessionId, execPath } of listRunnerListenerProcessesUnder(legacyHome)) {
        logger.warn(`      PID=${pid} session=${sessionId} ${execPath || '(path unavailable)'} — still picking up jobs`);
      }
    }
    for (const name of legacyShortcuts) logger.warn(`  · ${runnerStartupFile(name)}`);
  }

  // Surface leftover legacy services so users can clean them up.
  const legacyServices = listActionsRunnerServices();
  if (legacyServices.length > 0) {
    logger.log('');
    logger.warn(`Legacy actions.runner.* services detected (${legacyServices.length}). Run 'npx omega runner uninstall' to remove them.`);
    for (const name of legacyServices) logger.log(`  · ${name}`);
  }

  // Surface a leftover watcher service if one is still installed from older
  // @omega.js/desktop versions — v1.2.35+ doesn't install it, but upgraders may have one.
  const watcherState = scState(WATCHER_SERVICE_NAME);
  if (watcherState !== 'NOT_INSTALLED') {
    logger.log('');
    logger.warn(`Legacy watcher service detected: ${WATCHER_SERVICE_NAME} (${watcherState}). v1.2.35+ doesn't use it. Run 'npx omega runner uninstall' to remove.`);
  }
}

// ─── uninstall ──────────────────────────────────────────────────────────────────
async function uninstall(options) {
  options = options || {};
  ensureWindows();
  const home = options._home || RUNNER_HOME;
  // No admin needed. Per-user runner-home removal, killing your own
  // Runner.Listener.exe processes, and deleting Startup-folder shortcuts all
  // work without it. Legacy cleanup paths (watcher service, Logon Tasks) still
  // need admin to delete fully — when not admin we attempt them anyway and
  // simply log warnings on failure rather than blocking the uninstall.

  // Delete each omega-runner-<host>-<org>.cmd file in the user's Startup folder
  // so the runner doesn't auto-spawn at next logon. Scoped by STARTUP_DIR, which
  // a test points at a scratch, so this one runs under a test like any other day.
  const shortcuts = listRunnerStartupShortcuts();
  for (const runnerName of shortcuts) {
    const removed = removeRunnerStartupShortcut(runnerName);
    if (removed) logger.log(`  ✓ Removed Startup shortcut: ${runnerName}.cmd`);
  }

  // A test has no machine to sweep. These three are MACHINE-WIDE and take no
  // path: an older install's watcher service, the v1.2.16–v1.2.34 logon tasks
  // (which otherwise keep spawning Session 0 zombies after an upgrade), and the
  // legacy `actions.runner.*` services from when runners registered as Windows
  // services. None has a scratch twin the way `_home` and OMEGA_RUNNER_STARTUP_DIR
  // give the home and the Startup folder one, so the only safe test behaviour is
  // not touching them — said out loud, so a run that expected a sweep sees why
  // it did not get one. All three are idempotent, so a real run re-runs clean.
  if (isTestRun()) {
    logger.log('Test run: skipping the machine-wide sweeps (services, logon tasks, legacy homes).');
  } else {
    await uninstallWatcherService();
    await uninstallLegacyLogonTasks();
    await uninstallActionsRunnerServices();
  }

  // Deregister every org-side runner, BEFORE the directories that hold the
  // registration are removed. Anything that did not come off keeps its dir.
  const { failed } = await deregisterOrgRunners({ home });

  // Kill any Runner.Listener.exe processes whose path lives under the runner home
  // BEFORE we try to remove the directory. These are usually leftovers from the
  // legacy "double-click run.cmd" workflow (foreground runners not registered as
  // a Scheduled Task or service) — uninstall otherwise has no way to know about
  // them, and their open file handles inside the runner dirs will fail
  // jetpack.remove with EPERM. Also catches Runner.Listener instances spawned by
  // a currently-running Logon Task that `schtasks /End` (above) may have raced.
  killRunnerListenerProcessesUnderHome(home);

  // Now safe to remove disk state, minus any directory still holding a live
  // registration. Retry a few times if files are locked (services release file
  // handles asynchronously after stop).
  await removeRunnerHomeWithRetry(new Set(failed.map((f) => f.dir)), home);

  // The electron-manager era's install, when this box still has one: the same
  // teardown, org by org, so its GitHub-side registrations come off too.
  const legacy = await uninstallLegacyRunnerInstalls(home);
  const stillRegistered = [...failed, ...legacy.failed];

  if (stillRegistered.length === 0) {
    logger.log('Uninstalled omega-runner.');
    return;
  }
  logger.warn(`Uninstalled omega-runner, but ${stillRegistered.length} runner(s) are STILL registered on GitHub: ${stillRegistered.map((f) => f.org).join(', ')}`);
  logger.warn(`  Their directories were kept — re-run 'npx omega runner uninstall' to retry, or delete them under each org's Settings → Actions → Runners.`);
}

// Tear down the electron-manager era's runner install: its `em-runner-*`
// Startup shortcuts, then each legacy home — deregister every org dir through
// its own config.cmd, kill what runs out of it, remove it. A registration that
// did not come off keeps its directory, exactly as the omega home's does.
// Returns { failed: [{ org, dir, configCmd }] }.
async function uninstallLegacyRunnerInstalls(home) {
  const failed = [];

  for (const name of listLegacyRunnerStartupShortcuts()) {
    if (removeRunnerStartupShortcut(name)) logger.log(`  ✓ Removed legacy Startup shortcut: ${name}.cmd`);
  }

  // The legacy homes are machine-wide too — `C:\actions-runners` and
  // `%LOCALAPPDATA%\em-runner`, neither of them a path this call can redirect —
  // so a test stops here. The `em-runner-*` shortcut sweep above rides
  // STARTUP_DIR, which a test DOES redirect, so it already ran.
  if (isTestRun()) return { failed };

  for (const legacyHome of listLegacyRunnerHomes({ home })) {
    logger.log(`Legacy em-runner install at ${legacyHome} — tearing it down…`);
    const result = await deregisterOrgRunners({ home: legacyHome });
    killRunnerProcessesUnderHome(legacyHome);
    await removeRunnerHomeWithRetry(new Set(result.failed.map((f) => f.dir)), legacyHome);
    failed.push(...result.failed);
  }

  return { failed };
}

async function uninstallWatcherService() {
  // Quick check: does the service exist? Avoid noisy 1060 errors on a clean uninstall.
  const exists = await scQueryExists(WATCHER_SERVICE_NAME);
  if (!exists) return;

  const { spawnSync } = require('child_process');

  // CRITICAL: clear the failure-action config FIRST. node-windows configures
  // the watcher with restart-on-failure, so a plain `sc stop` triggers SCM
  // to immediately respawn it, defeating the uninstall. We blank the restart
  // policy first, THEN stop, THEN kill any stragglers, THEN delete.
  // (We used to use node-windows' own svc.uninstall(), but it left the
  // service running in v1.2.34, kept spawning rogue Runner.Listener.exe in
  // Session 0, and the recursive uninstall called from install() then hit
  // EPERM trying to remove RUNNER_HOME.)
  spawnSync('sc', ['failure', WATCHER_SERVICE_NAME, 'reset=', '0', 'actions='], { stdio: 'ignore' });
  spawnSync('sc', ['stop', WATCHER_SERVICE_NAME], { stdio: 'ignore' });

  // The watcher's wrapper executable is `emrunnerwatcher.exe` (node-windows
  // names the daemon after the service). Force-kill any process by that
  // name + any node.exe child whose CommandLine references watcher.js, in
  // case SCM's stop didn't fully take.
  spawnSync('taskkill', ['/F', '/IM', 'emrunnerwatcher.exe', '/T'], { stdio: 'ignore' });
  const r = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*watcher.js*' } | ForEach-Object { $_.ProcessId }`,
  ], { encoding: 'utf8' });
  if (r.status === 0) {
    for (const line of (r.stdout || '').split(/\r?\n/)) {
      const pid = line.trim();
      if (/^\d+$/.test(pid)) {
        spawnSync('taskkill', ['/F', '/PID', pid, '/T'], { stdio: 'ignore' });
      }
    }
  }

  // Now safe to delete the service definition.
  spawnSync('sc', ['delete', WATCHER_SERVICE_NAME], { stdio: 'ignore' });
  logger.log(`  ✓ Removed legacy watcher service: ${WATCHER_SERVICE_NAME}`);
}

async function uninstallActionsRunnerServices() {
  const { spawnSync } = require('child_process');
  // sc query state= all returns all services; grep for "actions.runner.".
  const r = spawnSync('sc', ['query', 'state=', 'all'], { encoding: 'utf8' });
  if (r.status !== 0) return;
  const names = (r.stdout || '').match(/SERVICE_NAME:\s*(actions\.runner\.\S+)/g) || [];
  for (const n of names) {
    const name = n.replace(/SERVICE_NAME:\s*/, '').trim();
    logger.log(`Removing leftover service ${name}…`);
    spawnSync('sc', ['stop',   name], { stdio: 'inherit' });
    spawnSync('sc', ['delete', name], { stdio: 'inherit' });
  }
}

async function scQueryExists(serviceName) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('sc', ['query', serviceName], { encoding: 'utf8' });
  return r.status === 0;
}

// Remove the runner home, except any directory in `keepDirs` — those still hold
// a registration that came off GitHub, and a later uninstall needs their
// config.cmd to retry with. With nothing to keep this removes the home whole,
// which is also the only way the template and the install record go.
async function removeRunnerHomeWithRetry(keepDirs, home) {
  const root = home || RUNNER_HOME;
  if (jetpack.exists(root) !== 'dir') return;

  // The box's own .env is configuration, not install state: it survives every
  // uninstall, so a re-install never asks for the PIN or the token again. So
  // does its logs dir — runner.log is the trail of this very uninstall, still
  // open by the tee while the removal runs.
  const envFile = runnerEnvFile(root);
  const logsDir = path.dirname(runnerLogFile(root));
  const keep = new Set([...(keepDirs || []), envFile, logsDir]);
  const targets = (jetpack.list(root) || [])
    .map((name) => path.join(root, name))
    .filter((entry) => !keep.has(entry));

  // Nothing kept survives on disk: the home itself goes too.
  const kept = [...(keepDirs || [])].length > 0
            || jetpack.exists(envFile) === 'file'
            || jetpack.exists(logsDir) === 'dir';
  if (!kept) targets.push(root);

  for (const target of targets) {
    // Services release file handles asynchronously — give them a few seconds.
    for (let i = 0; i < 5; i++) {
      try {
        jetpack.remove(target);
        break;
      } catch (e) {
        if (i === 4) {
          logger.warn(`Could not fully remove ${target} after 5 attempts: ${e.message}`);
          // Try to name the offending process. Sysinternals handle.exe (if on PATH)
          // gives us the holder. Otherwise we tell the user how to install it for
          // next time, so failures here don't keep being "files may be locked" with
          // no actionable info.
          identifyHandleHolders(target);
          break;
        }
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }
}

// Force-kill every process whose execution path lives under RUNNER_HOME, with
// `taskkill /F /T` so each process's children die too. Critical for uninstall:
// without it, the cmd.exe wrapper that runs run.cmd holds the runner dir as
// cwd for the lifetime of the listener, and jetpack.remove(RUNNER_HOME) fails
// with EPERM. Killing only Runner.Listener.exe wasn't enough — `/T` kills its
// children but NOT its parent cmd.exe, so the wrapper survives + keeps the
// cwd lock. v1.2.37: we now also enumerate cmd.exe wrappers (CommandLine
// references run.cmd from RUNNER_HOME) so the entire process tree is killed
// in one pass.
//
// Path-unavailable Runner.Listener.exe instances (ExecutablePath comes back
// empty when the process belongs to another account, even from an elevated
// query) are killed too — uninstall should leave no listener behind. Except
// under a test run: a test owns no such process (listenerFilterScript).
function killRunnerProcessesUnderHome(home) {
  if (process.platform !== 'win32') return;
  const { spawnSync } = require('child_process');

  // Single PowerShell call gets both Runner.Listener.exe AND cmd.exe wrappers
  // (any cmd.exe whose CommandLine references run.cmd under the home).
  // PID|ExecutablePath|Name|MatchedAs — '|' separators, easy to parse.
  const homeLower = String(home || RUNNER_HOME).toLowerCase().replace(/'/g, "''");
  // A test run drops the unreadable-path arm: that arm matches whatever home it
  // is given, so under a test it is the ONE clause in here that is not scoped by
  // anything (see listenerFilterScript).
  const ps = listenerFilterScript(homeLower, { includeUnreadable: !isTestRun() });
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  if (r.status !== 0) return;

  const targets = [];
  for (const rawLine of (r.stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length < 4) continue;
    const [pid, execPath, name, tag] = parts;
    if (!/^\d+$/.test(pid)) continue;
    targets.push({ pid, execPath: execPath || '(path unavailable)', name, tag });
  }

  if (targets.length === 0) return;

  logger.log(`Killing ${targets.length} runner-related process(es) before disk cleanup…`);
  for (const { pid, execPath, name, tag } of targets) {
    const k = spawnSync('taskkill', ['/F', '/PID', pid, '/T'], { encoding: 'utf8' });
    if (k.status === 0) {
      logger.log(`  ✓ Killed PID ${pid} (${name} ${tag}) ${execPath}`);
    } else {
      // Non-fatal: process may already be dead from a /T tree-kill of a
      // sibling target. Only warn on truly unexpected codes.
      const msg = (k.stderr || '').trim().slice(0, 200);
      if (!/not found|There are no/.test(msg)) {
        logger.warn(`  ✗ taskkill ${pid} failed (exit ${k.status}): ${msg}`);
      }
    }
  }
}

// The PowerShell `killRunnerProcessesUnderHome` runs, built apart from the spawn
// so the one clause that decides what a test may kill is assertable off Windows.
// `homeLc` arrives lowercased and PowerShell-escaped.
//
// `includeUnreadable` adds the `$ep -eq ''` arm. A Runner.Listener/Worker whose
// ExecutablePath the query cannot read belongs to ANOTHER account, and that arm
// matches it against WHATEVER home is passed — on a real box it is wanted (an
// uninstall must clear every handle inside the home before it removes it), but a
// test owns no such process, so a test run would be `taskkill /F`-ing a
// stranger's runner with every home and Startup dir it holds pointed at a
// scratch. Same rule as listRunnerListenerProcessesUnder's `!execPath` clause.
function listenerFilterScript(homeLc, options) {
  const { includeUnreadable } = options || {};
  const listenerMatch = includeUnreadable
    ? `$ep.StartsWith($home_lc) -or $ep -eq ''`
    : `$ep.StartsWith($home_lc)`;

  return `
    $home_lc = '${homeLc}';
    Get-CimInstance Win32_Process -Filter "Name='Runner.Listener.exe' OR Name='cmd.exe' OR Name='Runner.Worker.exe'" | ForEach-Object {
      $name = $_.Name;
      $cl = if ($_.CommandLine) { $_.CommandLine.ToLower() } else { '' };
      $ep = if ($_.ExecutablePath) { $_.ExecutablePath.ToLower() } else { '' };
      $matched = $false; $tag = '';
      if ($name -eq 'Runner.Listener.exe' -or $name -eq 'Runner.Worker.exe') {
        if (${listenerMatch}) { $matched = $true; $tag = 'listener' }
      } elseif ($name -eq 'cmd.exe') {
        if ($cl -like ('*' + $home_lc + '*') -and $cl -like '*run.cmd*') { $matched = $true; $tag = 'wrapper' }
      }
      if ($matched) { "$($_.ProcessId)|$($_.ExecutablePath)|$($_.Name)|$tag" }
    }
  `;
}

// Backwards-compatible alias — old name used in uninstall code paths.
const killRunnerListenerProcessesUnderHome = killRunnerProcessesUnderHome;

// Identify the processes currently holding handles inside `targetPath` via
// Sysinternals handle.exe. Used as a diagnostic when removeRunnerHomeWithRetry
// gives up — turns "files may be locked" into "PID 1234 (Runner.Listener.exe)
// is holding <runner home>\actions-runner-foo\bin\Runner.Listener.exe".
// handle.exe isn't bundled with Windows; if it isn't on PATH we surface a tip
// instead so the next failure has a path to actionable info.
function identifyHandleHolders(targetPath) {
  if (process.platform !== 'win32') return;
  const { spawnSync } = require('child_process');

  const probe = spawnSync('where', ['handle.exe'], { stdio: ['ignore', 'pipe', 'ignore'] });
  if (probe.status !== 0) {
    logger.warn(`Tip: install Sysinternals handle.exe (https://learn.microsoft.com/sysinternals/downloads/handle) and add it to PATH so future failures here can name the offending process.`);
    logger.warn(`Some files may be locked. Reboot Windows and re-run install if this persists.`);
    return;
  }

  // -accepteula bypasses the one-time EULA prompt that handle.exe shows on
  // first run; -nobanner suppresses the version banner so the output is
  // straight to per-handle lines.
  const r = spawnSync('handle.exe', ['-accepteula', '-nobanner', targetPath], { encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  if (out) {
    logger.warn(`Processes holding handles under ${targetPath}:`);
    for (const line of out.split(/\r?\n/).slice(0, 30)) logger.warn(`  ${line}`);
  } else {
    logger.warn(`handle.exe ran but reported no holders for ${targetPath}. The lock may be at the directory level (e.g. another shell's cwd is set inside it) — try closing all cmd windows and re-running.`);
  }
}

// ─── self-update ────────────────────────────────────────────────────────────────
async function selfUpdate() {
  const { execute } = require('node-powertools');
  logger.log('Updating @omega.js/desktop to latest…');
  try {
    const out = await safeInstall('npm i -g @omega.js/desktop@latest');
    logger.log(out);
    logger.log('✓ @omega.js/desktop updated.');
  } catch (e) {
    logger.warn(`Self-update failed: ${e.message}`);
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────────

const WATCHER_SERVICE_NAME = 'omega-runner-watcher';

function ensureWindows() {
  if (process.platform !== 'win32' && !process.env.OMEGA_RUNNER_FORCE) {
    throw new Error('This command only runs on Windows. Set OMEGA_RUNNER_FORCE=1 to override (testing only).');
  }
}

function ensureGhToken() {
  if (!process.env.GH_TOKEN) {
    throw new Error('GH_TOKEN env var required. Classic PAT needs scopes: repo + workflow + admin:org. Set it before running runner commands.');
  }
}

async function downloadActionsRunner(runnerDir, home) {
  const url = `https://github.com/actions/runner/releases/download/v${ACTIONS_RUNNER_VERSION}/actions-runner-win-x64-${ACTIONS_RUNNER_VERSION}.zip`;
  const zipPath = path.join(home || RUNNER_HOME, 'actions-runner.zip');
  jetpack.dir(runnerDir);
  logger.log(`Downloading actions/runner v${ACTIONS_RUNNER_VERSION}…`);

  // curl ships on Windows 10+ and macOS. -L follows GitHub's redirect to the S3 download URL,
  // -f fails on HTTP errors (so we don't write an HTML error page as "the zip"), -o writes
  // to disk directly (no in-memory buffering, no truncation issues with large files).
  const { spawnSync } = require('child_process');
  const dl = spawnSync('curl', ['-fL', '-o', zipPath, url], { stdio: 'inherit' });
  if (dl.status !== 0) {
    throw new Error(`Failed to download actions-runner.zip (curl exit ${dl.status}). Check network or curl.exe availability.`);
  }

  // Sanity-check size before extracting — actions/runner zip is ~150 MB. Anything under 1 MB
  // is almost certainly an error page that slipped through.
  const stat = fs.statSync(zipPath);
  if (stat.size < 1024 * 1024) {
    const head = fs.readFileSync(zipPath, 'utf8').slice(0, 200);
    throw new Error(`Downloaded actions-runner.zip is only ${stat.size} bytes — likely an error page. First 200 bytes: ${head}`);
  }
  logger.log(`Downloaded ${(stat.size / 1024 / 1024).toFixed(1)} MB → extracting…`);

  // Extract via PowerShell's Expand-Archive instead of `tar`. On Windows the
  // System32 tar.exe (bsdtar) handles `C:\...` paths fine, but if the user's
  // PATH front-loads Git for Windows' tar (GNU tar), it interprets `C:\...`
  // as `host:path` and fails with "Cannot connect to C: resolve failed".
  // Expand-Archive is built into PowerShell 5.1+ on every supported Windows
  // and has none of those quirks.
  if (process.platform === 'win32') {
    const ps = spawnSync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${runnerDir}' -Force`,
    ], { stdio: 'inherit' });
    if (ps.status !== 0) {
      throw new Error(`Failed to extract actions-runner.zip via PowerShell Expand-Archive (exit ${ps.status}).`);
    }
  } else {
    const t = spawnSync('tar', ['-xf', zipPath, '-C', runnerDir], { stdio: 'inherit' });
    if (t.status !== 0) {
      throw new Error(`Failed to extract actions-runner.zip (tar exit ${t.status}).`);
    }
  }
  jetpack.remove(zipPath);
  logger.log(`Extracted actions/runner → ${runnerDir}`);
}

async function discoverAdminOrgs() {
  const { getOctokit } = require('../utils/github.js');
  const octokit = getOctokit();
  if (!octokit) return [];
  const orgs = [];
  try {
    const { data } = await octokit.rest.orgs.listForAuthenticatedUser({ per_page: 100 });
    for (const org of data) {
      try {
        // membership endpoint shows our role.
        const { data: m } = await octokit.rest.orgs.getMembershipForAuthenticatedUser({ org: org.login });
        if (m.role === 'admin') orgs.push(org.login);
      } catch (e) { /* skip if can't read */ }
    }
  } catch (e) {
    logger.warn(`Could not list orgs: ${e.message}`);
  }
  return orgs;
}

// Enumerate all `actions.runner.*` services on this machine (one per registered org).
// Uses `sc query state= all` (note the space — that's the documented form) to get every
// service including stopped ones, then filters by SERVICE_NAME prefix.
function listActionsRunnerServices() {
  if (process.platform !== 'win32') return [];
  const { spawnSync } = require('child_process');
  const r = spawnSync('sc', ['query', 'state=', 'all'], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  const out = r.stdout || '';
  const names = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^SERVICE_NAME:\s*(actions\.runner\..+)$/.exec(line.trim());
    if (m) names.push(m[1]);
  }
  return names.sort();
}

// Parse the current STATE from `sc query <name>`. Returns 'RUNNING' | 'STOPPED' | 'NOT_INSTALLED' | 'UNKNOWN'.
function scState(name) {
  if (process.platform !== 'win32') return 'UNKNOWN';
  const { spawnSync } = require('child_process');
  const r = spawnSync('sc', ['query', name], { encoding: 'utf8' });
  if (r.status === 1060) return 'NOT_INSTALLED';
  if (r.status !== 0) return 'UNKNOWN';
  const out = r.stdout || '';
  const m = /STATE\s*:\s*\d+\s+(\w+)/.exec(out);
  return m ? m[1].toUpperCase() : 'UNKNOWN';
}

// ─── Startup folder runner management ─────────────────────────────────────
//
// The per-org runner auto-starts from a .cmd file in the user's Startup folder,
// never a Scheduled Task. Reason: Task Scheduler runs ONLOGON tasks in its own
// (Session 0) context regardless of the /IT flag, leaving the runner blind to
// the user's CurrentUser\My cert store and unable to host the SafeNet Token
// Logon PIN dialog. Files in the Startup folder are auto-run by Explorer at
// every interactive logon (Session 1), no Task Scheduler middleman, no admin
// needed for the auto-start trigger.
//
// File layout:
//   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\<runnerName>.cmd
//
// Content:
//   @echo off
//   start "" /min /D "%LOCALAPPDATA%\omega-runner\actions-runner-<org>" "…\run.cmd"
//
// `start "" /min` launches run.cmd in a minimized window and returns
// immediately, so subsequent startup items aren't blocked. The empty `""` is
// start.exe's title parameter — required when the next argument is quoted,
// otherwise start interprets the quoted path as a console title.

//
// `OMEGA_RUNNER_STARTUP_DIR` is the Startup folder's scratch seam, parity with
// `OMEGA_RUNNER_HOME` on the runner home (utils/runner-env.js `defaultRunnerHome`):
// resolved ONCE here, at require time, so a test child sets it before it requires
// this module. It exists because no home scopes this folder — `uninstall` sweeps
// every `omega-runner-*.cmd` in it, and on 2026-09-04 a suite case with two
// scratch homes deleted the signing box's three real shortcuts.
const STARTUP_DIR = process.env.OMEGA_RUNNER_STARTUP_DIR
  || (process.platform === 'win32'
    ? path.join(
        process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
      )
    : null);

function runnerStartupFile(runnerName, startupDir) {
  const dir = startupDir === undefined ? STARTUP_DIR : startupDir;
  if (!dir) return null;
  return path.join(dir, `${runnerName}.cmd`);
}

// The state of ONE org's runner, from the three things this design actually
// has: the per-org runner dir on disk, its Startup shortcut, and any live
// Runner.Listener.exe underneath it. `status` prints these machine-wide;
// `monitor` prints them per org. There is no Scheduled Task to ask
// ([#337](https://github.com/Omega-JS-Stack/omega/issues/337)).
function orgRunnerState(org, options) {
  const { home, startupDir, listListeners } = options || {};
  const name      = ghRunnerName(org);
  const dir       = orgRunnerDir(org, home);
  const shortcut  = runnerStartupFile(name, startupDir);
  const listeners = (listListeners || listRunnerListenerProcessesUnder)(dir);
  const installed = jetpack.exists(dir) === 'dir';

  // A listener in Session 0 is WORSE than a stopped one: it picks jobs up and
  // then fails every signtool call, because Session 0 has no desktop for the
  // Token Logon dialog and its own empty certificate store.
  const sessionZero = listeners.some((p) => p.sessionId === 0);

  return {
    org,
    name,
    dir,
    shortcut,
    installed,
    autoStart: !!shortcut && jetpack.exists(shortcut) === 'file',
    listeners,
    sessionZero,
    state: listeners.length === 0
      ? (installed ? 'STOPPED' : 'NOT_INSTALLED')
      : (sessionZero ? 'SESSION_0' : 'RUNNING'),
  };
}

const RUNNER_STATE_SYMBOLS = {
  RUNNING:       '✓',
  STOPPED:       '·',
  SESSION_0:     '⚠',
  NOT_INSTALLED: '?',
};
const SESSION_0_NOTE = 'session 0: cannot see CurrentUser\\My cert store';

// The per-org block. `status` and `monitor` both print THIS — one derivation and
// one rendering, so the two can never disagree about what a runner is doing
// ([#337](https://github.com/Omega-JS-Stack/omega/issues/337): monitor used to
// ask a pair of Scheduled-Task helpers that did not exist while status scanned
// processes itself).
function orgRunnerStateLines(state) {
  const notes = [
    state.installed ? `dir ${state.dir}` : `no runner dir at ${state.dir}`,
    state.autoStart ? 'auto-starts at logon' : 'no Startup shortcut',
  ];
  const lines = [`  ${RUNNER_STATE_SYMBOLS[state.state] || '?'} ${state.org} — ${state.state} (${notes.join('; ')})`];

  for (const { pid, sessionId, execPath } of state.listeners) {
    const where  = execPath || '(path unavailable)';
    const suffix = sessionId === 0 ? ` — ${SESSION_0_NOTE}` : '';
    lines.push(`      PID=${pid} session=${sessionId} ${where}${suffix}`);
  }

  return lines;
}

// Every registered org's state plus the lines that render it.
function orgRunnerReport(options) {
  return monitorOrgStates(options).map((state) => ({ state, lines: orgRunnerStateLines(state) }));
}

// The org roster `monitor` prints on start, one state per org.
//
// OMEGA_RUNNER_ORGS wins over config.registeredOrgs when set, because installs
// that predated the filter often left a stale full-org list in config.json.
function monitorOrgStates(options) {
  const { home, startupDir, env, listListeners } = options || {};
  const cfg = readConfig(home);
  let orgs = cfg.registeredOrgs || [];

  const filter = parseRunnerOrgs((env || process.env).OMEGA_RUNNER_ORGS);
  if (filter.length > 0) {
    const filterSet = new Set(filter.map((o) => o.toLowerCase()));
    orgs = orgs.filter((o) => filterSet.has(o.toLowerCase()));
    if (orgs.length === 0) orgs = filter;   // filter set but nothing matched in config — show the filter directly
  }

  return orgs.map((org) => orgRunnerState(org, { home, startupDir, listListeners }));
}

// Every per-org runner directory currently on disk that still holds the
// `config.cmd` needed to deregister it.
//
// The roster comes off DISK, not config.json: a half-finished install leaves
// directories config.json never recorded, and those are exactly the ones that
// strand an orphaned runner in the org. `_template` is excluded by the name
// filter — it carries a config.cmd but was never registered against anything.
function listOrgRunnerDirs(home) {
  const root = home || RUNNER_HOME;
  if (jetpack.exists(root) !== 'dir') return [];

  return (jetpack.list(root) || [])
    .filter((name) => /^actions-runner-.+$/i.test(name))
    .map((name) => name.replace(/^actions-runner-/i, ''))
    .map((org) => ({ org, dir: orgRunnerDir(org, root), configCmd: path.join(orgRunnerDir(org, root), 'config.cmd') }))
    .filter((entry) => jetpack.exists(entry.configCmd) === 'file')
    .sort((a, b) => a.org.localeCompare(b.org));
}

// Remove each registration from the GitHub side, using that directory's OWN
// config.cmd. Without this, every uninstall leaves an offline runner in the org
// list until someone deletes it by hand.
//
// A removal that did NOT succeed keeps its directory: the registration files in
// there are the only thing a later `uninstall` can retry with, so deleting them
// would strand that runner in the org permanently.
//
// `exec` and `getRemoveToken` are injected by the tests — config.cmd only runs
// on Windows, but the roster, the verdicts and the no-token skip are provable
// anywhere. Returns { deregistered: [org], failed: [{ org, dir, configCmd }] }.
async function deregisterOrgRunners(options) {
  const { home, exec, getRemoveToken } = options || {};
  const targets = listOrgRunnerDirs(home);
  if (targets.length === 0) return { deregistered: [], failed: [] };

  // Neither default below is scoped by a home: `getRemoveToken` mints a REAL
  // removal token for the named org with GH_TOKEN, and `run` executes that
  // directory's own config.cmd. A test with a roster and no seam is therefore
  // one request away from deregistering the box's runners, which is what the
  // home and Startup-folder guards cannot see. Refuse instead of reaching.
  // `exec` alone is not enough while GH_TOKEN is set: the default
  // `getRemoveToken` would still mint a real removal token against the org.
  if (isTestRun() && (!exec || (!getRemoveToken && process.env.GH_TOKEN))) {
    throw new Error(
      `Refusing to deregister ${targets.length} runner(s) from GitHub: this is a test run `
      + '(OMEGA_TEST_RUNNER / OMEGA_TEST_MODE) and the call did not inject `exec`, or has GH_TOKEN set '
      + 'without `getRemoveToken`. A test run must inject both to exercise deregistration — the default '
      + "path mints a real removal token with GH_TOKEN and runs each org directory's own config.cmd.",
    );
  }

  if (!process.env.GH_TOKEN) {
    logger.warn(`Skipping org-side deregistration of ${targets.length} runner(s) — GH_TOKEN is not set.`);
    logger.warn(`  Their directories are kept so a later uninstall can retry. To finish now, remove them under each org's Settings → Actions → Runners: ${targets.map((t) => t.org).join(', ')}`);
    return { deregistered: [], failed: targets };
  }

  const removeToken = getRemoveToken || (async (org) => {
    const { getOctokit } = require('../utils/github.js');
    const { data } = await getOctokit().rest.actions.createRemoveTokenForOrg({ org });
    return data.token;
  });
  // `cmd.exe /c` for the same reason register-org uses it: Node's CreateProcess
  // cannot launch a .cmd file directly.
  const run = exec || ((cmd, args, cwd) => require('child_process').spawnSync(cmd, args, { cwd, stdio: 'inherit' }));

  const deregistered = [];
  const failed = [];
  for (const target of targets) {
    const { org, dir, configCmd } = target;
    try {
      const token = await removeToken(org);
      const result = run('cmd.exe', ['/c', configCmd, 'remove', '--token', token], dir) || {};
      if (result.error) throw result.error;
      if (result.status !== 0) {
        const code = result.status === null ? 'null (killed)' : result.status;
        logger.warn(`  ✗ ${org}: config.cmd remove exited ${code} — still registered, keeping ${dir} to retry`);
        failed.push(target);
        continue;
      }
      logger.log(`  ✓ Deregistered ${org} from GitHub`);
      deregistered.push(org);
    } catch (e) {
      logger.warn(`  ✗ ${org}: ${e.message} — still registered, keeping ${dir} to retry`);
      failed.push(target);
    }
  }
  return { deregistered, failed };
}

function writeRunnerStartupShortcut({ runnerName, runnerDir }) {
  if (process.platform !== 'win32') return;
  const runCmd = path.join(runnerDir, 'run.cmd');
  if (!jetpack.exists(runCmd)) {
    throw new Error(`Cannot write Startup shortcut — run.cmd not found at ${runCmd}.`);
  }
  jetpack.dir(STARTUP_DIR);
  const file = runnerStartupFile(runnerName);
  // /D <runnerDir> sets the new process's cwd to the runner dir itself.
  // actions/runner's auto-update writes its `update.finished` marker to
  // cwd — if cwd is anywhere not user-writable (we tried %WINDIR% earlier),
  // the write fails with Access Denied and the runner reconnect-loops
  // forever. The runner dir is the documented expected cwd. uninstall has
  // killRunnerProcessesUnderHome to clear the cwd lock when needed.
  const body = [
    '@echo off',
    `start "" /min /D "${runnerDir}" "${runCmd}"`,
    '',
  ].join('\r\n');
  jetpack.write(file, body);
  logger.log(`  ✓ Startup shortcut: ${file}`);
}

function removeRunnerStartupShortcut(runnerName) {
  if (process.platform !== 'win32') return false;
  const file = runnerStartupFile(runnerName);
  if (jetpack.exists(file)) {
    jetpack.remove(file);
    return true;
  }
  return false;
}

// Names of the `<prefix>*.cmd` shortcuts in the Startup folder (sans `.cmd`).
// `startupDir` is injected by the tests; off Windows there is no Startup folder
// to ask, so a real call answers with nothing.
function listStartupShortcuts(prefix, startupDir) {
  const dir = startupDir === undefined ? STARTUP_DIR : startupDir;
  if (!dir || !jetpack.exists(dir)) return [];
  const lower = prefix.toLowerCase();
  return (jetpack.list(dir) || [])
    .filter((name) => /\.cmd$/i.test(name))
    .filter((name) => name.toLowerCase().startsWith(lower) && name.length > `${prefix}.cmd`.length)
    .map((name) => name.replace(/\.cmd$/i, ''))
    .sort();
}

// The omega runners' shortcuts: `omega-runner-<host>-<org>`.
function listRunnerStartupShortcuts(startupDir) {
  return listStartupShortcuts('omega-runner-', startupDir);
}

// The electron-manager era's: `em-runner-<host>-<org>`, which `status` names
// and `uninstall` removes — never anything `start` would launch.
function listLegacyRunnerStartupShortcuts(startupDir) {
  return listStartupShortcuts(LEGACY_RUNNER_PREFIX, startupDir);
}

// Spawn Runner.Listener.exe as a fully detached background process. We exec
// the listener directly (NOT via run.cmd) because run.cmd is a cmd.exe batch
// wrapper that blocks for the lifetime of the listener with cwd = runnerDir;
// a long-lived cmd.exe holding cwd inside RUNNER_HOME blocks every later
// uninstall with EPERM. Bypassing run.cmd loses its self-update relaunch
// path, but `mgr runner install` refreshing the runner binary is the
// preferred update mechanism in @omega.js/desktop anyway.
//
// Detached + windowsHide + ignored stdio = no console window flashes during
// install and the listener survives the install command's exit. UAC-
// elevated parents still spawn into Session 1 because UAC only changes the
// token, not the session — confirmed empirically.
function spawnRunnerDetached(runnerDir, home) {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'not-windows', pid: null };
  }
  const runCmd = path.join(runnerDir, 'run.cmd');
  if (!jetpack.exists(runCmd)) {
    return { ok: false, message: `run.cmd not found at ${runCmd}`, pid: null };
  }
  const { spawn } = require('child_process');
  try {
    // cwd is the runner dir itself. actions/runner's auto-update path writes
    // a marker file `update.finished` to cwd; if cwd is %WINDIR% the write
    // fails with Access Denied and the runner enters a 5-second reconnect
    // loop forever. The runner dir is the documented expected cwd. The
    // tradeoff — that the cmd.exe wrapper holds the dir handle for the
    // lifetime of the listener — is handled in uninstall via
    // killRunnerProcessesUnderHome which kills the wrapper too.
    // HOME is the runner's private one ([#807](https://github.com/Omega-JS-Stack/omega/issues/807)),
    // passed here as well as written to `<runner dir>\.env`: the listener's own
    // environment is what reaches its jobs, so the spawn never depends on the
    // `.env` read alone.
    const child = spawn('cmd.exe', ['/c', runCmd], {
      cwd: runnerDir,
      env: { ...process.env, HOME: runnerPrivateHome(home || RUNNER_HOME) },
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return { ok: true, pid: child.pid };
  } catch (e) {
    return { ok: false, message: e.message, pid: null };
  }
}

// Enumerate Runner.Listener.exe processes whose ExecutablePath lives under
// `targetDir`. Used by the per-org state (visibility) and stop (kill targets).
// Returns [{ pid, sessionId, execPath }, ...]. Processes whose path we cannot
// read are surfaced too, with execPath = null, so callers can decide what to do
// with them — status warns, stop kills.
function listRunnerListenerProcessesUnder(targetDir) {
  if (process.platform !== 'win32') return [];
  const { spawnSync } = require('child_process');
  const r = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='Runner.Listener.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.SessionId)|$($_.ExecutablePath)" }`,
  ], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  const out = [];
  for (const rawLine of (r.stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length !== 3) continue;
    const [pid, sessionId, execPath] = parts;
    if (!/^\d+$/.test(pid)) continue;
    if (!execPath) {
      // Path unavailable — the process belongs to another account. Surface it
      // so status can call it out and stop can kill it. Never under a test run:
      // this is `listenerFilterScript`'s `includeUnreadable` arm in JS, one rule
      // in two places, and a test may not kill a stranger's runner.
      if (isTestRun()) continue;
      out.push({ pid: parseInt(pid, 10), sessionId: parseInt(sessionId, 10), execPath: null });
      continue;
    }
    if (isListenerUnder(execPath, targetDir)) {
      out.push({ pid: parseInt(pid, 10), sessionId: parseInt(sessionId, 10), execPath });
    }
  }
  return out;
}

// Does this listener live INSIDE that runner dir? A bare prefix match said yes
// to the wrong org: `actions-runner-acme` claimed every listener under
// `actions-runner-acme-2`, so `start` read the long org's runner as the short
// org's and left the short one offline
// ([#801](https://github.com/Omega-JS-Stack/omega/issues/801)). The path must
// continue into the directory, and the separators are normalised because the
// box's paths are Windows ones whichever OS is asking.
function isListenerUnder(execPath, targetDir) {
  const normalize = (p) => String(p).replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
  return normalize(execPath).startsWith(`${normalize(targetDir)}/`);
}

// Idempotent cleanup of any omega-runner-* Scheduled Tasks left over from
// v1.2.16–v1.2.34, which registered runners as Logon Tasks. v1.2.35+ moved
// to Startup folder shortcuts; this runs during uninstall so upgraders'
// leftover tasks get pruned without manual schtasks juggling.
async function uninstallLegacyLogonTasks() {
  if (process.platform !== 'win32') return;
  const { spawnSync } = require('child_process');
  const r = spawnSync('schtasks', ['/Query', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  if (r.status !== 0) return;
  const tasks = [];
  for (const rawLine of (r.stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^"([^"]+)"/.exec(line);
    if (!m) continue;
    const tn = m[1].replace(/^\\/, '');
    if (/^omega-runner-/i.test(tn)) tasks.push(tn);
  }
  if (tasks.length === 0) return;
  for (const name of tasks) {
    logger.log(`Removing legacy Logon Task ${name}…`);
    spawnSync('schtasks', ['/End',    '/TN', name],          { stdio: 'ignore' });
    const d = spawnSync('schtasks', ['/Delete', '/TN', name, '/F'], { encoding: 'utf8' });
    if (d.status !== 0) {
      logger.warn(`  schtasks /Delete failed for ${name} (exit ${d.status}): ${(d.stderr || '').trim().slice(0, 200)}`);
    } else {
      logger.log(`  ✓ Deleted ${name}`);
    }
  }
}

function readConfig(home) {
  const file = path.join(home || RUNNER_HOME, 'config.json');
  if (!jetpack.exists(file)) return {};
  return jetpack.read(file, 'json') || {};
}

function saveConfig(data, home) {
  const file = path.join(home || RUNNER_HOME, 'config.json');
  const cur  = readConfig(home);
  jetpack.write(file, { ...cur, ...data });
}

// ─── monitor ────────────────────────────────────────────────────────────────────
//
// `npx omega runner monitor` — pretty-prints the JSONL signing event log in real time.
//
// Reads the same path `sign-windows` writes to (see sign-events.js for the full
// resolution chain). Uses signEvents.getLogPath() so it always stays in sync.
//
// Designed to run from a regular PowerShell / cmd / Windows Terminal session on the
// signing box. Reads the file, prints existing events first (so you see context if
// signing already started), then watches for new lines via fs.watchFile + offset
// tracking. No fancy deps.
async function monitor(options) {
  options = options || {};
  const home = options._home || RUNNER_HOME;
  const signEvents = require('../lib/sign-helpers/sign-events.js');
  // `_home` redirects the roster below, never this path: `getLogPath()` takes no
  // argument and froze its answer at require time from the environment —
  // `OMEGA_SIGN_LOG`, else `<OMEGA_RUNNER_HOME>\omega-signing.log`, else the
  // platform default (lib/sign-helpers/sign-events.js). Pass `file` to move it.
  const file = options.file || signEvents.getLogPath();
  const followOnly = !!options['follow-only'];

  logger.log(`Watching: ${file}`);

  // List the registered orgs and the live state of each, so the user can see
  // exactly which orgs the monitor will pick up signing events from.
  const report = orgRunnerReport({ home });
  if (report.length === 0) {
    logger.log('(no orgs registered yet — run `npx omega runner install` first)');
  } else {
    logger.log(`Monitoring signing requests across ${report.length} org(s):`);
    for (const { state, lines } of report) {
      for (const line of lines) (state.sessionZero ? logger.warn : logger.log).call(logger, line);
    }
    if (report.some((r) => r.state.sessionZero)) {
      logger.warn(`  ⚠ Kill it ('npx omega runner stop') and re-spawn from Session 1, or it will fail every job it picks up.`);
    }
  }

  if (!fs.existsSync(file)) {
    // Make sure the parent dir exists so events written before monitor sees the file
    // don't fail (sign-events.js handles its own write errors, but pre-creating the dir
    // avoids a confusing "waiting forever" UX when OMEGA_RUNNER_HOME hasn't been used yet).
    try {
      jetpack.dir(path.dirname(file));
    } catch (_) { /* best-effort */ }
    logger.log('(file does not exist yet — waiting for first sign event...)');
  }

  // Track byte offset so we only print new lines on each poll. Initialize to either
  // 0 (replay everything) or the file's current size (--follow-only — only show new
  // events).
  let pos = followOnly && fs.existsSync(file)
    ? fs.statSync(file).size
    : 0;

  let inFlight = false;
  let buffer = '';

  function pump() {
    if (inFlight) return;
    if (!fs.existsSync(file)) return;
    inFlight = true;
    const stream = fs.createReadStream(file, { start: pos });
    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) renderLine(line);
        pos += Buffer.byteLength(line, 'utf8') + 1;
      }
    });
    stream.on('end', () => { inFlight = false; });
    stream.on('error', (e) => {
      inFlight = false;
      logger.warn(`monitor read failed: ${e.message}`);
    });
  }

  pump();

  // Watch for size changes. fs.watchFile polls (default 5s) which is fine here —
  // we don't need sub-second latency on a sign-monitor.
  fs.watchFile(file, { interval: 500 }, (curr, prev) => {
    // File rotated / truncated — reset.
    if (curr.size < pos) {
      pos = 0;
      buffer = '';
      logger.log('(log truncated — replaying from start)');
    }
    if (curr.size > pos) pump();
  });

  // Keep alive forever.
  await new Promise(() => {});
}

function renderLine(jsonLine) {
  let evt;
  try {
    evt = JSON.parse(jsonLine);
  } catch (_) {
    process.stdout.write(`[??] ${jsonLine}\n`);
    return;
  }

  const ts = (evt.ts || '').replace('T', ' ').replace('Z', '');
  const dur = typeof evt.duration_ms === 'number' ? ` (${formatDuration(evt.duration_ms)})` : '';
  const fmt = logger.format || {};
  const c = (col, str) => (fmt[col] ? fmt[col](str) : str);

  switch (evt.event) {
    case 'job-start':
      process.stdout.write(`\n${c('cyan', '━'.repeat(60))}\n`);
      process.stdout.write(`${c('cyan', `[${ts}] JOB START`)}`);
      // Org/repo callout: prefer GH-provided env, fall back to parsing the workspace path
      // (<runner home>\actions-runner-<org>\_work\<repo>\<repo>) when running outside
      // a GH Actions context (e.g. local smoke tests).
      let org  = evt.github_owner || null;
      let repo = evt.github_repo  || null;
      if (!org && evt.runner_workspace) {
        const m = /actions-runner-([^\\/]+)[\\/]_work[\\/]([^\\/]+)/i.exec(evt.runner_workspace);
        if (m) { org = m[1]; repo = repo || m[2]; }
      }
      if (org || repo) {
        const label = [org, repo].filter(Boolean).join('/');
        process.stdout.write(` ${c('yellow', label)}`);
      }
      if (evt.github_workflow) process.stdout.write(c('gray', ` workflow=${evt.github_workflow}`));
      if (evt.github_run_id)   process.stdout.write(c('gray', ` run=${evt.github_run_id}`));
      if (evt.runner_workspace) process.stdout.write(c('gray', ` workspace=${evt.runner_workspace}`));
      process.stdout.write('\n');
      break;
    case 'job-end':
      const ok = evt.ok ? c('green', 'OK') : c('red', 'FAILED');
      process.stdout.write(`${c('cyan', `[${ts}] JOB END ${ok}${dur}`)}\n`);
      if (evt.error) process.stdout.write(`  ${c('red', evt.error)}\n`);
      process.stdout.write(`${c('cyan', '━'.repeat(60))}\n`);
      break;
    case 'sign-start':
      process.stdout.write(`[${ts}] ${c('yellow', '→')} sign ${c('white', evt.file)}`);
      if (typeof evt.bytes === 'number') process.stdout.write(c('gray', ` (${formatBytes(evt.bytes)})`));
      process.stdout.write(c('gray', ` mode=${evt.mode}`));
      process.stdout.write('\n');
      break;
    case 'sign-attempt':
      // Only worth a line when it is not the first try — attempt 1 is the
      // sign-start line you already saw.
      if (evt.attempt > 1) {
        process.stdout.write(`[${ts}] ${c('yellow', '↻')} attempt ${evt.attempt}/${evt.of} ${c('white', evt.file)}\n`);
      }
      break;
    case 'sign-retry':
      process.stdout.write(`[${ts}] ${c('yellow', '↻')} retrying ${c('white', evt.file)} ${c('gray', `(attempt ${evt.attempt}/${evt.of} failed, waiting ${formatDuration(evt.retry_in_ms)})`)}\n`);
      if (evt.error) process.stdout.write(`  ${c('gray', evt.error)}\n`);
      break;
    case 'sign-done':
      process.stdout.write(`[${ts}] ${c('green', '✓')} signed ${c('white', evt.file)}${c('gray', dur)}\n`);
      break;
    case 'sign-fail':
      process.stdout.write(`[${ts}] ${c('red', '✗')} FAILED ${c('white', evt.file)} ${c('gray', `(phase:${evt.phase}${dur})`)}\n`);
      if (evt.error) process.stdout.write(`  ${c('red', evt.error)}\n`);
      break;
    default:
      process.stdout.write(`[${ts}] ${evt.event} ${JSON.stringify(evt)}\n`);
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

// Exports for testing.
module.exports.RUNNER_LABELS = RUNNER_LABELS;
module.exports.RUNNER_HOME = RUNNER_HOME;                 // the home this process froze at require time — the suites assert it is a scratch
module.exports.STARTUP_DIR = STARTUP_DIR;                 // the Startup folder it froze at the same moment — no home scopes it, so the suites assert it too
module.exports.isScratchRunnerHome = isScratchRunnerHome;
module.exports.ACTIONS_RUNNER_VERSION = ACTIONS_RUNNER_VERSION;
module.exports.defaultRunnerHome = defaultRunnerHome;
module.exports.orgRunnerState = orgRunnerState;
module.exports.monitorOrgStates = monitorOrgStates;
module.exports.orgRunnerStateLines = orgRunnerStateLines;
module.exports.orgRunnerReport = orgRunnerReport;
module.exports.listOrgRunnerDirs = listOrgRunnerDirs;
module.exports.deregisterOrgRunners = deregisterOrgRunners;
module.exports.removeRunnerHomeWithRetry = removeRunnerHomeWithRetry;
module.exports.LEGACY_RUNNER_PREFIX = LEGACY_RUNNER_PREFIX;
module.exports.listLegacyRunnerHomes = listLegacyRunnerHomes;
module.exports.selectRunnerOrgs = selectRunnerOrgs;
module.exports.startPreflight = startPreflight;
module.exports.listRunnerStartupShortcuts = listRunnerStartupShortcuts;
module.exports.isListenerUnder = isListenerUnder;            // the dir-containment rule start reads a live listener with
module.exports.listLegacyRunnerStartupShortcuts = listLegacyRunnerStartupShortcuts;
module.exports.listenerFilterScript = listenerFilterScript;
