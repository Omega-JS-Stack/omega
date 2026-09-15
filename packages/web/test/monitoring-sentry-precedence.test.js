/**
 * #485 part (2), after #894: the page bakes BOTH sentry homes faithfully, and
 * @omega.js/client resolves which one wins.
 *
 * `monitoring.providers.sentry` is the ONE error-reporting config seam
 * (monitoring.md), and the web codemod converts a legacy `web_manager.sentry`
 * into it. foot.html used to compose the client's `sentry` contract itself, and
 * the ORDER of its two lines decided precedence: it emitted the
 * monitoring-derived one BEFORE the `resolved.client` loop, so a brand carrying
 * both (every already-converted brand until the one-time migration reaches it)
 * had its stale `client.sentry` silently overwrite the real DSN.
 *
 * The page composes nothing now: it bakes the browser subset of the resolved
 * config ([#894](https://github.com/Omega-JS-Stack/omega/issues/894)) and the
 * mapping lives in @omega.js/client, once, for all three surfaces. What this
 * suite owns is that BOTH homes reach the browser; which of them wins is pinned
 * in packages/client's own suite (test/config.test.js, the #894 cases).
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { buildWith, readBuildJson, miniData } = require('./lib/build.js');

const MONITORING_DSN = 'https://key@o1.ingest.sentry.io/9';
const LEGACY_DSN = 'https://legacy@o1.ingest.sentry.io/8';

const monitoring = { providers: { sentry: { dsn: MONITORING_DSN, org: 'mon-org' } } };
const legacyClient = { sentry: { enabled: true, config: { dsn: LEGACY_DSN } } };

/** The client config a built page hands the client runtime. */
async function configurationOf(siteData, name) {
  const pages = await buildWith(siteData, {}, name);
  const buildJson = readBuildJson(pages);
  assert.ok(buildJson, 'the build wrote the OMEGA_BUILD_JSON snapshot');

  return buildJson.config;
}

test('#485: the canonical monitoring block reaches the browser whole, beside a stale client.sentry', async () => {
  const config = await configurationOf(
    { ...miniData, monitoring, client: legacyClient },
    'sentry-precedence-both',
  );

  assert.strictEqual(config.monitoring.providers.sentry.dsn, MONITORING_DSN, 'the canonical home rides');
  assert.strictEqual(config.monitoring.providers.sentry.org, 'mon-org', 'the whole provider block rides');
  // Both homes are baked as they are authored: the client picks the canonical
  // one (its own suite pins that), so nothing here decides it by render order.
  assert.strictEqual(config.client.sentry.config.dsn, LEGACY_DSN, 'the legacy blob rides as authored');
});

test('#485: a brand still parked at client.sentry bakes that blob', async () => {
  const config = await configurationOf(
    { ...miniData, client: legacyClient },
    'sentry-precedence-legacy',
  );

  assert.strictEqual(config.client.sentry.config.dsn, LEGACY_DSN, 'no monitoring DSN, so the legacy blob is the only one');
  assert.strictEqual(config.monitoring?.providers?.sentry?.dsn, undefined, 'and nothing invents a canonical one');
});

test('#485: no sentry config anywhere bakes no sentry config anywhere', async () => {
  const config = await configurationOf({ ...miniData }, 'sentry-precedence-none');

  assert.strictEqual(config.monitoring?.providers?.sentry?.dsn, undefined, 'nothing configured, nothing baked');
  assert.strictEqual(config.client?.sentry, undefined, 'and no provider block invented');
});
