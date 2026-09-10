/**
 * Shared plumbing for the rules suites that compile their OWN ruleset
 * ([#353](https://github.com/Omega-JS-Stack/omega/issues/353)).
 *
 * Everything else in test/rules/ runs against the fixture project's compiled
 * artifact (the shipped seed, no brand rules). These suites prove what a BRAND
 * file does to that artifact, so each one compiles a brand source exactly as
 * `omega build` does and loads the result into its own emulator project.
 *
 * `_`-prefixed, so the runner never discovers it as a suite.
 */
const jetpack = require('fs-jetpack');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { BRAND_RULES_SEED, compileRules } = require('../../dist/cli/utils/compile-rules.js');

// The line the seed reserves for a brand's own rules.
const YOUR_RULES_MARKER = '// ─── Your rules ─';

/**
 * The shipped seed with `rules` written into its own rules region — the file a
 * brand would have after typing them in.
 * @param {string} [rules] - Rules text, indented for the documents block.
 * @returns {string}
 */
function brandSourceWith(rules) {
  const seed = jetpack.read(BRAND_RULES_SEED);
  if (!rules) {
    return seed;
  }

  const lineEnd = seed.indexOf('\n', seed.indexOf(YOUR_RULES_MARKER));

  return `${seed.slice(0, lineEnd + 1)}${rules}\n${seed.slice(lineEnd + 1)}`;
}

/**
 * Compile a brand source against the framework half, exactly as a stage does.
 * @param {string} [rules] - Rules text, indented for the documents block.
 * @returns {string} The compiled ruleset.
 */
function compiledWith(rules) {
  return compileRules({ brandSource: brandSourceWith(rules) }).compiled;
}

/**
 * A rules-testing environment on its own project id, carrying `rules`.
 * @param {string} projectId
 * @param {string} rules - A whole compiled ruleset.
 * @returns {Promise<object>}
 */
async function environment(projectId, rules) {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

  const env = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(port), rules },
  });

  // Rules-only projects are shared with whatever ran before on the same
  // emulator, and a create test that finds a document is not a create test.
  await env.clearFirestore();

  return env;
}

module.exports = { brandSourceWith, compiledWith, environment };
