/**
 * `omega test` — C5-scoped test entry:
 *   bare / `project:` / `brand:`      → production build + smoke verification,
 *                                       then the consumer's own suite (node --test test/)
 *   `framework:` / `omega:` / `web:`  → @omega.js/web's own suite
 *   `full:`                           → both
 *
 * Smoke checks: pages rendered, 404.html (the guaranteed default page —
 * consumers own their home page) carries the theme root, the manifest's main
 * bundle exists on disk, every internal link the built pages emit resolves to
 * something the same build wrote (#430), and the four built-output audit checks
 * pass — page meta, anchor fragments, image alt, sitemap orphans (#468). The
 * deeper 3-layer test framework (build/page/boot vs a real browser) is a later
 * devkit adoption step.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const Logger = require('@omega.js/devkit/logger');
const attachLogFile = require('@omega.js/devkit/attach-log-file');
const { parseTestScope, isPathTargeted, noMatchMessage, noMatchExitCode, FRAMEWORK_IDS } = require('@omega.js/devkit/test/scope');
const { ensureTarget } = require('./lib/ensure-target.js');
const { consumerPaths } = require('../consumer.js');
const { checkDistLinks, loadExceptions, loadLinkExceptions, EXCEPTIONS_FILE } = require('../link-resolver.js');
const { auditDist } = require('../dist-audit.js');

const logger = new Logger('test');

module.exports = async function (options) {
  const paths = consumerPaths();

  // Tee the whole run to <targetRoot>/logs/test.log (#197) — the file to grep
  // after a failure instead of scrolling scrollback.
  attachLogFile(path.join(paths.root, 'logs', 'test.log'));

  // The local half of the retired `omega setup` (#675) — idempotent, offline,
  // and quiet on a converged target.
  ensureTarget({ projectDir: paths.root, log: (line) => logger.log(line), warn: (line) => logger.warn(line) });

  // ---- C5 scope (bare = project only; the framework suite is explicit)
  const targets = (options._ || []).slice(1);
  const scope = parseTestScope(targets, {
    frameworkAliases: FRAMEWORK_IDS['@omega.js/web'],
  });
  for (const bad of scope.invalid) {
    logger.warn(`Unknown test scope prefix ignored: ${bad}`);
  }

  // A target that names a path and selects nothing is a typo, or a suite
  // renamed out from under it: `node --test` treats a glob that matches
  // nothing as a no-op and exits 0, so the run was silently green
  // ([#814](https://github.com/Omega-JS-Stack/omega/issues/814)). Ahead of the
  // production build below, so a typo costs a second, not a whole build.
  if (isPathTargeted(scope) && selectedTestFiles(scope, {
    frameworkRoot: path.resolve(__dirname, '../..'),
    projectRoot: paths.root,
  }).length === 0) {
    logger.error(noMatchMessage(targets.join(' ')));
    // Standalone that is 1. Inside a brand-root fan-out the manager forwarded
    // ONE target to every target, so a distinct code lets it count this as a
    // miss rather than a failure (#814).
    process.exitCode = noMatchExitCode();
    return;
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

  failures.push(...linkCheckFailures({ distDir: paths.out, targetRoot: paths.root }));
  failures.push(...auditCheckFailures({ distDir: paths.out, targetRoot: paths.root }));

  if (failures.length) {
    throw new Error(`Smoke checks failed:\n  - ${failures.join('\n  - ')}`);
  }
  logger.log(`Smoke checks passed (${result.htmlCount} pages, every internal link resolves, every page audits clean)`);

  // ---- Consumer test suite
  const testDir = path.join(paths.root, 'test');
  if (fs.existsSync(testDir)) {
    const projectTests = projectTestArgs(scope.filters.project);
    logger.log(`Running consumer tests (node --test ${projectTests})`);
    execSync(`node --test ${projectTests}`, { stdio: 'inherit' });
  }
};

/**
 * The built-output link check as smoke-check lines ([#430](https://github.com/Omega-JS-Stack/omega/issues/430)).
 *
 * Both halves are failures: a link that resolves to nothing, and a declared
 * exception that has started resolving (an exception standing over a fixed link
 * masks the next regression at that URL, so the declared list has to shrink).
 *
 * @param {object} options
 * @param {string} options.distDir - the build output
 * @param {string} options.targetRoot - the consumer root (holds the exception list)
 * @returns {string[]} one line per failure (empty = the check passed)
 */
