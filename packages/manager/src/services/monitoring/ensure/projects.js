/**
 * Ensure the org, the brand's team, and one Sentry project per enabled
 * target. Org resolution: monitoring.providers.sentry.org from config wins;
 * otherwise the token's single org is used and written back there
 * (self-heal), and a token seeing SEVERAL orgs is asked which one (#635). The team is the brand id; projects are `{brand.id}-{target}`
 * with the target's Sentry platform. Existing projects (matched by slug)
 * are converged proof — nothing is renamed or deleted here.
 */
const chalk = require('chalk').default;
const { dryRunPlan } = require('../../../lib/run-gates.js');
const { writeBrandConfig } = require('../../../lib/config-write.js');
const { resolveConfigValue } = require('../../../lib/config-flow.js');

// Sentry platform slugs per target type — validated server-side against the
// integration-docs index (Project.is_valid_platform), so only ids that exist
// there work: Electron's is the top-level 'electron', NOT the frontend-UI
// alias 'javascript-electron' (400 Invalid platform — cp136b, live find).
// Unlisted target types are not monitored.
const TARGET_PLATFORMS = {
  web: 'javascript',
  backend: 'node',
  desktop: 'electron',
  extension: 'javascript',
};

module.exports = async function ensureProjects(context) {
  const { sentryApi: api, brandConfig, options = {} } = context;
  const brandId = brandConfig.brand.id;

  // === Resolve the org (config wins; a lone token org self-heals into config) ===
  const orgs = await api.getOrganizations();
  const configured = brandConfig.monitoring.providers.sentry.org;
  let org = configured
    ? orgs.find((candidate) => candidate.slug === configured)
    : (orgs.length === 1 ? orgs[0] : null);

  // Ambiguous: the token sees several orgs and config names none. That is a
  // question, not a warning (#635) — the list IS the answer, so ASK it. Zero
  // orgs offers no choice, and a configured-but-invisible org is a different
  // problem, so both keep their warn below. The service already gated on its
  // token, hence `gate: false`.
  if (!org && !configured && orgs.length > 0) {
    const picked = await resolveConfigValue(context, {
      path: 'monitoring.providers.sentry.org',
      label: 'Sentry organization',
      choices: async () => orgs,
      getName: (candidate) => candidate.slug,
      getValue: (candidate) => candidate.slug,
      disablePath: 'monitoring.enabled',
      gate: false,
    });
    org = picked ? orgs.find((candidate) => candidate.slug === picked) : null;
  }

  if (!org) {
    if (configured) {
      console.log(`      ${chalk.yellow('⚠')} monitoring.providers.sentry.org '${configured}' is not visible to this token ${chalk.dim(`(it sees: ${orgs.map((candidate) => candidate.slug).join(', ') || 'none'})`)}`);
    } else {
      console.log(`      ${chalk.yellow('⚠')} The token sees ${orgs.length} orgs — set monitoring.providers.sentry.org in omega.json5 to pick one`);
    }
    return { status: 'warned', reason: 'no Sentry org resolved — set monitoring.providers.sentry.org', output: { projects: { orgUnresolved: true } } };
  }

  // Multi-region SaaS: all org-scoped calls go to the org's home region
  api.setRegionUrl(org.links?.regionUrl);

  // Self-heal — skipped when the ask above already landed the pick (it patches
  // the in-memory config too, so this reads the CURRENT state, not `configured`)
  if (!brandConfig.monitoring.providers.sentry.org) {
    writeBrandConfig(context, { 'monitoring.providers.sentry.org': org.slug });
  }

  const targets = Object.keys(brandConfig.targets || {}).filter((target) => TARGET_PLATFORMS[target]);
  if (targets.length === 0) {
    console.log(`      ${chalk.dim('⊘ No monitorable targets enabled')}`);
    return { state: { org: org.slug, projectMap: {} } };
  }

  const existing = await api.getProjects(org.slug);

  const projects = {};
  const planned = [];
  let created = 0;
  let synced = 0;
  let teamEnsured = false;

  for (const target of targets) {
    const slug = `${brandId}-${target}`;
    console.log(`      ${chalk.dim('•')} ${chalk.cyan(slug)} ${chalk.dim(`(${TARGET_PLATFORMS[target]})`)}`);

    const match = existing.find((project) => project.slug === slug);
    if (match) {
      console.log(`        ${chalk.green('✓')} Exists`);
      projects[target] = { id: match.id, slug: match.slug };
      synced++;
      continue;
    }

    if (options.dryRun) {
      dryRunPlan(`create project ${slug}`);
      planned.push(slug);
      continue;
    }

    // The brand's team carries its projects — ensured once, on first need
    if (!teamEnsured) {
      const teams = await api.getTeams(org.slug);
      if (!teams.find((team) => team.slug === brandId)) {
        await api.createTeam(org.slug, brandId);
        console.log(`        ${chalk.green('✓')} Created team ${chalk.cyan(brandId)}`);
      }
      teamEnsured = true;
    }

    const project = await api.createProject(org.slug, brandId, {
      name: slug,
      slug,
      platform: TARGET_PLATFORMS[target],
    });
    console.log(`        ${chalk.green('✓')} Created`);
    projects[target] = { id: project.id, slug: project.slug };
    created++;
  }

  const summary = planned.length > 0
    ? { synced, planned }
    : { synced, created };

  // State key is projectMap (certificateMap-style) — the output summary key
  // `projects` would clobber it in the merged serviceData the dsn op reads.
  return {
    state: { org: org.slug, projectMap: projects },
    output: { projects: summary },
  };
};
