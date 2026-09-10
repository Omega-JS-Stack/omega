// Strategy-aware Windows code signer.
//
// Reads strategy from config platforms.win.signing.strategy:
//   self-hosted — sign with signtool against an EV USB token (typically on a self-hosted runner)
//   cloud       — shell out to a cloud signing provider's CLI (Azure / SSL.com / DigiCert)
//   local       — no-op (developer signs manually on their own Windows box)
//
// Usage:
//   npx omega sign-windows                                 # sign every .exe/.msi under ./release
//   npx omega sign-windows --in release/ --out release/signed/
//   npx omega sign-windows --verify-only                   # don't sign, just verify existing signatures
//   npx omega sign-windows --smoke                         # sign a 1-byte dummy .exe to validate the setup
//   npx omega sign-windows --target some-binary.exe        # sign a single specific file
//
// Cloud provider modules will live in src/lib/sign-providers/{azure,sslcom,digicert}.js
// (Pass 3 work). For now the cloud branch logs the intended provider command and exits cleanly.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const jetpack = require('fs-jetpack');
const { execute } = require('node-powertools');

const Manager = new (require('../build.js'));
const logger = Manager.logger('sign-windows');

// The box's own signing configuration (`<runner home>\.env`: the cert, the PIN,
// signtool) is read before anything below looks at process.env, so a manual
// sign, `--smoke` and the e2e suite work from any directory. A CI-delivered
// value wins over the file (utils/runner-env.js).
const runnerEnv = require('../utils/runner-env.js');
runnerEnv.loadRunnerEnv();
const attachLogFile = require('../utils/attach-log-file.js');

const { startAutoUnlock } = require('../lib/sign-helpers/auto-unlock.js');
const { writeUpdateInfo } = require('../lib/sign-helpers/update-info.js');
const signEvents = require('../lib/sign-helpers/sign-events.js');

module.exports = async function (options) {
  options = options || {};

  // The box's own record of what it signed, beside the install — the same file
  // `omega runner` writes, since a sign is one of the things the box did. Its
  // OWN tee, so an outer verb's log file survives this one's detach.
  //
  // `attachInCI` because this file is the BOX's, not the workspace's: the
  // `windows-sign` job IS the run whose trail the box needs to keep. `append`
  // because the `runner start` listener that spawned this holds the same file.
  const logTarget = boxLogTarget();
  const tee = attachLogFile.createTee();
  if (logTarget) tee.attach(logTarget, { attachInCI: true, append: true });

  const jobStart = Date.now();
  // GITHUB_REPOSITORY is "<owner>/<repo>" inside a GH Actions runner — split for the
  // monitor banner. GITHUB_REPOSITORY_OWNER is the same thing as the owner half but is
  // sometimes the better source on org-vs-user runs. Both are provided automatically by
  // actions/runner; only present when invoked from a workflow job.
  const repoFull = process.env.GITHUB_REPOSITORY || '';
  const [ghOwner, ghRepo] = repoFull.includes('/') ? repoFull.split('/') : [process.env.GITHUB_REPOSITORY_OWNER || null, null];
  signEvents.emit('job-start', {
    options:        Object.fromEntries(Object.entries(options).filter(([k]) => k !== '_')),
    runner_workspace: process.env.RUNNER_WORKSPACE || null,
    github_run_id:    process.env.GITHUB_RUN_ID || null,
    github_workflow:  process.env.GITHUB_WORKFLOW || null,
    github_owner:     ghOwner || null,
    github_repo:      ghRepo  || null,
  });
  logger.log(`Signing event log: ${signEvents.getLogPath()}`);

  try {
    const result = await runSignCommand(options);
    signEvents.emit('job-end', { ok: true, duration_ms: Date.now() - jobStart });
    return result;
  } catch (e) {
    signEvents.emit('job-end', { ok: false, duration_ms: Date.now() - jobStart, error: e?.message || String(e) });
    throw e;
  } finally {
    tee.detach();
  }
};

