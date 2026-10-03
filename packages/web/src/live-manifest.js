/**
 * The dev lane's fold of an asset rebuild into the LIVE manifest the engine
 * renders from. Dev hands Eleventy the boot manifest by reference and its
 * entry names are stable, so every URL stays valid; only the CONTENT lists
 * move, and those have to reach the next render.
 */

/**
 * Fold a rebuild's content lists into the live manifest. Two lists are
 * content: the font preloads (the faces the compiled sheet declares) and
 * `js.imports` (the hashed chunks each entry's static chain loads). A rebuild
 * that skipped a lane carries no list for it and leaves the live one alone; an
 * emptied list still replaces. The answer is whether a list MOVED: the caller
 * then rewrites the manifest file, which is what re-renders Eleventy.
 * @param {object} manifest - the live manifest the engine holds
 * @param {object} next - what the rebuild returned
 * @returns {boolean} whether a list changed
 */
function refreshLiveManifest(manifest, next) {
  const lists = [
    [manifest, 'fontPreloads', next && next.fontPreloads],
    [manifest.js, 'imports', next && next.js && next.js.imports],
  ];
  const moved = lists.filter(([live, key, list]) => list && JSON.stringify(list) !== JSON.stringify(live[key]));
  moved.forEach(([live, key, list]) => { live[key] = list; });

  return moved.length > 0;
}

module.exports = { refreshLiveManifest };
