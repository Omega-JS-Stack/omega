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
const { parseTestScope, FRAMEWORK_IDS } = require('@omega.js/devkit/test/scope');
const { consumerPaths } = require('../consumer.js');

const logger = new Logger('omega:test');

module.exports = async function (options) {
  const paths = consumerPaths();

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
    const frameworkTests = scope.filters.framework.length
      ? scope.filters.framework.map((f) => `test/${f.replace(/\.js$/, '')}*.test.js`).join(' ')
      : 'test/*.test.js';
    logger.log(`Running @omega.js/web framework tests (node --test ${frameworkTests})`);
    execSync(`node --test ${frameworkTests}`, { stdio: 'inherit', cwd: frameworkRoot });
  }

  if (!scope.sources.includes('project')) {
    return;
  }

  // ---- Production build
  const result = await require('./build.js')(options);

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
    const projectTests = scope.filters.project.length
      ? scope.filters.project.map((f) => `test/${f.replace(/\.js$/, '')}*`).join(' ')
      : 'test/';
    logger.log(`Running consumer tests (node --test ${projectTests})`);
    execSync(`node --test ${projectTests}`, { stdio: 'inherit' });
  }
};
