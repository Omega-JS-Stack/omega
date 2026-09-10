// End-to-end tests for the Windows signer — the REAL signtool, against the REAL
// EV token, on the box that has them ([#337](https://github.com/Omega-JS-Stack/omega/issues/337)).
// sign-windows.test.js proves everything around signtool (command lines, retry
// policy, env keys) anywhere; this file proves the part only the signing box can
// answer: that a copy of where.exe comes back signed, that verify agrees, that
// the event log has the trail, and that the `windows-sign` job's own command
// entry lands a signed file in release/signed.
//
// Nothing here is mocked, so nothing here runs off Windows: every case gates on
// the platform, on signtool being reachable, on a configured token, and on the
// project signing HERE rather than in the cloud — a Windows dev box missing any
// of those skips instead of failing. The one case that runs everywhere pins the
// gate itself.
//
// On the box these drive the REAL EV token — a real signature, a real PIN
// against a lockout counter — so they are an `--extended` lane, asked for
// deliberately: `npx omega test --extended desktop:build/sign-windows-e2e`.
// The bare lane skips them wherever it runs, the box included.

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const jetpack = require('fs-jetpack');
const defineCases = require('@omega.js/devkit/test/define-cases');

const signerPath = path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js');
const eventsPath = path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'sign-events.js');
const signWindows = require(signerPath);
const Manager = new (require(path.join(__dirname, '..', '..', '..', 'build.js')))();

const NOT_WINDOWS  = 'Windows-only: signtool + the EV token live on the signing box';
const NO_SIGNTOOL  = 'signtool is not reachable — install the Windows SDK / VS Build Tools, or set SIGNTOOL_PATH';
const CLOUD        = 'strategy=cloud — the windows-sign job runs on hosted windows-latest, not against this box\'s token';
const NOT_EXTENDED = 'extended tests skipped — pass --extended or set TEST_EXTENDED_MODE=true';

// Why this run cannot sign for real, or null when it can. Pure: the platform,
// the environment, whether signtool was found, and the configured signing
// strategy all arrive as arguments, so the gate is provable on a Mac even
// though nothing it guards is.
function gateReason(platform, env, hasSigntool, strategy) {
  if (platform !== 'win32') return NOT_WINDOWS;
  if (!hasSigntool) return NO_SIGNTOOL;

  // A cloud-strategy project sends its windows-sign job to a hosted
  // windows-latest that calls a provider's CLI — signtool and the token here
  // are not the path it takes, so these cases have nothing to prove. Decided
  // BEFORE the token: a cloud box is not supposed to have one.
  if (strategy === 'cloud') return CLOUD;

  try {
    signWindows.resolveSigntoolEnv(env);
  } catch (e) {
    return `no EV token configured on this box: ${e.message}`;
  }

  return null;
}

// Only ever called on Windows (the platform arm short-circuits first), where an
// explicit SIGNTOOL_PATH is the binary itself and anything else has to be on PATH.
function signtoolOnPath(env) {
  env = env || process.env;
  if (env.SIGNTOOL_PATH) return jetpack.exists(env.SIGNTOOL_PATH) === 'file';
  return spawnSync('where', ['signtool'], { encoding: 'utf8' }).status === 0;
}

function currentGate() {
  // Extended mode FIRST: these cases sign for real against the EV token, so the
  // opt-in decides before anything about the box does. Read from the
  // environment at call time, never a module const, so the gate case can take
  // the variable away and prove this arm.
  const extended = process.env.TEST_EXTENDED_MODE === 'true' || process.env.TEST_EXTENDED_MODE === '1';
  if (!extended) return NOT_EXTENDED;

  // The strategy comes from the project's own config — the same call the signer
  // makes — and is only worth resolving where the rest of the gate has passed.
  if (process.platform !== 'win32') return gateReason(process.platform, process.env, false, null);
  return gateReason(process.platform, process.env, signtoolOnPath(process.env), Manager.getWindowsSignStrategy());
}

// The signer, loaded with its event log pointed inside this suite's scratch
// tree. sign-events resolves that path ONCE, at require time, so the redirect
// has to happen before the signer pulls it in — otherwise a test run appends to
// the box's real signing trail and `runner monitor` shows test events as job
// history. Suite cleanup restores the process-wide instances.
function signerFor(ctx) {
  if (ctx.state.signer) return ctx.state.signer;

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-sign-e2e-'));
  ctx.state.scratch     = scratch;
  ctx.state.logPath     = path.join(scratch, 'events', 'omega-signing.log');
  ctx.state.origSignLog = process.env.OMEGA_SIGN_LOG;
  process.env.OMEGA_SIGN_LOG = ctx.state.logPath;

  delete require.cache[require.resolve(eventsPath)];
  delete require.cache[require.resolve(signerPath)];
  ctx.state.signer = require(signerPath);

  return ctx.state.signer;
}