async function runSignCommand(options) {
  // Smoke test mode: create a 1-byte .exe in a temp dir, sign it, verify it, clean up.
  // This is the fastest possible end-to-end check that the EV token, drivers, signtool,
  // and password cache are all working — no @omega.js/desktop build required.
  if (options.smoke) {
    await runnerEnv.ensureRunnerConfig({ logger, scopes: ['signing'] });
    return smokeTest();
  }

  const strategy = Manager.getWindowsSignStrategy();

  const config   = Manager.getConfig();
  const projectRoot = process.cwd();

  // Resolve --in and --out (CLI flags) → directories of unsigned / signed artifacts.
  const inDir  = options.in  ? path.resolve(projectRoot, options.in)  : path.join(projectRoot, 'release');
  const outDir = options.out ? path.resolve(projectRoot, options.out) : path.join(projectRoot, 'release', 'signed');

  // Single-target shortcut — useful for debugging a specific failure.
  let targets;
  if (options.target) {
    const t = path.resolve(projectRoot, options.target);
    if (!jetpack.exists(t)) throw new Error(`--target file does not exist: ${t}`);
    targets = [t];
  } else {
    if (!jetpack.exists(inDir)) {
      throw new Error(`Input directory does not exist: ${inDir}`);
    }
    targets = jetpack.find(inDir, { matching: ['*.exe', '*.msi'], recursive: true, files: true, directories: false });
    if (targets.length === 0) {
      logger.warn(`No .exe / .msi files found under ${inDir} — nothing to sign.`);
      return;
    }
  }

  // Signing HERE needs the box's cert, PIN and signtool: ask for what is missing
  // in a terminal, refuse without one. The cloud strategy has no such needs.
  // After the input checks on purpose: a mistyped --target fails before anyone
  // is asked for a PIN.
  if (strategy === 'self-hosted' || strategy === 'local') {
    await runnerEnv.ensureRunnerConfig({ logger, scopes: ['signing'] });
  }

  // Verify-only mode: don't sign anything, just run signtool verify against each.
  if (options['verify-only'] || options.verifyOnly) {
    return verifyOnly(targets);
  }

  jetpack.dir(outDir);

  logger.log(`Signing ${targets.length} artifact(s) — strategy=${strategy}, in=${path.relative(projectRoot, inDir)}, out=${path.relative(projectRoot, outDir)}`);

  if (strategy === 'self-hosted' || strategy === 'local') {
    if (strategy === 'local') {
      logger.warn('strategy=local — this command will run signtool against whatever cert config the local box has. Make sure your EV token is plugged in.');
    }
    await signWithSigntool(targets, inDir, outDir);
    return;
  }

  if (strategy === 'cloud') {
    const provider = config.platforms?.win?.signing?.cloud?.provider;
    if (!provider) {
      throw new Error('strategy=cloud but no provider set (config platforms.win.signing.cloud.provider).');
    }
    await signWithCloudProvider(provider, targets, inDir, outDir);
    return;
  }

  throw new Error(`Unknown Windows signing strategy: ${strategy}`);
}

// The runner log this run may tee to, or null.
//
// Off Windows there is no box home at all, so a manual mac/linux sign drops no
// `.gh-runners/` into the cwd. And from a TEST run the box's own record is off
// limits unless the home is a scratch one — a suite pointed at a real home
// writes nothing rather than overwriting what the box did
// ([#337](https://github.com/Omega-JS-Stack/omega/issues/337)).
//
// `env` and `platform` resolve the HOME (the test seam); whether this is a test
// run is read from process.env by isTestRun, always — never from an argument.
//
// @param {object} [env] - Environment the home is resolved from.
// @param {string} [platform] - Platform the default home is resolved for.
// @returns {string|null}
function boxLogTarget(env, platform) {
  env = env || process.env;
  platform = platform || process.platform;

  const home = env.OMEGA_RUNNER_HOME
    || (platform === 'win32' ? runnerEnv.defaultRunnerHome(platform, env) : null);
  if (!home) return null;
  if (runnerEnv.isTestRun() && !runnerEnv.isScratchRunnerHome(home)) return null;

  return runnerEnv.runnerLogFile(home);
}

