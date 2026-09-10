/**
 * `omega translate` — translate the built site (dist/) into every language in
 * `translation.languages`, using the committed per-string cache in
 * translations/ and the configured provider (claude via local Claude Code by
 * default; chatgpt via OPENAI_API_KEY). Run `omega build` first. This command
 * OWNS live-LLM translation: build applies the committed cache only and
 * skips cold pages with a warning (friction #24 decision).
 *
 * Env: OMEGA_TRANSLATE_ONLY=<route|file> limits the run to one page.
 */
const Logger = require('@omega.js/devkit/logger');
const { loadConfig, formatErrors } = require('@omega.js/config');
const { consumerPaths } = require('../consumer.js');
const { translateSite } = require('../translate/index.js');
const jetpack = require('fs-jetpack');

const logger = new Logger('translate');

module.exports = async function (options) {
  const paths = consumerPaths();
  const { config, errors } = loadConfig(paths.root, 'web');

  if (errors && errors.length) {
    throw new Error(`config/omega.json5 is invalid:\n${formatErrors(errors)}`);
  }

  if (!jetpack.exists(paths.out)) {
    logger.error('No built site found (dist/) — run `omega build` first.');
    process.exitCode = 1;
    return;
  }

  const stats = await translateSite({
    root: paths.root,
    outDir: paths.out,
    config,
    logger,
    only: process.env.OMEGA_TRANSLATE_ONLY,
  });

  if (stats.skipped) {
    logger.log('Translation is disabled — set translation.languages in config/omega.json5 to enable it.');
    return;
  }

  logger.log(`Translated ${stats.pages} pages → ${stats.languages.join(', ')} (${stats.newStrings} new strings, ${stats.cachedStrings} cached)`);

  if (stats.usage.input || stats.usage.output) {
    logger.log(`Provider tokens: ${stats.usage.input.toLocaleString()} in / ${stats.usage.output.toLocaleString()} out`);
  }

  if (stats.failures.length) {
    logger.error(`${stats.failures.length} page-language pair(s) failed (skipped whole — no copy shipped):`);
    stats.failures.forEach((failure) => logger.error(`  ${failure}`));
    process.exitCode = 1;
  }
};
