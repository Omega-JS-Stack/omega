// Libraries
const path    = require('path');
const fs      = require('fs');
const build = require('../build.js');
const { setEnvironment } = require('@omega.js/config/environment');
const logger  = build.logger('test');
const { run } = require('../test/runner.js');
const attachLogFile = require('../utils/attach-log-file.js');
const { EXTENDED_MODE_WARNING } = require('../test/utils/extended-mode-warning.js');
const { noMatchMessage, noMatchExitCode } = require('@omega.js/devkit/test/scope');
const { ensureTarget } = require('./lib/ensure-target.js');

module.exports = async function (options) {
  // Tee all test output to <projectRoot>/logs/test.log (ANSI-stripped), the
  // same test.log every framework writes.
  attachLogFile(path.join(process.cwd(), 'logs', 'test.log'));

  // The local half of the retired `omega setup` (#675) — idempotent, offline,
  // and quiet on a converged target. The gulp verbs get it from the `defaults`
  // task; test runs no gulp, so it calls it here.
  await ensureTarget({
    projectDir: process.cwd(),
    log: (line) => logger.log(line),
    warn: (line) => logger.warn(line),
  });

  const layer       = options.layer    || 'all';
  // Positional target: `npx omega test <target>` where target supports source
  // prefixes — `project:`, `project:<path>`, `mgr:`, `extension:`, or a bare `<path>`.
  const target      = (options._ && options._[1]) || null;
  // `--filter` flag: substring match on test NAMES/descriptions (orthogonal to target).
  const filter      = options.filter   || null;
  const reporter    = options.reporter || 'pretty';
  // Extended mode — opt into tests that hit REAL external services (Firebase via @omega.js/client,
  // push, any network call) instead of skipping them. Off by default so `npx omega test` stays
  // fast and offline-safe. The canonical signal is the unprefixed `TEST_EXTENDED_MODE` env var
  // — the SAME name on every framework (cross-framework parity); `--extended` is the CLI
  // shorthand. Once set on process.env it propagates to every spawned test environment (the
  // in-process Node runner, and Puppeteer's Chromium which inherits process.env).
  const extended    = options.extended === true
    || options.extended === 'true'
    || process.env.TEST_EXTENDED_MODE === 'true'
    || process.env.TEST_EXTENDED_MODE === '1';

  if (extended) {
    process.env.TEST_EXTENDED_MODE = 'true';
  }

  // Canonical signal: every omega instance and the build module pick this up via isTesting().
  process.env.OMEGA_TEST_MODE = 'true';

  // The one environment input (#817): this lane NAMES testing, so the bundles
  // this run builds bake `testing` and every context reading the baked config
  // answers it. A production build spawned from here still names production
  // for itself (src/build.js lets OMEGA_BUILD_MODE win).
  setEnvironment('testing');

  // When @omega.js/extension runs its own boot-layer tests (the cwd's package.json is
  // the framework's package.json), there's no real consumer extension to target. Point
  // the boot runner at the fixture under dist/test/fixtures/consumer-extension
  // unless the caller has already set OMEGA_TEST_BOOT_PROJECT explicitly.
  if (!process.env.OMEGA_TEST_BOOT_PROJECT) {
    try {
      const cwdPkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
      if (cwdPkg.name === '@omega.js/extension') {
        process.env.OMEGA_TEST_BOOT_PROJECT = path.join(__dirname, '..', 'test', 'fixtures', 'consumer-extension');
      }
    } catch (_) { /* no package.json — leave unset */ }
  }

  if (reporter !== 'json') {
    logger.log(`Running tests (layer=${layer}${target ? ` target="${target}"` : ''}${filter ? ` filter="${filter}"` : ''}${extended ? ' +extended' : ''})`);
    logger.log(`Test mode: ${extended ? 'extended (real external APIs)' : 'normal (external APIs skipped)'}`);
    if (extended) {
      logger.warn(EXTENDED_MODE_WARNING[0]);
      EXTENDED_MODE_WARNING.slice(1).forEach((line) => logger.warn(line));
    }
  }

  const result = await run({ layer, target, filter, reporter });

  if (reporter === 'json') {
    // Final machine-readable summary.
    process.stdout.write(`${JSON.stringify({
      event:   'summary',
      passed:  result.passed,
      failed:  result.failed,
      skipped: result.skipped,
      total:   result.passed + result.failed + result.skipped,
    })}\n`);
  }

  // A target that named files and matched none is a failed run, not an empty
  // one: a typo'd path, or a suite renamed out from under it, used to report
  // "0 passing" and exit 0
  // ([#814](https://github.com/Omega-JS-Stack/omega/issues/814)).
  if (result.noMatch) {
    logger.error(noMatchMessage(result.noMatch));
    // Standalone that is 1. Inside a brand-root fan-out the manager forwarded
    // ONE target to every target, so a distinct code lets it count this as a
    // miss rather than a failure (#814).
    process.exitCode = noMatchExitCode();
    await attachLogFile.detach();
    return;
  }

  if (result.failed > 0) {
    process.exitCode = 1;
    await attachLogFile.detach();
    throw new Error(`${result.failed} test(s) failed`);
  }

  // Close test.log and restore stdout/stderr. Nothing to flush: every write
  // already went to the fd synchronously (#197), so detach() just closes the
  // handle — the Results block is on disk before this line runs.
  await attachLogFile.detach();
};
