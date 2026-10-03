/**
 * The browser floor: the ONE syntax target every browser bundle compiles to,
 * and the browser APIs newer than it. esbuild lowers syntax and adds no API.
 *
 * `bundle()` passes `BROWSER_TARGET` when a caller names no target, and so
 * does @omega.js/web's inline-script minifier. The guard test reads every
 * browser source for `NEWER_BROWSER_APIS` and fails on a use no feature check
 * guards (`typeof`, `in` on its object, or `?.`, same statement or enclosing
 * `if`), so the floor and the list it implies are one edit here. Stdlib-free data.
 */

/**
 * esbuild's `target` for every browser bundle that names none.
 *
 * @type {string}
 */
const BROWSER_TARGET = 'es2020';

/**
 * Browser APIs newer than `BROWSER_TARGET`: `name` is how a failure names the
 * API, `pattern` the literal text the guard searches the sources for.
 *
 * @type {Array<{ name: string, pattern: string }>}
 */
const NEWER_BROWSER_APIS = [
  { name: 'AbortSignal.timeout', pattern: 'AbortSignal.timeout' },
  { name: 'structuredClone', pattern: 'structuredClone' },
  { name: 'Array.prototype.at', pattern: '.at(' },
  { name: 'Object.hasOwn', pattern: 'Object.hasOwn' },
  { name: 'navigator.userAgentData', pattern: 'navigator.userAgentData' },
  { name: 'scrollend', pattern: 'scrollend' },
  { name: 'Array.prototype.findLast', pattern: '.findLast(' },
  { name: 'String.prototype.replaceAll', pattern: '.replaceAll(' },
  { name: 'Promise.any', pattern: 'Promise.any' },
  { name: 'WeakRef', pattern: 'WeakRef' },
  { name: 'Element.prototype.replaceChildren', pattern: '.replaceChildren(' },
];

module.exports = { BROWSER_TARGET, NEWER_BROWSER_APIS };
