/**
 * `omega test` — C5-scoped test entry:
 *   bare / `project:` / `brand:`      → production build + smoke verification,
 *                                       then the consumer's own suite (node --test test/)
 *   `framework:` / `omega:` / `web:`  → @omega.js/web's own suite
 *   `full:`                           → both
 *
 * Smoke checks: pages rendered, 404.html (the guaranteed default page —
 * consumers own their home page) carries the theme root, the manifest's main
 * bundle exists on disk. The deeper 3-layer test framework (build/page/boot
 * vs a real browser) is a later devkit adoption step.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const Logger = require('@omega.js/devkit/logger');
const attachLogFile = require('@omega.js/devkit/attach-log-file');
const { parseTestScope, FRAMEWORK_IDS } = require('@omega.js/devkit/test/scope');
const { consumerPaths } = require('../consumer.js');

const logger = new Logger('omega:test');

module.exports = async function (options) {
  const paths = consumerPaths();

  // Tee the whole run to <appRoot>/logs/test.log (#197) — the file to grep
  // after a failure instead of scrolling scrollback.
  attachLogFile(path.join(paths.root, 'logs', 'test.log'));

  // ---- C5 scope (bare = project only; the framework suite is explicit)
  const scope = parseTestScope((options._ || []).slice(1), {
    frameworkAliases: FRAMEWORK_IDS['@omega.js/web'],
  });
  for (const bad of scope.invalid) {
    logger.warn(`Unknown test scope prefix ignored: ${bad}`);
  }

  // ---- Framework suite (framework:/omega:/web:/full:)
  if (scope.sources.includes('framework')) {
    const frameworkRoot = path.resolve(__dirname, '../..');
    for (const { flags, target } of frameworkTestRuns(scope.filters.framework)) {
      logger.log(`Running @omega.js/web framework tests (node --test ${flags}${target})`);
      execSync(`node --test ${flags}${target}`, { stdio: 'inherit', cwd: frameworkRoot });
    }
  }

  if (!scope.sources.includes('project')) {
    return;
  }

  // ---- Production build (logFile: false — this run already owns logs/test.log)
  const result = await require('./build.js')({ ...options, logFile: false });

  // ---- Smoke checks over the output
  const failures = [];

  if (result.htmlCount < 1) {
    failures.push('build produced no HTML pages');
  }

  const smokePage = path.join(paths.out, '404.html');
  if (!fs.existsSync(smokePage)) {
    failures.push('dist/404.html is missing (default pages did not render)');
  } else if (!fs.readFileSync(smokePage, 'utf8').includes('data-theme-id')) {
    failures.push('dist/404.html did not render through the theme root layout');
  }

  const mainBundle = result.manifest.js.main && path.join(paths.out, result.manifest.js.main.slice(1));
  if (!mainBundle || !fs.existsSync(mainBundle)) {
    failures.push('manifest js.main bundle is missing from dist/');
  }

  if (failures.length) {
    throw new Error(`Smoke checks failed:\n  - ${failures.join('\n  - ')}`);
  }
  logger.log(`Smoke checks passed (${result.htmlCount} pages)`);

  // ---- Consumer test suite
  const testDir = path.join(paths.root, 'test');
  if (fs.existsSync(testDir)) {
    const projectTests = projectTestArgs(scope.filters.project);
    logger.log(`Running consumer tests (node --test ${projectTests})`);
    execSync(`node --test ${projectTests}`, { stdio: 'inherit' });
  }
};

/**
 * The framework suite's two phases — the SAME split the package's own
 * `npm test` runs (#344). `test/watch/` holds the rebuild-watching suites and
 * runs alone, one file at a time: nine sibling test processes churning temp
 * trees starve a watcher's FSEvents stream, and a starved watcher reads as a
 * rebuild that never landed. A filter is applied to both phases — a glob that
 * matches nothing is a no-op run, so naming a suite in either dir works.
 * @param {string[]} filters - `web:<filter>` scope filters (empty = the lot)
 * @returns {Array<{flags: string, target: string}>} the runs, in order
 */
function frameworkTestRuns(filters) {
  const target = (dir) => (filters.length
    ? filters.map((f) => `${dir}/${f.replace(/\.js$/, '')}*.test.js`).join(' ')
    : `${dir}/*.test.js`);

  return [
    { flags: '', target: target('test') },
    { flags: '--test-concurrency=1 ', target: target('test/watch') },
  ];
}
module.exports.frameworkTestRuns = frameworkTestRuns;

// The default is a QUOTED glob node expands itself: a bare `test/` positional
// is treated as a module on Node >= 22 (our engines floor), and macOS /bin/sh
// would half-expand `**` if the shell saw it (#114).
function projectTestArgs(filters) {
  return filters.length
    ? filters.map((f) => `test/${f.replace(/\.js$/, '')}*`).join(' ')
    : `'test/**/*.test.js'`;
}
module.exports.projectTestArgs = projectTestArgs;
