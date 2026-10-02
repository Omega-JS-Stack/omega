/**
 * Say, at MANAGE time, which env keys the brand's OWN config made mandatory
 * and nobody has filled in: what a deploy would refuse over, the
 * earliest place a human hears about it. The answer is @omega.js/config's
 * missingEnvKeys for `deploy`, judged PER ENABLED TARGET against that target's
 * RESOLVED config (the services land their values in the target sections),
 * plus the keys no target reads (SENTRY_AUTH_TOKEN) judged against the brand
 * config and every target view. OMEGA's own keys are the env-keys op's, so
 * only what the config adds is named. It WARNS and never fails, judges the
 * resolved cascade in `process.env`, names the BRAND-LEVEL key, and asks the
 * signing derivation first for a desktop target, as the repo service does.
 */
const path = require('node:path');
const chalk = require('chalk').default;

const { ENV_SCHEMA, missingConfigKeys, loadConfig, targetEntries, targetPath, TARGETS } = require('@omega.js/config');
const { deriveSigningEnv } = require('@omega.js/devkit/signing-env');
const { DEFAULTS } = require('../../../config.js');

// The keys no target reads: a service's own, which no target-scoped pass
// could ever raise, so the brand-wide passes are kept to them
const TARGETLESS = new Set(ENV_SCHEMA.filter((entry) => entry.name && entry.targets.length === 0).map((entry) => entry.name));

/**
 * The env a target's rules are judged against
 * ([#910](https://github.com/Omega-JS-Stack/omega/issues/910)). A desktop
 * target's CSC_LINK and APPLE_API_KEY are DERIVED from the brand's signing
 * tree (#891), never pasted, so this op asks the same derivation the repo
 * service's secrets op asks before calling either one missing: without it the
 * two ops disagree on every brand whose company holds the material, one
 * publishing CSC_LINK while the other warns it is absent.
 *
 * It derives over a COPY. A manage walk's `process.env` is the cascade every
 * service below reads, and this op reconciles nothing.
 *
 * @param {string} type - The target's framework type.
 * @param {string} targetDir - The target root, whose brand names the tree.
 * @returns {object} The env map to judge against.
 */
function envFor(type, targetDir) {
  if (type !== 'desktop') {
    return process.env;
  }

  const env = { ...process.env };
  deriveSigningEnv({ env, targetDir });

  return env;
}

module.exports = async (context) => {
  const { brandRoot, brandConfig } = context;

  // Key presence in `targets` IS the enablement signal; a custom target (#603)
  // is a brand's own dir, not a framework the schema delivers keys to. The key
  // is the target's NAME and its `type` names the framework (#886), so both
  // are read from the entry, never from the spelling of the key.
  const enabled = targetEntries(brandConfig).filter((entry) => TARGETS.includes(entry.type));

  const violations = [];
  const seen = new Set();
  const collect = (rows) => {
    for (const { key, path } of rows) {
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({ key, rule: 'requiredWhen', path });
    }
  };
  // What a deploy owes beyond what every brand owes: OMEGA's own keys are the
  // env-keys op's to name
  const configMade = (config, env, target) => missingConfigKeys(config, env, { target, verb: 'deploy' });
  const targetless = (rows) => rows.filter((row) => TARGETLESS.has(row.key));

  collect(targetless(configMade(brandConfig, process.env)));

  for (const entry of enabled) {
    // The per-target view is @omega.js/config's resolution, not a merge of our
    // own: the same chain every framework's own load runs, from the target's dir.
    const targetDir = path.join(brandRoot, targetPath(brandConfig, entry.name));
    const { config } = loadConfig(targetDir, entry.type, { defaults: DEFAULTS });
    const env = envFor(entry.type, targetDir);
    collect(configMade(config, env, entry.type));
    // ...and the service's own keys against that same view: the path that
    // requires one may be set on THIS surface only
    collect(targetless(configMade(config, env)));
  }

  if (violations.length === 0) {
    console.log(`      ${chalk.green('✓')} config-required env keys (all present)`);
    return { output: { envRules: { violations } } };
  }

  for (const { key, path } of violations) {
    console.log(`      ${chalk.yellow('⚠')} ${chalk.cyan(key)} is missing from the .env cascade — ${chalk.cyan(path)} in omega.json5 requires it`);
  }

  return { output: { envRules: { violations } } };
};
