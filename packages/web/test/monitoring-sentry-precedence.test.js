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
const defineCases = require('@omega.js/devkit/test/define-cases');
const expect = require('@omega.js/devkit/test/expect');

const { buildWith, readBuildJson, miniData } = require('./lib/build.js');

const MONITORING_DSN = 'https://key@o1.ingest.sentry.io/9';
const LEGACY_DSN = 'https://legacy@o1.ingest.sentry.io/8';

const monitoring = { providers: { sentry: { dsn: MONITORING_DSN, org: 'mon-org' } } };
const legacyClient = { sentry: { enabled: true, config: { dsn: LEGACY_DSN } } };

/** The client config a built page hands the client runtime. */
async function configurationOf(siteData, name) {
  const pages = await buildWith(siteData, {}, name);
  const buildJson = readBuildJson(pages);
  expect(buildJson, 'the build wrote the OMEGA_BUILD_JSON snapshot').toBeTruthy();

  return buildJson.config;
}

module.exports = defineCases({
  type: 'group',
  description: 'monitoring-sentry-precedence',
  tests: [
    {
      name: '#485: the canonical monitoring block reaches the browser whole, beside a stale client.sentry',
      run: async (ctx) => {
        const config = await configurationOf(
          { ...miniData, monitoring, client: legacyClient },
          'sentry-precedence-both',
        );

        ctx.expect(config.monitoring.providers.sentry.dsn, 'the canonical home rides').toBe(MONITORING_DSN);
        ctx.expect(config.monitoring.providers.sentry.org, 'the whole provider block rides').toBe('mon-org');
        // Both homes are baked as they are authored: the client picks the canonical
        // one (its own suite pins that), so nothing here decides it by render order.
        ctx.expect(config.client.sentry.config.dsn, 'the legacy blob rides as authored').toBe(LEGACY_DSN);
      },
    },

    {
      name: '#485: a brand still parked at client.sentry bakes that blob',
      run: async (ctx) => {
        const config = await configurationOf(
          { ...miniData, client: legacyClient },
          'sentry-precedence-legacy',
        );

        ctx.expect(config.client.sentry.config.dsn, 'no monitoring DSN, so the legacy blob is the only one').toBe(LEGACY_DSN);
        ctx.expect(config.monitoring?.providers?.sentry?.dsn, 'and nothing invents a canonical one').toBe(undefined);
      },
    },

    {
      name: '#485: no sentry config anywhere bakes no sentry config anywhere',
      run: async (ctx) => {
        const config = await configurationOf({ ...miniData }, 'sentry-precedence-none');

        ctx.expect(config.monitoring?.providers?.sentry?.dsn, 'nothing configured, nothing baked').toBe(undefined);
        ctx.expect(config.client?.sentry, 'and no provider block invented').toBe(undefined);
      },
    },
  ],
});
