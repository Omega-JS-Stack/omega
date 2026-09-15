// The BROWSER half of the fixture (the `browser` export condition), for the
// targets whose bundles are browser output: @omega.js/web's esm chunks and
// service worker, @omega.js/extension's iife bundles. It reaches for no Node
// built-in and no `import.meta` (esbuild rewrites `import.meta` in iife output
// too, and warns), because the thing a browser bundle has to prove is the other
// half of [#906](https://github.com/Omega-JS-Stack/omega/issues/906): an
// ESM-only package resolves, bundles and RUNS, with a real value on the other
// side.
export const flavor = 'browser';
export const marker = 'ESM_ONLY_FIXTURE_BROWSER';

/**
 * A value the bundled copy has to compute at RUNTIME, so a test asserting it
 * proves the module evaluated rather than proving its text survived.
 * @returns {string} the fixture's own name for itself
 */
export function describeFixture() {
  return `${marker}:${flavor}`;
}
