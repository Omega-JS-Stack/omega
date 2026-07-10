/**
 * `omega test` — production build + smoke verification, then the consumer's
 * own test suite (node --test over test/) when one exists.
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
const { consumerPaths } = require('../consumer.js');

const logger = new Logger('omega:test');

module.exports = async function (options) {
  const paths = consumerPaths();

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
    logger.log('Running consumer tests (node --test test/)');
    execSync('node --test test/', { stdio: 'inherit' });
  }
};
