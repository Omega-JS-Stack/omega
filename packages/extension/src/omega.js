// The extension's base runtime: the `Omega` class the contexts that do NOT host
// @omega.js/client extend (background, content, offscreen). The four page
// contexts extend the client instead (src/page-context.js) and take the same
// context members from contextMembers() below, so every context answers
// `context`, `extension`, `logger` and `messenger` from ONE home.

// Libraries
import extension from './lib/extension.js';
import LoggerLite from './lib/logger-lite.js';
import Messaging from './lib/messaging.js';
import { getEnvironment, isDevelopment, isProduction, isTesting, getVersion } from './utils/mode-helpers.js';
import { getApiUrl } from './utils/url-helpers.js';

/**
 * The members every extension context carries, built for one context name.
 * @param {string} name - the context: background, popup, options, sidepanel, page, content or offscreen.
 * @returns {{ context: string, extension: object, logger: LoggerLite, messenger: Messaging }} the context members.
 */
export function contextMembers(name) {
  return {
    context: name,
    extension,
    logger: new LoggerLite(name),
    messenger: new Messaging({ sender: name }),
  };
}

/**
 * The runtime of one extension context that does not host @omega.js/client.
 * Each context module exports ONE instance of it (or of its subclass); a
 * consumer never writes `new`, and awaits `initialize()` or `ready`.
 */
class Omega {
  /**
   * @param {string} name - the context name.
   */
  constructor(name) {
    Object.assign(this, contextMembers(name));

    // The snapshot the one /build.js assigned onto the global (#743): `self` in
    // the service worker, `window` in a document. A content script runs in the
    // HOST page, which loads no /build.js, so it has no snapshot to read.
    this.config = globalThis.OMEGA_BUILD_JSON?.config || {};

    // The extension's version, from the manifest
    this.version = getVersion();

    // Settled by initialize() with the instance: a module that did not call
    // initialize() can still await it
    this._readyResolve = null;
    this.ready = new Promise((resolve) => {
      this._readyResolve = resolve;
    });
  }

  /**
   * Settle `ready`. A subclass calls this first and does its own boot after,
   * the shape every OMEGA runtime subclass has.
   * @returns {Promise<Omega>} the instance.
   */
  async initialize() {
    this._readyResolve(this);

    return this;
  }

  // The environment surface (#817): @omega.js/config's ONE implementation,
  // reading this context's baked `config.environment`
  getEnvironment() {
    return getEnvironment.call(this);
  }

  isDevelopment() {
    return isDevelopment.call(this);
  }

  isProduction() {
    return isProduction.call(this);
  }

  isTesting() {
    return isTesting.call(this);
  }

  /**
   * The API base for this context (local stack in development and testing).
   * @param {string} [environment] - an override of the running environment.
   * @returns {string} the API base URL.
   */
  getApiUrl(environment) {
    return getApiUrl(this, environment);
  }
}

export default Omega;
export { Omega };