function readEvents(logPath) {
  if (!jetpack.exists(logPath)) return [];
  return String(jetpack.read(logPath) || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'sign-windows (e2e) — real signtool against the EV token [Windows only]',
  cleanup: (ctx) => {
    // Nothing was loaded when every case skipped — leave the environment alone.
    if (!ctx.state.scratch) return;

    if (ctx.state.origSignLog === undefined) delete process.env.OMEGA_SIGN_LOG;
    else process.env.OMEGA_SIGN_LOG = ctx.state.origSignLog;

    delete require.cache[require.resolve(eventsPath)];
    delete require.cache[require.resolve(signerPath)];
    require(signerPath);

    jetpack.remove(ctx.state.scratch);
  },
  tests: [
    {
      name: 'the gate names why a run cannot sign — platform, signtool, the strategy, the token',
      run: (ctx) => {
        // The only case that runs everywhere: it asserts the skip reasons the
        // rest of this suite reports, so a Mac run proves the gate rather than
        // proving nothing.
        const token = { WIN_EV_TOKEN_PATH: 'f'.repeat(40) };

        ctx.expect(gateReason('darwin', token, true, 'self-hosted')).toBe(NOT_WINDOWS);
        ctx.expect(gateReason('linux', token, true, 'self-hosted')).toBe(NOT_WINDOWS);

        // On Windows the box still has to have the tool and the cert.
        ctx.expect(gateReason('win32', token, false, 'self-hosted')).toBe(NO_SIGNTOOL);
        ctx.expect(gateReason('win32', {}, true, 'self-hosted')).toMatch(/WIN_EV_TOKEN_PATH/);
        ctx.expect(gateReason('win32', { WIN_EV_TOKEN_PATH: 'C:\\certs\\ev.pfx' }, true, 'self-hosted')).toMatch(/WIN_CSC_KEY_PASSWORD/);

        // A cloud project signs on hosted windows-latest, so even a fully
        // equipped box skips rather than proving a path CI never takes here —
        // and a cloud box with no token at all says the same thing, since the
        // strategy is decided before the token it was never meant to hold.
        ctx.expect(gateReason('win32', token, true, 'cloud')).toBe(CLOUD);
        ctx.expect(gateReason('win32', token, true, 'cloud')).toMatch(/cloud/);
        ctx.expect(gateReason('win32', {}, true, 'cloud')).toBe(CLOUD);

        // Windows + signtool + a configured token, signing on this box, is the
        // one combination that runs — self-hosted and local both sign here.
        ctx.expect(gateReason('win32', token, true, 'self-hosted')).toBeNull();
        ctx.expect(gateReason('win32', token, true, 'local')).toBeNull();

        // And before any of that: these five drive the REAL token, so the bare
        // lane never reaches them. currentGate reads the opt-in at call time,
        // which is what lets this case take it away and see the reason change.
        const origExtended = process.env.TEST_EXTENDED_MODE;
        try {
          delete process.env.TEST_EXTENDED_MODE;
          ctx.expect(currentGate()).toBe(NOT_EXTENDED);
        } finally {
          if (origExtended === undefined) delete process.env.TEST_EXTENDED_MODE;
          else process.env.TEST_EXTENDED_MODE = origExtended;
        }

        // And every OTHER case in this file asks the gate before it does
        // anything: on the box these drive the real token, so an ungated one
        // would sign (or fail a PIN) whenever the lane runs.
        const source = require('fs').readFileSync(__filename, 'utf8');
        // Needles assembled so this case's own text is not one of their hits.
        const cases  = source.split(`\n      ${'name'}: `).slice(1);
        ctx.expect(cases.length).toBe(6);
        for (const body of cases.slice(1)) {
          if (!body.includes(`if (reason) ctx.${'skip'}(reason)`)) {
            throw new Error(`an e2e case does not gate before it signs: ${body.slice(0, 120)}`);
          }
        }
      },
    },
    {
      name: 'signs an unsigned exe through the real signtool path',
      timeout: 120000,
      run: async (ctx) => {
        const reason = currentGate();
        if (reason) ctx.skip(reason);

        const signer = signerFor(ctx);
        const inDir  = path.join(ctx.state.scratch, 'in');
        const outDir = path.join(ctx.state.scratch, 'out');
        jetpack.dir(inDir);

        // The same sample binary `--smoke` signs, from the signer's own helper.
        const target = signer.copySampleExe(path.join(inDir, 'omega-sign-e2e.exe'));
        const before = fs.readFileSync(target);

        await signer.signWithSigntool([target], inDir, outDir);

        const signedPath = path.join(outDir, 'omega-sign-e2e.exe');
        ctx.expect(fs.existsSync(signedPath)).toBe(true);

        // A signature is appended to the PE, so the output is bigger than the
        // input and never byte-identical to it — the input is left untouched.
        const after = fs.readFileSync(signedPath);
        ctx.expect(after.length).toBeGreaterThan(before.length);
        ctx.expect(after.equals(before)).toBe(false);
        ctx.expect(fs.readFileSync(target).equals(before)).toBe(true);

        ctx.state.unsignedPath = target;
        ctx.state.signedPath   = signedPath;
      },
    },
    {
      name: 'signtool verify reports the signed copy as signed',
      timeout: 60000,
      run: async (ctx) => {
        const reason = currentGate();
        if (reason) ctx.skip(reason);

        const result = await ctx.state.signer.verifyOnly([ctx.state.signedPath]);

        ctx.expect(result.signed).toBe(1);
        ctx.expect(result.unsigned).toBe(0);
        ctx.expect(result.total).toBe(1);
      },
    },
    {
      name: 'signtool verify rejects the unsigned original',
      timeout: 60000,
      run: async (ctx) => {
        const reason = currentGate();
        if (reason) ctx.skip(reason);

        // The other half of the proof: verify has to say no to the copy that was
        // never signed, or a green verify means nothing.
        const result = await ctx.state.signer.verifyOnly([ctx.state.unsignedPath]);

        ctx.expect(result.signed).toBe(0);
        ctx.expect(result.unsigned).toBe(1);
      },
    },
    {
      name: 'the sign-events log carries the attempt trail for that file',
      run: (ctx) => {
        const reason = currentGate();
        if (reason) ctx.skip(reason);

        const events = readEvents(ctx.state.logPath).filter((e) => e.file === 'omega-sign-e2e.exe');
        const names  = events.map((e) => e.event);

        ctx.expect(names).toContain('sign-start');
        ctx.expect(names).toContain('sign-attempt');
        ctx.expect(names).toContain('sign-done');
        ctx.expect(names).not.toContain('sign-fail');

        const attempts = events.filter((e) => e.event === 'sign-attempt');
        ctx.expect(attempts[0].attempt).toBe(1);
        ctx.expect(attempts[0].of).toBe(signWindows.SIGN_ATTEMPTS);

        const start = events.find((e) => e.event === 'sign-start');
        ctx.expect(start.mode).toBe(signWindows.resolveSigntoolEnv().useThumbprint ? 'thumbprint' : 'pfx');
        ctx.expect(typeof start.ts).toBe('string');
      },
    },
    {
      name: 'one windows-sign job end to end: --in release --out release/signed',
      timeout: 180000,
      run: async (ctx) => {
        const reason = currentGate();
        if (reason) ctx.skip(reason);

        // What the CI job runs is `npx omega sign-windows --in release --out
        // release/signed` (src/defaults/.github/workflows/build.yml). The runner
        // itself only hosts the job — there is no runner-side entry to call — so
        // this drives the command module the CLI dispatches to, with the flags
        // parsed the way the router hands them over.
        const signer     = signerFor(ctx);
        const releaseDir = path.join(ctx.state.scratch, 'job', 'release');
        const signedDir  = path.join(releaseDir, 'signed');
        jetpack.dir(releaseDir);
        signer.copySampleExe(path.join(releaseDir, 'omega-runner-job.exe'));

        await signer({ _: ['sign-windows'], in: releaseDir, out: signedDir });

        const signedPath = path.join(signedDir, 'omega-runner-job.exe');
        ctx.expect(fs.existsSync(signedPath)).toBe(true);

        const result = await signer.verifyOnly([signedPath]);
        ctx.expect(result.signed).toBe(1);

        // The job's own bookends, which is what `runner monitor` renders per job.
        const events    = readEvents(ctx.state.logPath);
        const jobEvents = events.filter((e) => e.event === 'job-end');
        ctx.expect(events.map((e) => e.event)).toContain('job-end');
        ctx.expect(jobEvents[jobEvents.length - 1].ok).toBe(true);
      },
    },
  ],
});
