/**
 * The standing wizard-journey e2e — the full consumer story, outside the
 * monorepo, as one repeatable lane (cp195; the scripted form of cp194's
 * hand rehearsal):
 *
 *   birth   → the REAL onboard wizard (flags mode) in a temp dir OUTSIDE
 *             the monorepo — where hoist-luck can't save anything
 *   link    → `omega i local` from the website target (tree-wide file: flip +
 *             ONE brand-root install; also links @omega.js/manager at the
 *             brand root so brand-level verbs exist at all)
 *   boot    → `omega dev` at the brand root (web + backend emulator, N7
 *             ports), probe the rendered homepage over the announced URL
 *   manage  → headless creds-scrubbed manage; scorecard from the run file
 *             (.omega/runs/*.json): update must succeed, no service may
 *             error except the allowed set (testing probes the live URL of
 *             a never-deployed brand — designed to fail pre-first-deploy)
 *
 * Spec-driven ({ id, url, targets, expect }) so a corpus of brand shapes
 * can reuse it. Heavy by design — real registry installs, real builds —
 * so preconditions (network, java) SKIP the run cleanly when unmet unless
 * { strict }. Install-machinery legs (onboard/link) inherit the
 * machine env; runtime legs (dev boot, manage) run with credential-shaped
 * vars scrubbed — the journey must never reach a real cloud.
 *
 * Layering: this module spawns framework/manager BINS by path and never
 * requires @omega.js/manager (the manager depends on devkit, not the
 * reverse).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { spawn, spawnSync } = require('node:child_process');
const { createStepsLog } = require('./steps-log.js');

// Ceilings, not expectations — cold-cache registry installs and the four
// real target builds dominate; a warm rerun finishes far inside them.
const TIMEOUTS = {
  onboard: 120000,
  link: 1800000,
  bootReady: 420000,
  probe: 120000,
  manage: 2400000,
};

// Boot ordering preference (cosmetic — matches the rehearsal); targets
// themselves come from the scaffold output on disk, never from a map here.
const TARGET_ORDER = ['website', 'backend', 'desktop', 'extension', 'mobile'];

// Lockstep with @omega.js/backend cli/commands/emulator.js (same marker the
// devkit e2e-harness waits for — it fires AFTER persona seeding).
const EMULATOR_READY = /Emulator ready\. Press Ctrl\+C/i;
// The web dev server's announce line (packages/web src/commands/dev.js).
const DEV_SERVER_URL = /Dev server: (https?:\/\/localhost:\d+)/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Strip credential-shaped variables from an env copy — the runtime legs of
 * the journey (dev boot, manage) must prove themselves without any machine
 * credentials in reach.
 *
 * @param {Object} env - Source environment (not mutated)
 * @returns {Object} Scrubbed copy
 */
function scrubCredentialEnv(env) {
  const CREDENTIAL_SHAPE = /(TOKEN|SECRET|PASSWORD|PASSPHRASE|API_KEY|APIKEY|_KEY$|CLIENT_ID|CLIENT_SECRET|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS|AUTH)/i;
  const scrubbed = {};
  for (const [name, value] of Object.entries(env)) {
    if (!CREDENTIAL_SHAPE.test(name)) {
      scrubbed[name] = value;
    }
  }
  return scrubbed;
}

/**
 * Journey preconditions — the run needs the npm registry (framework dep
 * trees install for real) and java (the Firestore/Database emulators).
 *
 * @returns {Promise<{ ok: boolean, missing: string[] }>}
 */
