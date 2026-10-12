/**
 * serializeSuite(suite): a normalized suite as plain data, for a body that runs
 * where the function cannot travel (a page, a worker, a booted app). Every
 * function becomes its body text (fn-source.js), rebuilt there as a function of `ctx`.
 * The one serializer of every framework that runs cases in an app.
 */

const { fnSource } = require('./fn-source.js');

/**
 * A key the suite file declared beside `layer` (`view`, `context`). A standalone
 * spec IS its one case, so normalizeSpec keeps its own keys there.
 * @param {object} suite - A normalized suite (run-case.js `normalizeSpec`).
 * @param {string} key - The key.
 * @returns {*} The declared value, or undefined.
 */
function specKey(suite, key) {
  return suite.type === 'standalone' ? suite.cases[0][key] : suite[key];
}

// The body text of `fn`, or a body that throws naming `label` when fnSource refuses it.
function sourceOf(fn, label) {
  if (fn === undefined || fn === null) return undefined;
  try {
    return fnSource(fn);
  } catch (e) {
    return `throw new Error(${JSON.stringify(`${label}: ${e.message}`)});`;
  }
}

// The object without its undefined-valued keys.
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

/**
 * Serialize one normalized suite. A skipped case keeps its `runSource`, so the
 * shape never depends on `skip`; a key whose value is undefined is left out.
 * @param {object} suite - A normalized suite, its cases already filtered.
 * @returns {object} `{ file, description, type, stopOnFailure, timeout, skip, view, context,
 *   setupSource, cleanupSource, cases: [{ id, name, timeout, skip, runSource, cleanupSource }] }`.
 */
function serializeSuite(suite) {
  const { file } = suite;
  return defined({
    file,
    description: suite.description,
    type: suite.type,
    stopOnFailure: suite.stopOnFailure,
    timeout: suite.timeout,
    skip: suite.skip,
    view: specKey(suite, 'view'),
    context: specKey(suite, 'context'),
    setupSource: sourceOf(suite.setup, `${file}: the suite setup`),
    cleanupSource: sourceOf(suite.cleanup, `${file}: the suite cleanup`),
    cases: suite.cases.map((caseDef) => defined({
      id: caseDef.id,
      name: caseDef.name,
      timeout: caseDef.timeout,
      skip: caseDef.skip,
      runSource: sourceOf(caseDef.run, `${file}: case ${caseDef.name}`),
      cleanupSource: sourceOf(caseDef.cleanup, `${file}: case ${caseDef.name} cleanup`),
    })),
  });
}

module.exports = { serializeSuite, specKey };
