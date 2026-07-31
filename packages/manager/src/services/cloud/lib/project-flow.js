/**
 * Interactive Firebase project selection/creation (config-landing flow):
 * when cloud.config.projectId is missing in an interactive run, pick from the
 * projects the authed user can see, or create one — project id + display
 * name prompted (brand id/name as defaults), with the 30-project quota
 * shown. The chosen id lands in omega.json5 (comment-preserving writeback).
 *
 * The organization is tri-state (#33): cloud.organizationId set → the
 * project is created inside it (that's what gives the compute service
 * account its default roles); `false` → standalone, no questions; missing →
 * pick from the orgs the authed user can see or opt out — either answer
 * lands in omega.json5, so it's a one-time question. Downloaders without an
 * org onboard cleanly.
 */
const chalk = require('chalk').default;
const { input } = require('@omega.js/devkit/prompt');
const { resolveConfigValue } = require('../../../lib/config-flow.js');

const PROJECT_QUOTA = 30;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/**
 * Resolve (or interactively land) the organization for a NEW project.
 * Chained inside the create flow the user already said Yes to, so there is
 * no Yes/Skip gate — just the selection (orgs + a standalone opt-out).
 *
 * @param {Object} context - Service context
 * @param {Object} api - FirebaseAPI client
 * @returns {Promise<string|null>} - organization id, or null for standalone
 */
async function resolveOrganization(context, api) {
  return resolveConfigValue(context, {
    path: 'cloud.organizationId',
    label: 'Google Cloud organization',
    gate: false,
    message: 'Create the project inside a Google Cloud organization?',
    choices: () => api.listOrganizations(),
    getName: (org) => `${org.displayName} (${org.name.replace('organizations/', '')})`,
    getValue: (org) => org.name.replace('organizations/', ''),
    optOut: { label: 'No organization — create it standalone' },
  });
}

/**
 * Resolve (or interactively land) the Firebase project id.
 *
 * @param {Object} context - Service context
 * @param {Object} api - FirebaseAPI client
 * @returns {Promise<string|null>} - projectId, or null when skipped
 */
async function resolveFirebaseProject(context, api) {
  return resolveConfigValue(context, {
    path: 'cloud.config.projectId',
    label: 'Firebase project',
    choices: () => api.listProjects(),
    getName: (project) => `${project.displayName} (${project.projectId})`,
    getValue: (project) => project.projectId,
    createNew: {
      label: 'Firebase project',
      handler: async () => {
        const { brand } = context.brandConfig;

        const projects = await api.listProjects();
        const remaining = PROJECT_QUOTA - projects.length;
        const color = remaining <= 5 ? chalk.yellow : chalk.dim;
        const icon = remaining <= 5 ? '⚠' : '→';
        console.log(`    ${color(`${icon} Firebase project quota: ${projects.length}/${PROJECT_QUOTA} (${remaining} remaining)`)}`);

        const projectId = await input({
          message: 'Enter project ID (lowercase, numbers, hyphens only):',
          default: brand.id,
          validate: (val) => {
            if (!val?.trim()) {
              return 'Project ID is required';
            }
            if (!PROJECT_ID_PATTERN.test(val)) {
              return 'Project ID must be 6-30 chars, start with a letter, only lowercase letters, numbers, hyphens';
            }
            return true;
          },
        });

        const displayName = await input({
          message: 'Enter display name:',
          default: brand.name,
        });

        const organizationId = await resolveOrganization(context, api);
        console.log(`    Creating Firebase project ${chalk.cyan(projectId)}...`);
        if (organizationId) {
          console.log(`    ${chalk.dim('→')} Creating inside organization ${chalk.cyan(organizationId)}`);
        }
        await api.createProject(projectId, displayName, organizationId);
        console.log(`    ${chalk.green('✓')} Created`);

        return projectId;
      },
    },
  });
}

module.exports = { resolveFirebaseProject };