// signtool path (Windows SDK). Falls back to plain `signtool` on PATH.
function getSigntoolPath(env) {
  env = env || process.env;
  if (env.SIGNTOOL_PATH) return env.SIGNTOOL_PATH;
  return 'signtool'; // assume on PATH; SDK installers add it
}

// Detect whether WIN_EV_TOKEN_PATH is a SHA1 thumbprint (40 hex chars, optional spaces)
// vs. a file path. SafeNet/eToken-managed certs live in the user store and are selected
// by thumbprint via /sha1; .pfx files are passed via /f + /p.
function isThumbprint(value) {
  if (!value) return false;
  const stripped = value.replace(/\s+/g, '');
  return /^[0-9a-fA-F]{40}$/.test(stripped);
}

// Every signtool input, resolved from the environment in one place, with the
// loud named error when a required one is missing.
//
// WIN_EV_TOKEN_PATH is the ONE name for the certificate reference — the schema
// name ([#337](https://github.com/Omega-JS-Stack/omega/issues/337)). The old
// WIN_CSC_LINK alias is gone: two names for one key means two things to keep
// straight on a box nobody logs into.
function resolveSigntoolEnv(env) {
  env = env || process.env;

  const tokenRef = env.WIN_EV_TOKEN_PATH;
  if (!tokenRef) {
    throw new Error('WIN_EV_TOKEN_PATH not set — cannot sign. Set it to the EV cert SHA1 thumbprint (SafeNet/eToken) or a .pfx path.');
  }

  const password      = env.WIN_CSC_KEY_PASSWORD;
  const useThumbprint = isThumbprint(tokenRef);

  // Thumbprint mode (SafeNet/eToken): signtool finds cert in user store, SafeNet handles auth.
  // File mode (.pfx): /f + /p, password handed to signtool directly.
  if (!useThumbprint && !password) {
    throw new Error('WIN_CSC_KEY_PASSWORD not set — required when WIN_EV_TOKEN_PATH is a .pfx path.');
  }

  return {
    tokenRef,
    password,
    useThumbprint,
    signtool:     getSigntoolPath(env),
    timestampUrl: env.WIN_TIMESTAMP_URL || 'http://timestamp.sectigo.com',
  };
}

// The `signtool sign` command line, as one string. Pure, so the exact argument
// order for both cert modes is provable without a Windows box.
//
// It ends in `2>&1` because signtool writes its diagnosis to stderr and the
// retry classifier below reads `e.message` — without the redirect a wrong PIN
// can arrive as a bare exit code and get retried three times.
function buildSignCommand({ signtool, tokenRef, password, timestampUrl, outPath }) {
  const certArgs = isThumbprint(tokenRef)
    ? [`/sha1 ${tokenRef.replace(/\s+/g, '')}`]
    : [`/f "${tokenRef}"`, `/p "${password}"`];

  return [
    `"${signtool}"`,
    'sign',
    ...certArgs,
    `/tr "${timestampUrl}"`,
    '/td sha256',
    '/fd sha256',
    `"${outPath}"`,
    '2>&1',
  ].join(' ');
}

// The `signtool verify` command line. Local-only, so it stays single-shot.
function buildVerifyCommand({ signtool, outPath }) {
  return `"${signtool}" verify /pa "${outPath}"`;
}

// The sign call reaches a THIRD PARTY — the timestamp server — and that is the
// one part of signing that fails and then works seconds later (rate limit, 502,
// a dropped connection mid-handshake). So the sign call gets three attempts with
// a short backoff; verify is local and never retries.
const SIGN_ATTEMPTS       = 3;
const SIGN_RETRY_DELAY_MS = 5000;

