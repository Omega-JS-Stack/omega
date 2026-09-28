/**
 * verb-scripts: the package.json scripts a framework scaffolds into its targets,
 * derived from the one verb table (verbs.js). Every fan-out verb a framework owns
 * (fanout `each`) is `"<verb>": "omega <verb>"`, so the brand-root fan-out's
 * `npm run <verb>` reaches the framework in every target. A single-target command
 * (fanout `none`) is no script: the brand root passes it to the framework's CLI.
 * Vendored with the table into every framework dist.
 */

const { VERBS } = require('./verbs.js');

/**
 * The verb scripts a framework owns.
 *
 * @param {string} framework - The framework package name ('@omega.js/web', ...).
 * @returns {Object<string, string>} Script name to `omega <verb>`, in table order.
 */
function verbScripts(framework) {
  return Object.fromEntries(VERBS
    .filter((row) => row.owners.includes(framework) && row.fanout === 'each')
    .map((row) => [row.name, `omega ${row.name}`]));
}

/**
 * Every script a framework writes into a target: its verb scripts, with the
 * scripts its manifest still declares (`projectScripts`) merged over them.
 *
 * @param {object} manifest - The framework's own package.json.
 * @returns {Object<string, string>} Script name to command.
 */
function projectScripts(manifest) {
  return { ...verbScripts(manifest.name), ...(manifest.projectScripts || {}) };
}

module.exports = { verbScripts, projectScripts };
