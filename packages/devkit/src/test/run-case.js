/**
 * run-case: the one place an OMEGA case spec is normalized and its cases run.
 * Every layer shares it: the host runner requires it, and the in-app layers
 * (an Electron window, a Chrome service worker) inline its source beside expect.js.
 *
 * This file has NO `require` call, so `expect` arrives as an argument.
 */

// The closure keeps every helper private, so an inliner's scope gains only the names it exports.
const { SkipError, waitFor, normalizeSpec, createContext, runCase, runSuite, errorOf } = (function () {
  const DEFAULT_TIMEOUT = 30000;
  const SUITE_KEYS = ['type', 'description', 'layer', 'stopOnFailure', 'tests'];

  class SkipError extends Error {
    constructor(reason) {
      super(reason);
      this.name = 'SkipError';
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Poll a condition until it returns a truthy value. A throwing condition counts as not ready.
   * @param {Function} condition - Sync or async; its first truthy return wins.
   * @param {number} [timeoutMs=5000] - How long to keep polling; a falsy value takes the default.
   * @param {number} [intervalMs=100] - The pause between polls; a falsy value takes the default.
   * @returns {Promise<*>} The first truthy value; rejects once the time is up.
   */
  async function waitFor(condition, timeoutMs, intervalMs) {
    const limit = timeoutMs || 5000;
    const pause = intervalMs || 100;
    const start = Date.now();
    while (Date.now() - start < limit) {
      try {
        const result = await condition();
        if (result) return result;
      } catch (e) {
        // Not ready yet: a condition that throws is polled again.
      }
      await sleep(pause);
    }
    throw new Error(`waitFor timed out after ${limit}ms`);
  }

  function specType(spec, file) {
    if (spec.type === 'suite' || spec.type === 'group') {
      if (!Array.isArray(spec.tests)) throw new Error(`${file}: a ${spec.type} spec needs a \`tests\` array`);
      return spec.type;
    }
    if (spec.type !== undefined) throw new Error(`${file}: unknown spec type ${JSON.stringify(spec.type)}`);
    if (Array.isArray(spec.tests)) return 'suite';
    if (typeof spec.run !== 'function') {
      throw new Error(`${file} does not export a \`defineCases\` spec: a standalone spec needs a \`run\` function`);
    }
    return 'standalone';
  }

  function normalizeCase(caseDef, index, file, name) {
    if (caseDef === null || typeof caseDef !== 'object') {
      throw new Error(`${file}: case ${index} is not an object`);
    }
    return {
      ...caseDef,
      id: `${file}#${index}`,
      index,
      name: name || caseDef.name || `step-${index + 1}`,
      run: caseDef.run,
      cleanup: caseDef.cleanup,
      timeout: caseDef.timeout,
      skip: caseDef.skip,
    };
  }

  /**
   * Normalize any of the four case-spec forms (standalone, suite, group, bare array).
   * @param {object|Array} spec - What a case file passed to defineCases.
   * @param {{ file: string }} options - The case file; it prefixes every case id.
   * @returns {object} `{ file, description, layer, type, stopOnFailure, timeout, skip, cleanup, cases }`.
   */
  function normalizeSpec(spec, { file }) {
    if (Array.isArray(spec)) return normalizeSpec({ type: 'group', tests: spec }, { file });
    if (spec === null || typeof spec !== 'object') throw new Error(`${file} does not export a \`defineCases\` spec: it must be an object or an array`);

    const type = specType(spec, file);
    const suite = {
      file,
      description: spec.description,
      layer: spec.layer,
      type,
      stopOnFailure: type === 'suite' && spec.stopOnFailure !== false,
      timeout: spec.timeout,
      skip: spec.skip,
      cleanup: spec.cleanup,
    };

    if (type !== 'standalone') {
      return { ...suite, cases: spec.tests.map((caseDef, index) => normalizeCase(caseDef, index, file)) };
    }

    // A standalone spec IS its one case: its cleanup is the case's, never the suite's.
    const own = {};
    for (const key of Object.keys(spec)) {
      if (!SUITE_KEYS.includes(key)) own[key] = spec[key];
    }
    return { ...suite, cleanup: undefined, cases: [normalizeCase(own, 0, file, spec.description)] };
  }

  /**
   * Build the one ctx a case body receives.
   * @param {{ expect: Function, state: object, layer: string, extras?: object }} options
   * @returns {object} `{ expect, waitFor, state, layer, skip(reason), ...extras }`.
   */
  function createContext({ expect, state, layer, extras }) {
    return {
      expect,
      waitFor,
      state,
      layer,
      skip(reason) { throw new SkipError(reason || 'skipped at runtime'); },
      ...extras,
    };
  }

  function skipReason(skip) {
    return typeof skip === 'string' ? skip : 'skipped';
  }

  function skipEvent(caseDef, reason) {
    return { id: caseDef.id, name: caseDef.name, status: 'skip', durationMs: 0, reason };
  }

  function errorOf(e) {
    if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack };
    return { name: 'Error', message: String(e), stack: undefined };
  }

  // A failing cleanup never fails what it cleans up after; it is said on stderr.
  async function runCleanup(cleanup, ctx, label) {
    if (typeof cleanup !== 'function') return;
    try {
      await cleanup(ctx);
    } catch (e) {
      console.warn(`cleanup failed for ${label}: ${e && e.message ? e.message : e}`);
    }
  }

  /**
   * Run one normalized case under its timeout.
   * @param {object} caseDef - A normalized case.
   * @param {object} ctx - From createContext.
   * @param {{ timeout?: number }} [options] - The suite's (or the default) timeout; the case's own wins.
   * @returns {Promise<object>} The case event. Never rejects.
   */
  async function runCase(caseDef, ctx, { timeout } = {}) {
    if (caseDef.skip) return skipEvent(caseDef, skipReason(caseDef.skip));

    const limit = caseDef.timeout || timeout || DEFAULT_TIMEOUT;
    const start = Date.now();
    let timer;
    try {
      await Promise.race([
        new Promise((resolve) => resolve(caseDef.run(ctx))),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Test timeout')), limit); }),
      ]);
    } catch (e) {
      const durationMs = Date.now() - start;
      if (e && e.name === 'SkipError') return { ...skipEvent(caseDef, e.message), durationMs };
      return { id: caseDef.id, name: caseDef.name, status: 'fail', durationMs, error: errorOf(e) };
    } finally {
      clearTimeout(timer);
    }

    const durationMs = Date.now() - start;
    await runCleanup(caseDef.cleanup, ctx, caseDef.name);
    return { id: caseDef.id, name: caseDef.name, status: 'pass', durationMs };
  }

  /**
   * Run a normalized suite's cases in order with one shared state, then its cleanup.
   * `extras` is the ctx extras: an object, or a function of `{ ...case, suite }`
   * (called with `{ suite }` alone for the suite cleanup).
   * @param {object} suite - From normalizeSpec.
   * @param {{ expect: Function, extras?: object|Function, defaultTimeout?: number, report: Function }} options
   * @returns {Promise<void>}
   */
  async function runSuite(suite, { expect, extras, defaultTimeout, report }) {
    const resolveExtras = (info) => (typeof extras === 'function' ? extras(info) : extras);

    if (suite.skip) {
      for (const caseDef of suite.cases) await report(skipEvent(caseDef, skipReason(suite.skip)));
      return;
    }

    const state = {};
    const stopOnFailure = suite.type === 'suite' && suite.stopOnFailure !== false;
    let stopped = false;

    for (const caseDef of suite.cases) {
      if (stopped) {
        await report(skipEvent(caseDef, 'suite stopped'));
        continue;
      }
      const ctx = createContext({
        expect,
        state,
        layer: suite.layer,
        extras: await resolveExtras({ ...caseDef, suite }),
      });
      const event = await runCase(caseDef, ctx, { timeout: suite.timeout || defaultTimeout });
      await report(event);
      if (event.status === 'fail' && stopOnFailure) stopped = true;
    }

    if (typeof suite.cleanup === 'function') {
      const ctx = createContext({ expect, state, layer: suite.layer, extras: await resolveExtras({ suite }) });
      await runCleanup(suite.cleanup, ctx, suite.description || suite.file);
    }
  }

  return { SkipError, waitFor, normalizeSpec, createContext, runCase, runSuite, errorOf };
})();

// An inliner reaches the seven names as locals; only a CommonJS loader has `module`.
if (typeof module !== 'undefined') {
  module.exports = { SkipError, waitFor, normalizeSpec, createContext, runCase, runSuite, errorOf };
}
