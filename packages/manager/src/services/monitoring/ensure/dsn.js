/**
 * Land each target project's DSN in
 * targets.<type>.monitoring.providers.sentry.dsn (#425) — the
 * per-surface override every framework reads through the config merge
 * chain. DSNs are public by design (schema-pinned), so config is their
 * home; the writeback is comment-preserving and a converged rerun leaves
 * the file byte-identical. The resolved value always wins: a hand-set
 * stale DSN is drift and gets patched.
 */
const chalk = require('chalk').default;
const { writeBrandConfig } = require('../../../lib/config-write.js');

module.exports = async function ensureDsn(context) {
  const { sentryApi: api, brandConfig, serviceData } = context;

  const org = serviceData.org;
  const projects = serviceData.projectMap || {};
  const targets = Object.keys(projects);

  if (!org || targets.length === 0) {
    console.log(`      ${chalk.dim('⊘ No projects resolved — nothing to land')}`);
    return {};
  }

  const edits = {};
  const dsns = {};

  for (const target of targets) {
    const { slug } = projects[target];
    const keys = await api.getProjectKeys(org, slug);
    const active = (keys || []).find((key) => key.isActive !== false && key.dsn?.public);

    if (!active) {
      console.log(`      ${chalk.yellow('⚠')} ${chalk.cyan(slug)} has no active client key — create one in Sentry, then rerun`);
      return { status: 'warned', output: { dsn: { missingKey: slug } } };
    }

    const dsn = active.dsn.public;
    dsns[target] = dsn;

    const current = brandConfig.targets?.[target]?.monitoring?.providers?.sentry?.dsn;
    if (current === dsn) {
      console.log(`      ${chalk.green('✓')} ${chalk.cyan(target)} DSN in place`);
      continue;
    }

    edits[`targets.${target}.monitoring.providers.sentry.dsn`] = dsn;
    console.log(`      ${chalk.yellow('↻')} ${chalk.cyan(target)} DSN ${current ? 'drifted — updating' : 'landing'}`);
  }

  writeBrandConfig(context, edits);

  return { output: { dsn: { landed: Object.keys(edits).length, targets: dsns } } };
};
