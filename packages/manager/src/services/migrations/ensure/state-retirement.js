/**
 * State-retirement migration ([#434](https://github.com/Omega-JS-Stack/omega/issues/434))
 * — the on-disk half of killing the third bucket. `.omega/state.json` held a
 * durable cache of derived data; that CONTENT is gone. Every fact it carried
 * now lives where it belongs:
 *
 *   - a provisioned id or a confirmation nothing can re-check → config/omega.json5
 *   - a secret (the GA Measurement Protocol secrets, the VAPID private key) → the brand .env
 *   - everything else → nowhere: the idempotent ensure re-derives it from the
 *     platform on the next run, which is what it always did with the cache
 *     sitting unused beside it
 *
 * The FILE lives on as the per-machine record home, sectioned per fact kind
 * ([#479](https://github.com/Omega-JS-Stack/omega/issues/479)): `deploy` is
 * the record `@omega.js/devkit/deploy-record` writes on every successful
 * deploy verb, and future record kinds join it as siblings. So this migration
 * owns ONLY the service-keyed sections it retires — every other top-level key
 * is a record it neither reads nor deletes, and a state.json left holding
 * nothing but records is rewritten, not deleted.
 *
 * Unlike its Firestore siblings this migration touches only the brand's own
 * files, so it runs without a service account.
 *
 * Like every migration, a run is an AUDIT until `--execute`:
 *   npx omega manage --migration=state-retirement            # prints the plan, writes nothing
 *   npx omega manage --migration=state-retirement --execute  # performs it
 *
 * Idempotent by construction: the executed run trims (or deletes) the file,
 * so a re-run finds nothing to move and reports a clean no-op.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const { writeConfigValues, DIR_TARGETS } = require('@omega.js/config');

const { writeEnvValue } = require('../../../lib/env-secret.js');
const { streamSecretEnvName } = require('../../../lib/analytics-secret.js');

const STATE_FILE = join('.omega', 'state.json');

// The service-keyed sections the retired state file carried — the only keys
// this migration reads, moves and removes. Anything else is a machine record
// (devkit's `deploy` today, other record kinds tomorrow) and survives
// untouched: an unknown key is never assumed to be dead cache (see the header)
const RETIRED_SECTIONS = new Set([
  'advertising', 'analytics', 'campaigns', 'captcha', 'certificates', 'chat',
  'cloud', 'edge', 'email', 'forms', 'monitoring', 'newsletter', 'payment',
  'repo', 'search',
]);

/**
 * Every dot-path in an object that holds a non-object value. Arrays count as
 * leaves: the one array state ever held (the confirmed reCAPTCHA domains)
 * moves whole.
 *
 * @param {Object} node - Object to walk
 * @param {string} [prefix] - Path prefix for recursion
 * @returns {string[]} Dot-paths of every leaf
 */
function leafPaths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? leafPaths(value, path)
      : [path];
  });
}

/**
 * Plan every move out of a parsed state.json. Nothing is written here.
 *
 * @param {Object} state - The parsed .omega/state.json
 * @param {Object} [brandConfig] - The merged brand config, consulted for the
 *   product catalog: a `[id=…]` edit path can only address a product the
 *   catalog already carries, and an id for a product that is gone has no home
 * @returns {Array<{ from: string, config?: string, env?: string, value: * }>}
 *   One record per fact that has a new home
 */