function linkCheckFailures(options) {
  const { offenders, stale } = checkDistLinks({
    distDir: options.distDir,
    exceptions: loadLinkExceptions(options.targetRoot),
  });

  return [
    ...offenders.map((entry) => `dead internal link: ${entry} — add the page or fix the link`),
    ...stale.map((entry) => `stale link exception in ${EXCEPTIONS_FILE}: ${entry} resolves now — drop it`),
  ];
}
module.exports.linkCheckFailures = linkCheckFailures;

/**
 * The built-output audit checks as smoke-check lines ([#468](https://github.com/Omega-JS-Stack/omega/issues/468)):
 * page meta, anchor fragments, image `alt` and sitemap orphans, over ONE walk
 * of the same dist the link check reads.
 *
 * Same two halves as the link check: a page that fails a check, and a declared
 * exception that has started passing (an exception left standing masks the next
 * regression at that page, so the declared list has to shrink).
 *
 * @param {object} options
 * @param {string} options.distDir - the build output
 * @param {string} options.targetRoot - the consumer root (holds the exception list)
 * @returns {string[]} one line per failure (empty = the checks passed)
 */
function auditCheckFailures(options) {
  const audit = auditDist({
    distDir: options.distDir,
    exceptions: loadExceptions(options.targetRoot),
  });

  return [
    ...audit.meta.offenders.map((entry) => `missing page meta: ${entry} — set it in the page's meta: frontmatter`),
    ...audit.fragments.offenders.map((entry) => `dead anchor fragment: ${entry} — add the id to the page or fix the link`),
    ...audit.alt.offenders.map((entry) => `image without alt: ${entry} — add alt (alt="" for a decorative image)`),
    ...audit.sitemap.offenders.map((entry) => `page missing from sitemap.xml: ${entry} — a page kept out of the sitemap must also be noindex (meta.index: false, one decision per #564), or declare 'sitemap: true' for it in config/link-exceptions.json5`),
    ...['meta', 'fragments', 'alt', 'sitemap'].flatMap((check) => audit[check].stale
      .map((entry) => `stale ${check} exception in ${EXCEPTIONS_FILE}: ${entry} passes now — drop it`)),
  ];
}
module.exports.auditCheckFailures = auditCheckFailures;

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

/**
 * The test files a scoped run selects, resolved through the SAME globs the
 * runs above hand to `node --test` (both framework phases plus the project
 * lane), so a target that matches nothing can be told from one that matches
 * ([#814](https://github.com/Omega-JS-Stack/omega/issues/814)). A filter that
 * misses one framework phase and hits the other is a hit: the union is what
 * the run gets.
 *
 * @param {object} scope - A parseTestScope() result
 * @param {object} roots
 * @param {string} roots.frameworkRoot - @omega.js/web's own package root
 * @param {string} roots.projectRoot - the consumer target root
 * @returns {string[]} Matched paths, relative to the root each glob ran in
 */
function selectedTestFiles(scope, roots) {
  const patterns = [];

  if (scope.sources.includes('framework')) {
    patterns.push(...frameworkTestRuns(scope.filters.framework)
      .flatMap((run) => run.target.split(' '))
      .map((pattern) => ({ cwd: roots.frameworkRoot, pattern })));
  }

  if (scope.sources.includes('project')) {
    // The project default carries the quotes the shell needs; a glob call does not.
    patterns.push(...projectTestArgs(scope.filters.project).replace(/'/g, '').split(' ')
      .map((pattern) => ({ cwd: roots.projectRoot, pattern })));
  }

  return patterns.flatMap(({ cwd, pattern }) => (fs.existsSync(cwd) ? fs.globSync(pattern, { cwd }) : []));
}
module.exports.selectedTestFiles = selectedTestFiles;

// The default is a QUOTED glob node expands itself: a bare `test/` positional
// is treated as a module on Node >= 22 (our engines floor), and macOS /bin/sh
// would half-expand `**` if the shell saw it (#114).
function projectTestArgs(filters) {
  return filters.length
    ? filters.map((f) => `test/${f.replace(/\.js$/, '')}*`).join(' ')
    : `'test/**/*.test.js'`;
}
module.exports.projectTestArgs = projectTestArgs;
