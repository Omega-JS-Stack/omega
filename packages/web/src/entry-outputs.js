/**
 * The asset manifest's js block, read off esbuild's metafile: each entry's
 * site URL, slotted where buildAssets' entry map puts it, and `js.imports`,
 * the chunks each entry's STATIC import chain loads. The page writes a
 * `<link rel="modulepreload">` per chunk, so the browser fetches the whole
 * chain at once instead of one hop per round trip. A chunk reached only through
 * `import()` is never listed, so a lazily loaded SDK stays off the first load.
 */
const path = require('node:path');

/**
 * The site URL of one esbuild output (root-relative, like every manifest URL).
 * @param {string} outDir - the site output dir
 * @param {string} outFile - an output path as the metafile spells it
 * @returns {string}
 */
function outputUrl(outDir, outFile) {
  return `/${path.relative(outDir, outFile)}`;
}

/**
 * Every output an entry reaches through static imports, transitively. Dynamic
 * imports end the walk: what they load arrives on demand, never up front.
 * @param {object} outputs - the metafile's `outputs`
 * @param {string} outFile - the entry's output path
 * @param {string} outDir - the site output dir
 * @returns {string[]} the chunks' site URLs, deduped and sorted
 */
function staticChunks(outputs, outFile, outDir) {
  const reached = new Set();
  const queue = [outFile];
  while (queue.length) {
    for (const { path: file, kind, external } of outputs[queue.shift()].imports) {
      if (kind !== 'import-statement' || external || reached.has(file)) continue;
      reached.add(file);
      queue.push(file);
    }
  }

  return [...reached].map((file) => outputUrl(outDir, file)).sort();
}

/**
 * Fill the manifest's js block from one bundle's metafile: `main`,
 * `firstPaint`, each page and layout slot, and `imports` keyed by those same
 * entry URLs.
 * @param {object} metafile - esbuild's metafile for the js bundle
 * @param {string} outDir - the site output dir
 * @param {Map<string, Array>} keyBySpecifier - entry source → `['main']`,
 *   `['firstPaint']` or `[bucket, key, slot]`
 * @param {object} js - the manifest's js block, its lane lists sized up front
 */
function readEntryOutputs(metafile, outDir, keyBySpecifier, js) {
  js.imports = {};
  for (const [outFile, meta] of Object.entries(metafile.outputs)) {
    if (!meta.entryPoint) continue;
    const abs = meta.entryPoint.replace(/^omega-boot:/, '');
    const spec = keyBySpecifier.get(path.resolve(abs)) || keyBySpecifier.get(abs);
    if (!spec) continue;
    const url = outputUrl(outDir, outFile);
    if (spec[0] === 'main') js.main = url;
    else if (spec[0] === 'firstPaint') js.firstPaint = url;
    else js[spec[0]][spec[1]][spec[2]] = url;
    js.imports[url] = staticChunks(metafile.outputs, outFile, outDir);
  }
}

module.exports = { readEntryOutputs };
