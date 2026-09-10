/**
 * emptyModulesPlugin — every specifier in the list answers ONE empty CommonJS
 * module ([#737](https://github.com/Omega-JS-Stack/omega/issues/737), part of
 * [#128](https://github.com/Omega-JS-Stack/omega/issues/128)).
 *
 * A BROWSER bundle still receives imports of things a browser has no version
 * of: libraries reach for `fs`, `path` or `crypto` on code paths their browser
 * builds never take, and esbuild has no answer for them, so the build fails on
 * an import nothing will ever execute. webpack spelled the answer
 * `resolve.fallback: { fs: false, … }`; this is the same answer as an esbuild
 * resolve hook, and it is shared because every browser-targeting framework
 * needs it (@omega.js/desktop's renderer and @omega.js/extension's browser
 * bundles both pass their own list).
 *
 * The substitution is UNCONDITIONAL: a listed name is answered, never resolved
 * first. That is the whole point for a name that WOULD resolve — `electron`
 * resolves fine from a desktop project, and resolving it would inline the real
 * package into a renderer that must never reach it. A name on this list is a
 * name the caller has decided the bundle may not contain, whatever is installed.
 *
 * Anything NOT on the list is untouched and fails with esbuild's normal
 * resolution error, which is what a genuine missing dependency should do.
 */

const NAMESPACE = 'omega-empty-module';

/**
 * Regex-escape a module name so a specifier is matched literally.
 * @param {string} name - the module name
 * @returns {string}
 */
function escape(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string[]} names - the specifiers to answer with an empty module
 * @returns {object} the esbuild plugin
 */
function emptyModulesPlugin(names) {
  if (!Array.isArray(names) || names.length === 0) {
    // Registering the hook with nothing to answer means the caller believes it
    // shimmed something and did not — the exact bug this plugin exists to stop.
    throw new Error('[devkit empty-modules] names must be a non-empty array of specifiers to answer with an empty module');
  }

  // `node:` prefixed specifiers name the same built-ins and must shim the same.
  const filter = new RegExp(`^(node:)?(${names.map(escape).join('|')})$`);

  return {
    name: 'omega-empty-modules',
    setup(build) {
      build.onResolve({ filter }, (args) => ({ path: args.path, namespace: NAMESPACE }));
      // CommonJS, so a named import of anything reads as undefined at runtime
      // rather than failing the build — webpack's `false` fallback did the same.
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, () => ({
        contents: 'module.exports = {};',
        loader: 'js',
      }));
    },
  };
}

module.exports = { emptyModulesPlugin, NAMESPACE };