// node-powertools' `execute` with `log: false` — what this file passes — rejects
// with `new Error(stderr || 'Command failed with exit code N')`, and the sign
// command ends in `2>&1` (it runs through a shell), so BOTH of signtool's
// streams reach `e.message` and this is classifying on signtool's own words.
//
// Failures signtool NAMES as permanent. Retrying a wrong PIN walks the EV token
// toward a lockout, and no amount of waiting conjures a certificate that isn't
// in the store — so these stop on the first attempt. Anything else (including a
// bare exit code, where signtool told us nothing) is treated as transient and
// retried, because a lost timestamp round-trip looks exactly like that.
const NON_TRANSIENT_SIGN_FAILURES = [
  /No certificates were found/i,
  /password is not correct/i,
  /token .{0,20}locked/i,
  /hash on the file is malformed/i,
];

function isTransientSignFailure(error) {
  const message = String(error?.message || error || '');
  return !NON_TRANSIENT_SIGN_FAILURES.some((re) => re.test(message));
}

// Run `cmd` with the retry policy above. Every attempt lands in the signing
// event log, so `runner monitor` shows the retries as they happen. Throws the
// last error when it gives up.
//
// `startUnlock` is called PER ATTEMPT and stopped the moment that attempt ends.
// SafeNet raises its "Token Logon" dialog on every signtool call, and the
// watcher returns as soon as it has typed once — so a single watcher wrapped
// around the whole loop leaves attempts 2 and 3 facing the dialog unattended,
// which is exactly the retry that was supposed to save the job.
async function signWithRetry(cmd, options) {
  options = options || {};
  const {
    file,
    attempts    = SIGN_ATTEMPTS,
    delayMs     = SIGN_RETRY_DELAY_MS,
    exec        = (c) => execute(c, { log: false }),
    sleep       = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    emit        = signEvents.emit,
    startUnlock = () => ({ stop: () => {} }),
  } = options;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    emit('sign-attempt', { file, attempt, of: attempts });

    const unlock = startUnlock();
    let failure;
    try {
      return await exec(cmd);
    } catch (e) {
      failure = e;
    } finally {
      // Stopped before the verdict and the backoff — nothing polls the desktop
      // while we are only waiting.
      unlock.stop();
    }

    if (attempt === attempts || !isTransientSignFailure(failure)) throw failure;
    emit('sign-retry', {
      file,
      attempt,
      of:          attempts,
      retry_in_ms: delayMs,
      error:       failure?.message || String(failure),
    });
    await sleep(delayMs);
  }

  // Unreachable: the loop returns on success and throws on the last attempt.
  throw new Error(`signWithRetry exhausted ${attempts} attempts without a verdict`);
}

