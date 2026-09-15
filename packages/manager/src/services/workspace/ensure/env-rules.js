/**
 * Say, at MANAGE time, which env keys the brand's OWN config made mandatory
 * and nobody has filled in — the env schema's `requiredWhen` rules
 * ([#626](https://github.com/Omega-JS-Stack/omega/issues/626)).
 *
 * Every one of those rules used to be discovered LATE and per target: the
 * extension's build threw on a GA4 stream with no Measurement Protocol secret,
 * the backend 403'd every protected POST when a reCAPTCHA site key had no
 * secret half, the captcha service paired the halves with its own if. The
 * schema declares each rule once, checkEnvRules (@omega.js/config) evaluates
 * it, and this op is the earliest place a human hears about it.
 *
 * Evaluated PER ENABLED TARGET, against that target's RESOLVED config
 * ([#627](https://github.com/Omega-JS-Stack/omega/issues/627) review): the
 * values these rules read live where the services write them, and that is the
 * target section — the analytics service provisions one GA4 stream per surface
 * (targets.<t>.analytics.providers.google.id) and leaves the shared slot null.
 * A brand-ROOT evaluation therefore saw NOTHING for the canonical brand shape,
 * and over-fired for the shared-id one (every per-target secret at once,
 * including targets the brand does not even enable). The resolution is
 * @omega.js/config's own (loadConfig with a target overlays targets.<name>);
 * entries no enabled target claims are never evaluated.
 *
 * The few entries no target reads at all (SENTRY_AUTH_TOKEN — the monitoring
 * SERVICE's) are judged against the brand config AND every enabled target's
 * resolved one ([#683](https://github.com/Omega-JS-Stack/omega/issues/683)):
 * the same disease one level over. A target-less key belongs to a SERVICE, but
 * the config path that requires it is written wherever that service writes its
 * values — the monitoring service provisions one Sentry project per surface
 * and lands the DSN in targets.<t>.monitoring.providers.sentry.dsn with the
 * shared slot null. Truthy in ANY enabled target (or at the root) owes the key
 * once; the per-key dedupe below is what makes the union one violation.
 *
 * It WARNS and never fails. A half-configured brand is a normal step on the way
 * to a configured one (the key is a dashboard visit away), and a manage run
 * that refuses to reconcile over it would be a hostage note. The lanes that
 * CANNOT proceed — a production backend boot — refuse on their own.
 *
 * Presence is judged on the RESOLVED cascade (`process.env`, which manage
 * layered shell > brand .env > company .env before any service ran), so a
 * company-supplied value counts. Violations name the BRAND-LEVEL key
 * (GOOGLE_ANALYTICS_SECRET_WEB, not the GOOGLE_ANALYTICS_SECRET it is
 * delivered to a target as): that is the name a human puts in the .env.
 *
 * A key nobody ever pastes is judged on its DERIVATION instead (#910): a
 * desktop target's signing paths come from the brand's signing tree, so
 * `envFor` below asks for them exactly as the repo service's secrets op does.
 */
const path = require('node:path');
const chalk = require('chalk').default;

const { ENV_SCHEMA, loadConfig, targetEntries, targetPath, TARGETS } = require('@omega.js/config');
const { checkEnvRules } = require('@omega.js/config/env-rules');
const { deriveSigningEnv } = require('@omega.js/devkit/signing-env');
const { DEFAULTS } = require('../../../config.js');

// The entries no target reads (`targets: []`) — a service's own key, which no
// target-resolved view could ever raise. The checker's `schema` seam scopes a
// pass to them without this op ever reading a rule itself.
const TARGETLESS_SCHEMA = ENV_SCHEMA.filter((entry) => entry.targets && entry.targets.length === 0);

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
  const collect = (found) => {
    for (const violation of found) {
      if (violation.rule !== 'requiredWhen' || seen.has(violation.key)) continue;
      seen.add(violation.key);
      violations.push(violation);
    }
  };

  collect(checkEnvRules(brandConfig, process.env, { schema: TARGETLESS_SCHEMA }));

  for (const entry of enabled) {
    // The per-target view is @omega.js/config's resolution, not a merge of our
    // own: same chain as every framework's own load (company ← brand shared ←
    // brand targets.<name>), so this op and the target's build read one config.
    // It resolves FROM the target's dir, because the dir is what names the
    // entry to overlay, and the schema's rules are scoped by TYPE.
    const targetDir = path.join(brandRoot, targetPath(brandConfig, entry.name));
    const { config } = loadConfig(targetDir, entry.type, { defaults: DEFAULTS });
    const env = envFor(entry.type, targetDir);
    collect(checkEnvRules(config, env, { target: entry.type }));
    // …and the service's own keys against that same view (#683): a target-less
    // entry names no target, so nothing here scopes it — this asks whether the
    // path that requires it is truthy on THIS surface.
    collect(checkEnvRules(config, env, { schema: TARGETLESS_SCHEMA }));
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
