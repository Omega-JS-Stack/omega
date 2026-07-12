/**
 * Ensure the GitHub org profile matches the brand — display name, support
 * email, billing email, description (160-char org limit), blog URL, and
 * location (only when github.location is configured; omega-manager hardcoded
 * a country — company/brand config owns that choice now).
 *
 * Skipped entirely for shared orgs (filtered in the service setup).
 */
const chalk = require('chalk').default;
const { dryRunPlan } = require('../../../lib/run-gates.js');

module.exports = async function ensureOrg(context) {
  const { brandConfig, options = {}, githubApi: api } = context;

  const github = brandConfig.github;
  const org = api.getOrg(github.org);

  if (!org) {
    console.log(`      ${chalk.dim(`⊘ ${github.org} is not an organization — org-level settings don't apply`)}`);
    return { status: 'success', output: { org: { skipped: 'owner is not an organization' } } };
  }

  const name = brandConfig.brand?.name;
  const domain = (brandConfig.brand?.url || '').replace(/^https?:\/\//, '');
  // GitHub org description has a 160 character limit
  const fullDescription = brandConfig.brand?.description || '';
  const description = fullDescription.length > 160
    ? fullDescription.slice(0, 157) + '...'
    : fullDescription;

  const supportEmail = `support@${domain}`;
  const desired = {
    name: name || org.name,
    email: supportEmail,
    billing_email: supportEmail,
    description: description || org.description || '',
    blog: `https://${domain}`,
  };

  if (github.location) {
    desired.location = github.location;
  }

  // Diff current vs desired — only drifted fields get patched
  const updates = {};
  for (const [key, value] of Object.entries(desired)) {
    if (org[key] !== value) {
      updates[key] = value;
      console.log(`      ${key}: "${org[key] || '(none)'}" ${chalk.dim('→')} "${chalk.cyan(value)}"`);
    }
  }

  if (Object.keys(updates).length === 0) {
    console.log(`      ${chalk.green('✓')} Org settings already configured`);
    return { status: 'success' };
  }

  if (options.dryRun) {
    return dryRunPlan('update org settings', { status: 'success', output: { org: { planned: Object.keys(updates) } } });
  }

  try {
    api.updateOrg(github.org, updates);
    console.log(`      ${chalk.green('✓')} Org settings updated`);
    return { status: 'success', output: { org: { updated: Object.keys(updates) } } };
  } catch (error) {
    console.log(`      ${chalk.red('✗')} Failed to update org${chalk.dim(`: ${error.message}`)}`);
    return { status: 'error', error: error.message };
  }
};
