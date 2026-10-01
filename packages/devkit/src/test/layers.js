/**
 * The layer registry: every framework's test layers, in run order, and where
 * each one runs. A `host` row runs its cases in the runner process; an `app`
 * row runs them inside the app, which reports each case back to the host.
 * `extras` names the ctx keys the row's driver adds to every case.
 *
 * `node` is the framework of a package no framework owns: a library, the root
 * `scripts/`, the lanes.
 */

const LAYERS = {
  desktop: [
    { name: 'build', kind: 'host', extras: [] },
    { name: 'main', kind: 'app', extras: ['omega'] },
    { name: 'renderer', kind: 'app', extras: ['page'] },
    { name: 'boot', kind: 'app', extras: ['omega', 'projectRoot', 'appRoot', 'frameworkDistRoot', 'distSnapshotBefore'] },
  ],
  extension: [
    { name: 'build', kind: 'host', extras: [] },
    { name: 'background', kind: 'app', extras: [] },
    { name: 'view', kind: 'app', extras: ['page'] },
    { name: 'boot', kind: 'host', extras: ['extension', 'page'] },
  ],
  web: [
    { name: 'build', kind: 'host', extras: [] },
  ],
  backend: [
    { name: 'emulator', kind: 'host', extras: ['http', 'accounts', 'firestore', 'pubsub', 'admin', 'omega', 'rules', 'config', 'payments'] },
  ],
  node: [
    { name: 'node', kind: 'host', extras: [] },
  ],
};

/**
 * The layer rows of one framework, in run order.
 * @param {string} framework - A LAYERS key.
 * @returns {Array<{name: string, kind: string, extras: string[]}>} The rows.
 */
function layersFor(framework) {
  if (!Object.prototype.hasOwnProperty.call(LAYERS, framework)) {
    throw new Error(`Unknown test framework "${framework}" (known: ${Object.keys(LAYERS).join(', ')})`);
  }
  return LAYERS[framework];
}

/**
 * The layer a suite that names none runs on: the framework's first row.
 * @param {string} framework - A LAYERS key.
 * @returns {string} The row name.
 */
function defaultLayer(framework) {
  return layersFor(framework)[0].name;
}

/**
 * Does a row need a driver? An app row always does, and a host row whose
 * cases expect extras needs something to supply them.
 * @param {{kind: string, extras: string[]}} row - A LAYERS row.
 * @returns {boolean} True when the row cannot run without a driver.
 */
function needsDriver(row) {
  return row.kind === 'app' || row.extras.length > 0;
}

module.exports = { LAYERS, layersFor, defaultLayer, needsDriver };
