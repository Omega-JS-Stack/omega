/**
 * Monitoring service (Sentry provider) — one error-monitoring project per enabled target
 * (web/backend/desktop/extension), with each project's DSN landed in
 * targets.<type>.monitoring.providers.sentry.dsn via the comment-preserving
 * writeback — the exact key every framework's runtime reads through the config
 * merge chain. DSNs are public by design (schema-pinned); only the auth token
 * is a secret.
 *
 * Gates: `monitoring.providers.sentry` present (the monitor is a KEY under
 * `providers` since #425 — no entry means none chosen and this service skips,
 * exactly what a null provider meant) + SENTRY_AUTH_TOKEN in the brand .env —
 * a PERSONAL auth token with org:read, project:read, project:write, team:read,
 * team:write (Sentry's "organization tokens" are CI-scoped and cannot create
 * teams or projects, cp136). The projects operation resolves the org (config
 * wins, else the token's lone visible org) and writes it back to
 * monitoring.providers.sentry.org.
 */
const { chosenProvider } = require('@omega.js/config');

const { REQUIRES } = require('../../config.js');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { ensureEnvSecrets } = require('../../lib/env-secrets.js');
const { SentryAPI } = require('./lib/sentry-api.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const monitoring = context.brandConfig.monitoring;

    if (monitoring === false || monitoring?.enabled === false) {
      return { skip: true, reason: 'monitoring disabled' };
    }
    if (!monitoring) {
      return { skip: true, reason: 'no monitoring config' };
    }

    const provider = chosenProvider(monitoring.providers);
    if (!provider) {
      return { skip: true, reason: 'no monitoring.providers entry' };
    }
    if (provider !== 'sentry') {
      return { skip: true, reason: `monitoring.providers.${provider} is not a known monitor` };
    }

    if (!context.sentryApi) {
      const gate = await ensureEnvSecrets(context, REQUIRES.monitoring.env);
      if (gate) return gate;
    }

    return {
      sentryApi: context.sentryApi || new SentryAPI(),
    };
  },
});