function planMoves(state, brandConfig = {}) {
  const moves = [];
  const toConfig = (from, path, value) => {
    // An empty string is what a missing optional wrote into state (the SDK
    // config's measurementId); landing it in config would erase a real value
    if (value !== undefined && value !== null && value !== '') {
      moves.push({ from, config: path, value });
    }
  };
  const toEnv = (from, name, value) => {
    if (value) {
      moves.push({ from, env: name, value });
    }
  };
  const confirmed = (from, path, value) => {
    // Only a TRUE confirmation is a fact — false is "not confirmed yet",
    // which is the absence of the key
    if (value === true) {
      moves.push({ from, config: path, value: true });
    }
  };

  // ── edge: the zone id `omega purge` targets from a build ──────────────────
  toConfig('edge.zoneId', 'edge.providers.cloudflare.zone', state.edge?.zoneId);

  // ── search: the GA association confirm (no API on either side) ────────────
  confirmed('search.gaLinked', 'search.providers.searchConsole.gaLinked', state.search?.gaLinked);

  // ── analytics: the measurement id is public config, the Measurement
  //    Protocol secret is a secret — the stream id and URI re-derive ─────────
  for (const [key, stream] of Object.entries(state.analytics?.streams || {})) {
    // A legacy state file keys the stream by its target DIR (`website`), which
    // composed straight through would write `targets.website` — a target the
    // validator rejects. DIR_TARGETS is the one dir→target normalizer (#505);
    // a key that is already a target name passes through it untouched
    const target = DIR_TARGETS[key] || key;
    toConfig(
      `analytics.streams.${key}.measurementId`,
      `targets.${target}.analytics.providers.google.id`,
      stream?.measurementId,
    );
    toEnv(
      `analytics.streams.${key}.apiSecret`,
      streamSecretEnvName(target),
      stream?.apiSecret,
    );
  }

  // ── payment: the two Dashboard-only confirms + the provider product ids ───
  confirmed('payment.radarConfirmed', 'payment.providers.stripe.radarConfirmed', state.payment?.radarConfirmed);
  confirmed('payment.disputesConfirmed', 'payment.providers.stripe.disputesConfirmed', state.payment?.disputesConfirmed);

  const catalog = new Set((brandConfig.payment?.products || []).map((product) => product.id));
  for (const [provider, key] of [['stripe', 'stripeProducts'], ['paypal', 'paypalProducts']]) {
    for (const [productId, id] of Object.entries(state.payment?.[key] || {})) {
      if (catalog.has(productId)) {
        toConfig(`payment.${key}.${productId}`, `payment.products[id=${productId}].${provider}.productId`, id);
      }
    }
  }

  // ── cloud: the SDK config, the OAuth-redirect confirm, the VAPID pair ─────
  for (const [key, value] of Object.entries(state.cloud?.sdkConfig || {})) {
    toConfig(`cloud.sdkConfig.${key}`, `cloud.config.${key}`, value);
  }
  confirmed(
    'cloud.authentication.oauthRedirectsConfigured',
    'cloud.oauthRedirectsConfigured',
    state.cloud?.authentication?.oauthRedirectsConfigured,
  );
  toConfig('cloud.cloudMessaging.vapidPublicKey', 'cloud.messaging.vapidKey', state.cloud?.cloudMessaging?.vapidPublicKey);
  toEnv('cloud.cloudMessaging.vapidPrivateKey', 'VAPID_PRIVATE_KEY', state.cloud?.cloudMessaging?.vapidPrivateKey);

  // ── marketing + monitoring: ids their services already write back ─────────
  toConfig('campaigns.listId', 'marketing.campaigns.providers.sendgrid.listId', state.campaigns?.listId);
  toConfig('newsletter.publicationId', 'marketing.newsletter.providers.beehiiv.publicationId', state.newsletter?.publicationId);
  toConfig('monitoring.org', 'monitoring.providers.sentry.org', state.monitoring?.org);

  // ── captcha: the domain-list confirm (classic reCAPTCHA has no read API) ──
  if (Array.isArray(state.captcha?.domainsConfirmed)) {
    moves.push({
      from: 'captcha.domainsConfirmed',
      config: 'captcha.providers.recaptcha.domainsConfirmed',
      value: state.captcha.domainsConfirmed,
    });
  }

  return moves;
}

/**
 * State-retirement migration handler.
 *
 * @param {Object} context - Handler context ({ brandRoot, options })
 * @returns {Object} { output } — the plan, or what was performed
 */