async function signWithSigntool(targets, inDir, outDir) {
  const projectRoot = process.cwd();
  const { tokenRef, password, useThumbprint, signtool, timestampUrl } = resolveSigntoolEnv();

  // Track which signed installers are NSIS-style .exe so we can write latest.yml
  // for them after the signing loop. .msi targets use Windows Installer's own
  // update mechanism (not electron-updater) and don't need a yml.
  const signedExes = [];

  for (const target of targets) {
    const rel = path.relative(inDir, target);
    const outPath = path.join(outDir, rel);
    jetpack.dir(path.dirname(outPath));

    // Copy first, sign in place at the output location (signtool modifies in-place).
    jetpack.copy(target, outPath, { overwrite: true });

    const cmd = buildSignCommand({ signtool, tokenRef, password, timestampUrl, outPath });

    logger.log(`Signing ${path.relative(projectRoot, outPath)}${useThumbprint ? ' (thumbprint mode)' : ''}...`);

    const fileBytes = (() => { try { return fs.statSync(outPath).size; } catch (_) { return null; } })();
    signEvents.emit('sign-start', {
      file: path.basename(outPath),
      out_path: outPath,
      bytes: fileBytes,
      mode:  useThumbprint ? 'thumbprint' : 'pfx',
    });

    // In thumbprint mode against a SafeNet/eToken cert, signtool triggers a
    // "Token Logon" dialog. signWithRetry starts one watcher per attempt to type
    // the password into it, and stops each when that attempt ends.
    const fileStart = Date.now();
    try {
      await signWithRetry(cmd, {
        file: path.basename(outPath),
        startUnlock: () => (useThumbprint ? startAutoUnlock({ password, logger }) : { stop: () => {} }),
      });
    } catch (e) {
      signEvents.emit('sign-fail', {
        file: path.basename(outPath),
        duration_ms: Date.now() - fileStart,
        phase: 'signtool',
        error: e?.message || String(e),
      });
      throw e;
    }

    // Verify is a local check with no third party in it — one shot.
    const verifyCmd = buildVerifyCommand({ signtool, outPath });
    try {
      await execute(verifyCmd, { log: false });
    } catch (e) {
      signEvents.emit('sign-fail', {
        file: path.basename(outPath),
        duration_ms: Date.now() - fileStart,
        phase: 'verify',
        error: e?.message || String(e),
      });
      throw e;
    }
    signEvents.emit('sign-done', {
      file: path.basename(outPath),
      duration_ms: Date.now() - fileStart,
    });
    logger.log(logger.format.green(`✓ Signed: ${path.relative(projectRoot, outPath)}`));

    if (outPath.toLowerCase().endsWith('.exe')) {
      signedExes.push({ filePath: outPath, urlName: path.basename(outPath) });
    }
  }

  // Generate latest.yml + per-exe .blockmap for the signed NSIS installers. Without
  // this, electron-updater on Windows clients has no way to discover the new release
  // (mac/linux equivalents are produced by electron-builder during their publish step,
  // but Windows is split into a post-build sign job so we have to write the yml here).
  if (signedExes.length > 0) {
    const pkg = Manager.getPackage('project') || {};
    const version = pkg.version;
    if (!version) {
      logger.warn('Could not determine version from package.json — skipping latest.yml generation.');
    } else {
      logger.log(`Generating Windows auto-updater feed (latest.yml) for ${signedExes.length} installer(s)...`);
      try {
        await writeUpdateInfo({
          signedExes,
          outDir,
          version,
          logger,
        });
      } catch (e) {
        // Don't fail the whole sign step if yml generation hits something unexpected —
        // the signed exe is still valid + uploadable. But this IS a real problem
        // because auto-updates won't work, so log loudly.
        logger.error(`latest.yml generation failed: ${e.message}`);
        logger.error('  Signed binary is OK but Windows auto-updater will not see this release.');
      }
    }
  }
}

// Verify-only: run signtool verify /pa against each target, report whether it's signed.
// Doesn't fail if some are unsigned — reports each.
async function verifyOnly(targets) {
  const signtool = getSigntoolPath();
  let signed = 0;
  let unsigned = 0;
  let errored = 0;

  for (const t of targets) {
    try {
      const out = await execute(`"${signtool}" verify /pa /v "${t}"`, { log: false });
      const trimmed = String(out || '').trim();
      // signtool prints things like "Successfully verified" or details about the chain.
      if (/Successfully verified/i.test(trimmed)) {
        logger.log(logger.format.green(`✓ Signed: ${t}`));
        // Pull the subject CN out for visibility.
        const cn = trimmed.match(/Issued to:\s*(.+)/i)?.[1];
        if (cn) logger.log(`  Subject: ${cn.trim()}`);
        signed += 1;
      } else {
        logger.warn(`? Unclear verify output for: ${t}`);
        logger.log(trimmed.split('\n').slice(0, 5).join('\n'));
        errored += 1;
      }
    } catch (e) {
      // signtool exits non-zero on unsigned files.
      logger.warn(`✗ Unsigned or invalid: ${t}`);
      const msg = String(e?.message || e).split('\n').slice(0, 3).join(' ');
      logger.log(`  ${msg}`);
      unsigned += 1;
    }
  }

  logger.log(`Verify summary: ${signed} signed, ${unsigned} unsigned, ${errored} unclear (of ${targets.length} total).`);
  return { signed, unsigned, errored, total: targets.length };
}

