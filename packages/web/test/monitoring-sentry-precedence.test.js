/**
 * #485 part (2) — the canonical home wins the Configuration blob.
 *
 * `monitoring.providers.sentry` is the ONE error-reporting config seam
 * (monitoring.md), and the web codemod now converts a legacy
 * `web_manager.sentry` into it. But `foot.html` emitted the monitoring-derived
 * `sentry` line BEFORE the `resolved.client` loop, so a brand carrying BOTH —
 * every already-converted brand until the one-time migration reaches it — had
 * its stale `client.sentry` silently overwrite the real DSN.
 *
 * The line moved after the loop, and it is only emitted when monitoring has a
 * DSN: a brand still parked at `client.sentry` keeps reporting exactly as it
 * does today (part 3 migrates those), while a brand with the canonical key
 * gets the DSN the manager provisioned.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { buildWith, miniData } = require('./lib/build.js');

const MONITORING_DSN = 'https://key@o1.ingest.sentry.io/9';
const LEGACY_DSN = 'https://legacy@o1.ingest.sentry.io/8';

const monitoring = { providers: { sentry: { dsn: MONITORING_DSN, org: 'mon-org' } } };
const legacyClient = { sentry: { enabled: true, config: { dsn: LEGACY_DSN } } };

/** The Configuration blob a built page hands the client runtime. */
async function configurationOf(siteData, name) {
  const pages = await buildWith(siteData, {}, name);
  const html = [...pages.values()].find((page) => page.includes('var Configuration'));
  assert.ok(html, 'a built page carries the Configuration blob');

  const source = html.match(/var Configuration = (\{[\s\S]*?\});\s*<\/script>/);
  assert.ok(source, 'the Configuration block is present');
  // Evaluated, not string-matched: a Liquid slip that renders unparseable JS
  // fails HERE rather than as a blank page in a browser (#380's idiom).
  return new Function(`return ${source[1]}`)();
}

test('#485: the monitoring DSN outranks a stale client.sentry', async () => {
  const config = await configurationOf(
    { ...miniData, monitoring, client: legacyClient },
    'sentry-precedence-both',
  );

  assert.strictEqual(config.sentry.enabled, true, 'a configured DSN is the enable signal');
  assert.strictEqual(config.sentry.config.dsn, MONITORING_DSN, 'the canonical home wins the blob');
  assert.strictEqual(config.sentry.config.org, 'mon-org', 'the whole provider block rides');
});

test('#485: a brand still parked at client.sentry keeps reporting', async () => {
  const config = await configurationOf(
    { ...miniData, client: legacyClient },
    'sentry-precedence-legacy',
  );

  assert.strictEqual(config.sentry.config.dsn, LEGACY_DSN, 'no monitoring DSN, so the legacy blob still answers');
});

test('#485: no sentry config anywhere leaves reporting off', async () => {
  const config = await configurationOf({ ...miniData }, 'sentry-precedence-none');

  assert.strictEqual(config.sentry.enabled, false, 'nothing configured, nothing reported');
  assert.deepStrictEqual(config.sentry.config, {}, 'and no provider block invented');
});