async function checkPreconditions() {
  const missing = [];

  const online = await new Promise((resolve) => {
    const request = https.get('https://registry.npmjs.org/-/ping', { timeout: 8000 }, (response) => {
      response.resume();
      resolve(response.statusCode > 0);
    });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
  if (!online) {
    missing.push('npm registry unreachable (network)');
  }

  const java = spawnSync('java', ['-version'], { stdio: 'ignore' });
  if (java.status !== 0) {
    missing.push('java (firestore/database emulators)');
  }

  return { ok: missing.length === 0, missing };
}

/** Newest run file in <brandRoot>/.omega/runs (ISO-stamped names sort). */
function latestRunFile(brandRoot) {
  const runsDir = path.join(brandRoot, '.omega', 'runs');
  let names;
  try {
    names = fs.readdirSync(runsDir).filter((name) => name.endsWith('.json')).sort();
  } catch (e) {
    return null;
  }
  return names.length > 0 ? path.join(runsDir, names.at(-1)) : null;
}

/** The brand's target dirs (scaffold output truth), in TARGET_ORDER. */
function discoverBrandTargets(brandRoot) {
  const targetsDir = path.join(brandRoot, 'targets');
  let entries;
  try {
    entries = fs.readdirSync(targetsDir);
  } catch (e) {
    return [];
  }
  return entries
    .filter((name) => fs.existsSync(path.join(targetsDir, name, 'package.json')))
    .sort((a, b) => {
      const rank = (name) => { const i = TARGET_ORDER.indexOf(name); return i === -1 ? TARGET_ORDER.length : i; };
      return rank(a) - rank(b) || a.localeCompare(b);
    })
    .map((name) => path.join(targetsDir, name));
}

/** GET a URL (self-signed ok), resolving { status, body }. */
function fetchPage(url) {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(url, { rejectUnauthorized: false, timeout: 15000 }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('timeout', () => { request.destroy(new Error(`timeout fetching ${url}`)); });
    request.on('error', reject);
  });
}

class JourneyRun {
  constructor(options) {
    this.monorepoRoot = fs.realpathSync(options.monorepoRoot);
    this.spec = options.spec;
    this.keep = Boolean(options.keep);
    this.logDir = options.logDir;
    this.log = options.log || console.log;

    // Per-step verdicts on disk, in the SAME format the root e2e runners use
    // (#197): the stage logs beside it say what a leg printed, this says which
    // leg broke. `grep '^FAIL' <logDir>/steps.log` after a run that died, or
    // one read back hours later.
    this.stepsLog = createStepsLog(options.logDir);

    this.tempRoot = null;
    this.brandRoot = null;
    this.devStack = null; // live `omega dev` handle
    this.steps = [];
    this.logIndex = 0;
  }

  /**
   * E2eHarness-style step: ✓/✗ line, collected result, throw on failure — and
   * the verdict written to steps.log as it lands, so a SIGKILLed run still
   * names the leg it died on.
   */
  async step(name, fn) {
    const startedAt = Date.now();
    try {
      const detail = await fn();
      this.steps.push({ name, ok: true });
      this.stepsLog.pass(name, detail);
      this.log(`  ✓ ${name}${detail ? ` (${detail})` : ''} [${Math.round((Date.now() - startedAt) / 1000)}s]`);
    } catch (error) {
      this.steps.push({ name, ok: false, error: error.message });
      this.stepsLog.fail(name, error);
      this.log(`  ✗ ${name}\n      ${error.message}`);
      throw error;
    }
  }

  logFile(stage) {
    this.logIndex += 1;
    return path.join(this.logDir, `${String(this.logIndex).padStart(2, '0')}-${stage}.log`);
  }

  /**
   * Spawn a child (own process group), tee output to a stage log, and
   * resolve on exit — rejecting on timeout or nonzero exit.
   */
  runToExit(stage, command, args, options) {
    const logFile = this.logFile(stage);
    const logStream = fs.createWriteStream(logFile);
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    child.stdout.on('data', (chunk) => logStream.write(chunk));
    child.stderr.on('data', (chunk) => logStream.write(chunk));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stopGroup(child); // graceful escalation continues in the background
        reject(new Error(`${stage} exceeded ${options.timeout / 60000} min (log: ${logFile})`));
      }, options.timeout);
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (code) => {
        clearTimeout(timer);
        logStream.end();
        if (code === 0 || (code !== null && options.allowNonzeroExit)) {
          resolve({ code, logFile });
        } else {
          reject(new Error(`${stage} exited ${code} (log: ${logFile})`));
        }
      });
    });
  }

  /**
   * Spawn a long-lived server child and resolve once every ready pattern
   * has matched a line of its output. Returns { child, matches, stop }.
   */
  startServer(stage, command, args, options) {
    const logFile = this.logFile(stage);
    const logStream = fs.createWriteStream(logFile);
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    const matches = {};
    const pending = new Map(Object.entries(options.readyPatterns));
    let buffered = '';

    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stopGroup(child); // graceful escalation continues in the background
        reject(new Error(`${stage} not ready after ${options.timeout / 60000} min — waiting on: ${[...pending.keys()].join(', ')} (log: ${logFile})`));
      }, options.timeout);

      const scan = (chunk) => {
        const text = chunk.toString();
        logStream.write(text);
        buffered = (buffered + text).slice(-65536);
        for (const [name, pattern] of pending) {
          const match = buffered.match(pattern);
          if (match) {
            matches[name] = match;
            pending.delete(name);
          }
        }
        if (pending.size === 0) {
          clearTimeout(timer);
          resolve();
        }
      };

      child.stdout.on('data', scan);
      child.stderr.on('data', scan);
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (pending.size > 0) {
          reject(new Error(`${stage} exited early (code ${code}, log: ${logFile})`));
        }
      });
    });

    const stop = () => stopGroup(child);

    return { child, matches, ready, stop, logFile };
  }

  /** The consumer entrypoint: the brand's own hoisted dispatcher bin. */
  dispatcherBin(fromDir) {
    for (const dir of [fromDir, this.brandRoot]) {
      const bin = path.join(dir, 'node_modules', '.bin', 'omega');
      if (fs.existsSync(bin)) return bin;
    }
    throw new Error(`no omega bin under ${fromDir} or the brand root — did the link leg run?`);
  }

  childEnv(extra, { scrub = false } = {}) {
    const base = scrub ? scrubCredentialEnv(process.env) : { ...process.env };
    return { ...base, OMEGA_MONOREPO: this.monorepoRoot, ...extra };
  }
}

