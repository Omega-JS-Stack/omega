/**
 * WHICH web target a CMS request writes into
 * ([#887](https://github.com/Omega-JS-Stack/omega/issues/887)).
 *
 * A brand's website lives at `targets/<name>/` inside the source monorepo, and
 * one backend serves EVERY website the brand runs. So a route that commits
 * repo content has to name the target before it can compose a path: the
 * request says which one (`target`), and this module turns that word into the
 * folder through @omega.js/config's one derivation (`targetPath`).
 *
 * The one-or-many rule, so the common brand never types a parameter it has no
 * choice about: with exactly ONE web target the name is optional and defaults
 * to it; with several it is REQUIRED, and a missing or unknown name fails the
 * request loudly with the declared list. Nothing is guessed, and no route
 * composes `targets/` by hand.
 */
const { targetsOfType, targetPath, sourceRepo } = require('@omega.js/config');

/**
 * A 400-shaped error: the routes answer with `e.code`.
 * @param {string} message - What the caller has to fix.
 * @returns {Error} The error, carrying `code: 400`.
 */
function badRequest(message) {
  return Object.assign(new Error(message), { code: 400 });
}

/**
 * The web target a CMS request addresses, as a name and its folder.
 *
 * @param {object} config - The composed omega config (Manager.config).
 * @param {string} [requested] - The request's `target` parameter.
 * @returns {{ name: string, path: string }} The target name and its brand-relative folder (`targets/<name>`).
 * @throws {Error} A `code: 400` error when the brand declares no web target, when several are declared and none was named, or when the named target is not one of them.
 */
function resolveWebTarget(config, requested) {
  const names = targetsOfType(config, 'web').map((entry) => entry.name);

  if (!names.length) {
    throw badRequest('This brand declares no web target: content has nowhere to land (declare one under `targets` in config/omega.json5).');
  }

  const name = typeof requested === 'string' ? requested.trim() : '';

  if (!name) {
    if (names.length > 1) {
      throw badRequest(`Missing required parameter: target (this brand runs ${names.length} web targets: [${names.join(', ')}])`);
    }

    return { name: names[0], path: targetPath(config, names[0]) };
  }

  if (!names.includes(name)) {
    throw badRequest(`Unknown target "${name}": this brand's web targets are [${names.join(', ')}]`);
  }

  return { name, path: targetPath(config, name) };
}

/**
 * Everything a CMS route needs before it can touch content: the SOURCE repo it
 * commits to, and the web target inside it the request addresses. The four
 * routes that write or read repo content (create, edit, raw file, read) each
 * used to repeat the same guard and the same try/catch; the block lives here
 * once, so a change to either answer is one edit.
 *
 * Both failures arrive as a response-shaped error, with the `code` the route
 * answers with: 500 for an unconfigured brand (the backend is misconfigured,
 * not the caller), and `resolveWebTarget`'s 400 for a request that names no
 * usable target.
 *
 * @param {object} config - The composed omega config (Manager.config).
 * @param {string} [requested] - The request's `target` parameter.
 * @returns {{ source: { owner: string, name: string, slug: string }, target: { name: string, path: string } }} The source repo and the addressed target.
 * @throws {Error} A `code: 500` error when the config names no repo, or a `code: 400` error from `resolveWebTarget`.
 */
function cmsContext(config, requested) {
  const source = sourceRepo(config);

  if (!source) {
    throw Object.assign(
      new Error('GitHub repo not configured (set repo.org and brand.id in config/omega.json5: the content repo is <brand.id>-omega under that org).'),
      { code: 500 },
    );
  }

  return { source, target: resolveWebTarget(config, requested) };
}

module.exports = { resolveWebTarget, cmsContext };
