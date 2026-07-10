/**
 * Interactive Firebase project selection/creation (config-landing flow):
 * when firebase.projectId is missing in an interactive run, pick from the
 * projects the authed user can see, or create one — project id + display
 * name prompted (brand id/name as defaults), created inside
 * firebase.organizationId when configured (that's what gives the compute
 * service account its default roles), with the 30-project quota shown.
 * The chosen id lands in omega.json5 (comment-preserving writeback).
 */
const chalk = require('chalk').default;
const { input } = require('@omega.js/devkit/prompt');
const { resolveConfigValue } = require('../../../lib/config-flow.js');

const PROJECT_QUOTA = 30;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/**
 * Resolve (or interactively land) the Firebase project id.
 *
 * @param {Object} context - Service context
 * @param {Object} api - FirebaseAPI client
 * @returns {Promise<string|null>} - projectId, or null when skipped
 */
async function resolveFirebaseProject(context, api) {
  return resolveConfigValue(context, {
    path: 'firebase.projectId',
    label: 'Firebase project',
    choices: () => api.listProjects(),
    getName: (project) => `${project.displayName} (${project.projectId})`,
    getValue: (project) => project.projectId,
    createNew: {
      label: 'Firebase project',
      handler: async () => {
        const { brand, firebase } = context.brandConfig;

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

        const organizationId = firebase?.organizationId;
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