// A real PE/COFF .exe to sign when there is no build to sign: %WINDIR%\System32\where.exe
// (small, always present, and copying it is fine). One home for that choice, so the smoke
// test and the Windows-gated end-to-end suite sign the same thing.
function copySampleExe(destPath, env) {
  env = env || process.env;

  const sourceExe = path.join(env.WINDIR || 'C:\\Windows', 'System32', 'where.exe');
  if (!jetpack.exists(sourceExe)) {
    throw new Error(`Could not find a sample .exe to sign at ${sourceExe}. Pass --target <path> instead.`);
  }
  jetpack.copy(sourceExe, destPath, { overwrite: true });

  return destPath;
}

// Smoke test: write a 1-byte .exe to %TEMP%, run the full self-hosted signing flow against it.
// Validates that EV token, SafeNet drivers, signtool, and the password cache are all functional
// without needing an actual @omega.js/desktop build. Cleans up after itself.
async function smokeTest() {
  if (process.platform !== 'win32') {
    throw new Error('--smoke is Windows-only (signtool is required).');
  }

  const { tokenRef, useThumbprint } = resolveSigntoolEnv();

  const tmp    = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-smoke-'));
  const target = copySampleExe(path.join(tmp, 'desktop-smoke-test.exe'));

  logger.log(`Smoke test: signing a temp copy of where.exe at ${target}`);
  logger.log(`Cert ref: ${tokenRef}${useThumbprint ? ' (thumbprint mode — SafeNet handles auth)' : ' (file mode)'}`);

  try {
    await signWithSigntool([target], path.dirname(target), path.dirname(target));
    logger.log(logger.format.green('✓ Smoke test passed — EV token + signtool + password cache all working.'));
  } catch (e) {
    logger.error(`Smoke test FAILED: ${e.message}`);
    logger.log('Most common causes:');
    logger.log('  • EV token not plugged in or not detected by SafeNet');
    logger.log('  • SafeNet driver not installed');
    logger.log('  • WIN_CSC_KEY_PASSWORD wrong or token locked (check tray icon)');
    logger.log('  • signtool.exe not on PATH (Windows SDK or VS Build Tools required)');
    throw e;
  } finally {
    try { jetpack.remove(tmp); } catch (e) { /* ignore */ }
  }
}

async function signWithCloudProvider(provider, targets, inDir, outDir) {
  // Provider modules live in src/lib/sign-providers/<name>.js. Each exports
  //   async function sign({ targets, inDir, outDir, projectRoot, env }) { ... }
  let providerModule;
  try {
    providerModule = require(path.join(__dirname, '..', 'lib', 'sign-providers', `${provider}.js`));
  } catch (e) {
    throw new Error(`Cloud provider "${provider}" is not yet implemented (no src/lib/sign-providers/${provider}.js). Supported: azure, sslcom, digicert.`);
  }

  if (typeof providerModule.sign !== 'function') {
    throw new Error(`sign-providers/${provider}.js does not export a sign() function.`);
  }

  await providerModule.sign({
    targets,
    inDir,
    outDir,
    projectRoot: process.cwd(),
    env:         process.env,
    logger,
  });
}

// Exports for testing — the pure halves of the signer: what the command line
// looks like, which env keys feed it, and when a failure is worth retrying.
module.exports.isThumbprint           = isThumbprint;
module.exports.boxLogTarget           = boxLogTarget;
module.exports.resolveSigntoolEnv     = resolveSigntoolEnv;
module.exports.buildSignCommand       = buildSignCommand;
module.exports.buildVerifyCommand     = buildVerifyCommand;
module.exports.signWithRetry          = signWithRetry;
module.exports.isTransientSignFailure = isTransientSignFailure;
module.exports.SIGN_ATTEMPTS          = SIGN_ATTEMPTS;
module.exports.SIGN_RETRY_DELAY_MS    = SIGN_RETRY_DELAY_MS;

// Exports for the Windows-gated end-to-end suite — the halves that shell out to
// signtool for real. They only run where signtool and the EV token are
// (suites/build/sign-windows-e2e.test.js gates on exactly that).
module.exports.signWithSigntool       = signWithSigntool;
module.exports.verifyOnly             = verifyOnly;
module.exports.copySampleExe          = copySampleExe;