module.exports = async function ensureStateRetirement(context) {
  const { brandRoot, brandConfig = {}, options = {} } = context;
  const execute = options.execute === true;
  const statePath = join(brandRoot, STATE_FILE);

  const state = jetpack.read(statePath, 'json');
  if (!state) {
    console.log(`      ${chalk.green('✓')} No ${chalk.cyan(STATE_FILE)} — already retired`);
    return { output: { stateRetirement: { retired: true } } };
  }

  const moves = planMoves(state, brandConfig);
  const movedFrom = new Set(moves.map((move) => move.from));
  const dropped = leafPaths(state)
    .filter((path) => RETIRED_SECTIONS.has(path.split('.')[0]))
    .filter((path) => !movedFrom.has(path));

  // The machine records this migration never touches — what the file keeps
  const kept = Object.fromEntries(Object.entries(state).filter(([key]) => !RETIRED_SECTIONS.has(key)));

  // Nothing but records left: an already-retired brand. Say so instead of
  // rewriting the file every run.
  if (moves.length === 0 && dropped.length === 0) {
    console.log(`      ${chalk.green('✓')} ${chalk.cyan(STATE_FILE)} holds only machine records — already retired`);
    return { output: { stateRetirement: { retired: true, kept: Object.keys(kept) } } };
  }

  // ── The plan, printed the same way in both modes ──────────────────────────
  for (const move of moves) {
    const home = move.config ? `omega.json5 ${chalk.cyan(move.config)}` : `.env ${chalk.cyan(move.env)}`;
    console.log(`      ${chalk.dim('→')} ${chalk.dim(move.from)} ${chalk.dim('→')} ${home}`);
  }
  if (dropped.length > 0) {
    console.log(`      ${chalk.dim(`⊘ ${dropped.length} re-derived on the next run: ${dropped.join(', ')}`)}`);
  }

  const configEdits = Object.fromEntries(
    moves.filter((move) => move.config).map((move) => [move.config, move.value]),
  );
  const envEdits = moves.filter((move) => move.env);

  // writeConfigValues skips values already equal, so `applied` is the honest
  // list of what this migration actually changes — in both modes
  const report = Object.keys(configEdits).length > 0
    ? writeConfigValues(brandRoot, configEdits, { dryRun: !execute })
    : { applied: [] };

  if (!execute) {
    console.log(`      ${chalk.yellow('[AUDIT]')} Would write ${chalk.cyan(report.applied.length)} config value(s) + ${chalk.cyan(envEdits.length)} .env value(s), then retire ${chalk.cyan(STATE_FILE)} ${chalk.dim('(--execute to perform it)')}`);
    return {
      output: {
        stateRetirement: {
          audit: true,
          config: report.applied,
          env: envEdits.map((move) => move.env),
          dropped,
        },
      },
    };
  }

  for (const move of envEdits) {
    writeEnvValue(brandRoot, move.env, move.value);
    process.env[move.env] = move.value;
  }

  // The machine records outlive the retirement — trim rather than delete when
  // the brand has any
  if (Object.keys(kept).length > 0) {
    jetpack.write(statePath, kept, { jsonIndent: 2 });
    console.log(`      ${chalk.green('✓')} ${chalk.cyan(STATE_FILE)} trimmed to its machine records: ${chalk.cyan(Object.keys(kept).join(', '))} ${chalk.dim('(the deploy record is owned by @omega.js/devkit/deploy-record)')}`);
  } else {
    jetpack.remove(statePath);
    console.log(`      ${chalk.green('✓')} ${chalk.cyan(STATE_FILE)} deleted`);
  }

  console.log(`      ${chalk.green('✓')} Retired: ${chalk.cyan(report.applied.length)} config value(s), ${chalk.cyan(envEdits.length)} .env value(s), ${chalk.cyan(dropped.length)} re-derived`);

  return {
    output: {
      stateRetirement: {
        config: report.applied,
        env: envEdits.map((move) => move.env),
        dropped,
        kept: Object.keys(kept),
      },
    },
  };
};

module.exports.planMoves = planMoves;
module.exports.leafPaths = leafPaths;
