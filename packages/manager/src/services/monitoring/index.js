/**
 * Monitoring service (Sentry provider) — one error-monitoring project per enabled target
 * (web/backend/desktop/extension), with each project's DSN landed in
 * targets.<type>.monitoring.dsn via the comment-preserving writeback — the
 * exact key every framework's runtime reads through the config merge chain.
 * DSNs are public by design (schema-pinned); only the auth token is a
 * secret.
 *
 * Gates: a monitoring section with provider 'sentry' (the only provider
 * today) + SENTRY_AUTH_TOKEN in the brand .env (an ORG auth token — it
 * names its org, which the projects operation resolves and writes back to
 * monitoring.org).
 */
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

    const provider = monitoring.provider || 'sentry';
    if (provider !== 'sentry') {
      return { skip: true, reason: `monitoring.provider = '${provider}'` };
    }

    if (!context.sentryApi) {
      const gate = await ensureEnvSecrets(context, [
        { name: 'SENTRY_AUTH_TOKEN', label: 'Sentry organization auth token', url: 'https://sentry.io/settings/auth-tokens/' },
      ]);
      if (gate) return gate;
    }

    return {
      sentryApi: context.sentryApi || new SentryAPI(),
    };
  },
});