function killGroup(child, signal = 'SIGKILL') {
  try {
    process.kill(-child.pid, signal);
  } catch (e) {
    try { child.kill(signal); } catch (e2) { /* already gone */ }
  }
}

/**
 * Graceful group shutdown: SIGINT first (firebase-tools reaps its java
 * emulators on SIGINT; an immediate SIGKILL orphans them — cp195 leak),
 * escalate to SIGKILL only if the group is still alive after the grace
 * window.
 */
async function stopGroup(child, graceMs = 20000) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  killGroup(child, 'SIGINT');
  const outcome = await Promise.race([exited.then(() => 'clean'), sleep(graceMs)]);
  if (outcome !== 'clean') {
    killGroup(child, 'SIGKILL');
    await Promise.race([exited, sleep(5000)]);
  }
}

/**
 * Emulator processes already orphaned onto pid 1 — the #690 leak signature.
 * Read before boot and again after shutdown: only NEW pids indict this run
 * (another session's leftovers are not this journey's verdict). Returns null
 * where `ps` is unavailable, and the caller skips the check.
 */
function emulatorOrphans() {
  const ps = spawnSync('ps', ['ax', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' });
  if (ps.error || ps.status !== 0) return null;
  return ps.stdout.split('\n').reduce((orphans, line) => {
    const match = line.match(/^\s*(\d+)\s+1\s+(.*)$/);
    if (match && /firebase emulators:start|cloud-firestore-emulator|pubsub-emulator/.test(match[2])) {
      orphans.push({ pid: Number(match[1]), command: match[2] });
    }
    return orphans;
  }, []);
}

/**
 * Run the full wizard journey for one brand spec.
 *
 * @param {Object} options
 * @param {string} options.monorepoRoot - The omega monorepo (framework source)
 * @param {Object} options.spec - { id, url, targets: string[], expect: { brandName, themeId } }
 * @param {string} options.logDir - Where stage logs land (created; survives the run)
 * @param {boolean} [options.keep] - Keep the temp brand even on success
 * @param {boolean} [options.strict] - Unmet preconditions fail instead of skip
 * @param {Function} [options.log] - Line sink (default console.log)
 * @returns {Promise<{ status: 'passed'|'failed'|'skipped', reason?: string, steps: Array, brandRoot: ?string }>}
 */
async function runJourney(options) {
  const run = new JourneyRun(options);
  const { spec } = run;
  fs.mkdirSync(run.logDir, { recursive: true });

  run.log(`\nWizard journey — brand ${spec.id} (${spec.targets.join(', ')}) OUTSIDE the monorepo`);
  run.log(`  logs: ${run.logDir}\n`);

  // Preconditions — skip cleanly (not red) when the machine can't run this
  const preconditions = await checkPreconditions();
  if (!preconditions.ok) {
    const reason = `preconditions unmet: ${preconditions.missing.join('; ')}`;
    if (!options.strict) {
      run.log(`  ⊘ SKIPPED — ${reason}`);
      return { status: 'skipped', reason, steps: run.steps, brandRoot: null };
    }
    run.log(`  ✗ ${reason} (strict)`);
    run.stepsLog.abort(reason);
    return { status: 'failed', reason, steps: run.steps, brandRoot: null };
  }

  let failed = false;
  try {
    // ── Birth — the real wizard, flags mode, in-place ─────────────────────
    await run.step(`onboard scaffolds ${spec.id}`, async () => {
      run.tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'omega-journey-'));
      run.brandRoot = path.join(run.tempRoot, spec.id);
      fs.mkdirSync(run.brandRoot);

      // cli-run.js self-executes when spawned as main (the omega-manager bin
      // was retired; #148).
      const managerBin = path.join(run.monorepoRoot, 'packages', 'manager', 'dist', 'cli-run.js');
      await run.runToExit('onboard', process.execPath, [
        managerBin, 'onboard',
        `--id=${spec.id}`, `--url=${spec.url}`, `--targets=${spec.targets.join(',')}`,
      ], { cwd: run.brandRoot, env: run.childEnv(), timeout: TIMEOUTS.onboard });

      for (const file of ['config/omega.json5', 'package.json', '.env', '.gitignore']) {
        if (!fs.existsSync(path.join(run.brandRoot, file))) {
          throw new Error(`scaffold missing ${file}`);
        }
      }
      return run.brandRoot;
    });

    const targets = discoverBrandTargets(run.brandRoot);

    // ── Link — one `i local` from the website target links the whole tree ─
    await run.step('`omega i local` links every framework + the manager (one tree install)', async () => {
      const linkFrom = targets.find((dir) => path.basename(dir) === 'website') || targets[0];
      const webBin = path.join(run.monorepoRoot, 'packages', 'web', 'bin', 'omega');
      await run.runToExit('link', process.execPath, [webBin, 'i', 'local'],
        { cwd: linkFrom, env: run.childEnv(), timeout: TIMEOUTS.link });

      // Every target's framework — and the brand root's manager — must resolve
      // to the monorepo copy (realpath through the hoisted symlinks).
      const resolveFrom = (dir, name) => {
        let current = dir;
        while (true) {
          const candidate = path.join(current, 'node_modules', name);
          if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
          const parent = path.dirname(current);
          if (parent === current) return null;
          current = parent;
        }
      };
      const misses = [];
      for (const dir of [run.brandRoot, ...targets]) {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
          if (!name.startsWith('@omega.js/')) continue;
          const real = resolveFrom(dir, name);
          if (!real || !real.startsWith(run.monorepoRoot)) {
            misses.push(`${path.basename(dir)}:${name} → ${real || 'unresolved'}`);
          }
        }
      }
      if (misses.length > 0) {
        throw new Error(`not linked to the monorepo: ${misses.join(', ')}`);
      }
      return `${targets.length} targets + brand root`;
    });

    // ── Boot — `omega dev` at the brand root, probe the homepage ──────────
    const bootsWeb = targets.some((dir) => path.basename(dir) === 'website');
    const bootsBackend = targets.some((dir) => path.basename(dir) === 'backend');
    if (bootsWeb || bootsBackend) {
      const orphansAtBoot = emulatorOrphans();
      await run.step(`\`omega dev\` boots${bootsWeb ? ' web' : ''}${bootsBackend ? ' + backend emulator' : ''}`, async () => {
        const readyPatterns = {};
        if (bootsWeb) readyPatterns.web = DEV_SERVER_URL;
        if (bootsBackend) readyPatterns.backend = EMULATOR_READY;

        run.devStack = run.startServer('dev', run.dispatcherBin(run.brandRoot), ['dev'], {
          cwd: run.brandRoot,
          env: run.childEnv({ OMEGA_NON_INTERACTIVE: '1' }, { scrub: true }),
          readyPatterns,
          timeout: TIMEOUTS.bootReady,
        });
        await run.devStack.ready;
        return bootsWeb ? run.devStack.matches.web[1] : 'emulator ready';
      });

      if (bootsWeb) {
        await run.step('homepage renders branded + themed', async () => {
          const url = run.devStack.matches.web[1];
          const deadline = Date.now() + TIMEOUTS.probe;
          let last = null;
          while (Date.now() < deadline) {
            try {
              const page = await fetchPage(`${url}/`);
              last = `status ${page.status}`;
              if (page.status === 200
                && page.body.includes(spec.expect.brandName)
                && page.body.includes(`data-theme-id="${spec.expect.themeId}"`)) {
                return `${url}/ → 200, "${spec.expect.brandName}", theme ${spec.expect.themeId}`;
              }
              if (page.status === 200) {
                const missing = [
                  !page.body.includes(spec.expect.brandName) && `brand name "${spec.expect.brandName}"`,
                  !page.body.includes(`data-theme-id="${spec.expect.themeId}"`) && `theme id "${spec.expect.themeId}"`,
                ].filter(Boolean);
                last = `200 but missing ${missing.join(' + ')}`;
              }
            } catch (error) {
              last = error.message;
            }
            await sleep(2000);
          }
          throw new Error(`homepage never satisfied the probe (last: ${last})`);
        });

        // Spec §8: dev boot materializes the sample filler under the target's
        // gitignored .omega/sample-content with LIVE rolling dates (this env
        // carries no OMEGA_SAMPLE_ANCHOR pin — the newest sample post is
        // authored 10 days before the corpus epoch, so it must land ~10 days
        // before today; ±1 day absorbs a UTC midnight between boot and now).
        await run.step('sample content materialized (gitignored tree, rolling dates)', async () => {
          const sampleRoot = path.join(run.brandRoot, 'targets', 'website', '.omega', 'sample-content');
          const posts = fs.readdirSync(path.join(sampleRoot, '_posts')).sort();
          if (posts.length !== 11) throw new Error(`expected 11 sample posts, found ${posts.length}`);
          if (fs.readFileSync(path.join(sampleRoot, '.gitignore'), 'utf8') !== '*\n') {
            throw new Error('self-.gitignore missing — the tree must be uncommittable');
          }
          const newest = posts[posts.length - 1].slice(0, 10);
          const ageDays = Math.round((Date.now() - Date.parse(`${newest}T00:00:00Z`)) / 86_400_000);
          if (ageDays < 9 || ageDays > 11) {
            throw new Error(`newest sample post is dated ${newest} (${ageDays}d ago) — rolling dates broken`);
          }
          return `11 posts, newest ${newest} (~10d ago), self-gitignored`;
        });
      }

      await run.step('dev stack shuts down cleanly, leaving no orphaned emulator', async () => {
        await run.devStack.stop();
        run.devStack = null;
        // The #690 proof: a shutdown that killed npm but not the emulator
        // leaves NEW pid-1 processes holding the ports. The tail of the
        // backend's own sweep can lag the stop by a beat — poll briefly.
        const before = new Set((orphansAtBoot || []).map((proc) => proc.pid));
        const deadline = Date.now() + 5000;
        let leaked = [];
        for (;;) {
          leaked = (emulatorOrphans() || []).filter((proc) => !before.has(proc.pid));
          if (leaked.length === 0 || Date.now() > deadline) break;
          await sleep(250);
        }
        if (leaked.length > 0) {
          throw new Error(`emulator leaked onto pid 1 (#690): ${leaked.map((proc) => `${proc.pid} ${proc.command}`).join('; ')}`);
        }
        return orphansAtBoot === null ? 'stopped (no ps — orphan check skipped)' : 'no orphaned emulator left behind';
      });
    }

    // ── Manage — headless, creds scrubbed, judged by the run file ─────────
    await run.step('headless manage: update builds every target; no service errors beyond the allowed set', async () => {
      // Exit code is judged via the run file — a designed testing-service
      // error (live probe of a never-deployed brand) may flip the exit.
      // 'manage' is the named verb (#229) — bare `omega` prints help now, so a
      // bare spawn here would leave the boot-lane run file as the newest one.
      await run.runToExit('manage', run.dispatcherBin(run.brandRoot), ['manage'], {
        cwd: run.brandRoot,
        env: run.childEnv({ OMEGA_NON_INTERACTIVE: '1' }, { scrub: true }),
        timeout: TIMEOUTS.manage,
        allowNonzeroExit: true,
      });

      const runFile = latestRunFile(run.brandRoot);
      if (!runFile) {
        throw new Error('manage left no .omega/runs/*.json run file');
      }
      const services = (JSON.parse(fs.readFileSync(runFile, 'utf8')).services || []);
      const byName = Object.fromEntries(services.map((entry) => [entry.service, entry]));

      if (byName.update?.status !== 'success') {
        throw new Error(`update service ${byName.update ? byName.update.status : 'missing'} — ${byName.update?.error || 'no error detail'} (${runFile})`);
      }
      const allowedErrors = new Set(spec.allowedServiceErrors || ['testing']);
      const unexpected = services.filter((entry) => entry.status === 'error' && !allowedErrors.has(entry.service));
      if (unexpected.length > 0) {
        throw new Error(`unexpected service errors: ${unexpected.map((entry) => `${entry.service} (${entry.error || 'no detail'})`).join(', ')} (${runFile})`);
      }

      if (bootsWeb && !fs.existsSync(path.join(run.brandRoot, 'targets', 'website', 'dist', 'index.html'))) {
        throw new Error('update reported success but targets/website/dist/index.html is missing');
      }
      return `${services.length} services; update success; errors only in {${[...allowedErrors].join(', ')}}`;
    });
  } catch (error) {
    failed = true;
    // step() recorded its own verdict; a throw from BETWEEN the steps has none.
    run.stepsLog.abort(error);
  } finally {
    if (run.devStack) {
      await run.devStack.stop().catch(() => {});
      run.devStack = null;
    }
  }

  // Teardown — keep the brand on failure (or by request) for debugging
  if (run.tempRoot && !failed && !run.keep) {
    fs.rmSync(run.tempRoot, { recursive: true, force: true });
  } else if (run.tempRoot) {
    run.log(`\n  brand kept for inspection: ${run.brandRoot}`);
  }

  run.log(failed ? '\n  Wizard journey FAILED\n' : '\n  Wizard journey PASSED\n');
  return { status: failed ? 'failed' : 'passed', steps: run.steps, brandRoot: failed || run.keep ? run.brandRoot : null };
}

// JourneyRun is exported for its unit pins — the step recorder is testable
// without a two-hour brand birth; nothing else constructs one.
module.exports = { runJourney, JourneyRun, scrubCredentialEnv, checkPreconditions, latestRunFile, discoverBrandTargets };
