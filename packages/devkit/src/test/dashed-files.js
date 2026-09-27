/**
 * The files under a tree that carry an em dash (U+2014).
 *
 * Every file a framework copies into a consumer's repo meets that repo's own
 * commit guard, which may refuse the character, so each emitted tree pins
 * itself with an equality on `dashedFiles(ROOT)` against `[]`.
 *
 * A walk that finds almost nothing means a wrong root, and a pin over an empty
 * list would pass vacuously, so that walk throws instead. Node builtins only:
 * the backend vendors this file as a raw asset, with no specifier rewrite.
 */
const fs = require('node:fs');
const path = require('node:path');

// Fewer files than this under a root means the walk missed its tree.
const MIN_FILES = 6;

/**
 * @param {string} root - Absolute directory to walk
 * @returns {string[]} Root-relative paths of the files carrying U+2014, sorted
 */
function dashedFiles(root) {
  const files = fs.readdirSync(root, { recursive: true })
    .map((entry) => path.join(root, entry))
    .filter((file) => fs.statSync(file).isFile());

  if (files.length < MIN_FILES) {
    throw new Error(`dashedFiles: the walk of ${root} found ${files.length} files, so the pin would pass vacuously`);
  }

  return files
    .filter((file) => fs.readFileSync(file, 'utf8').includes('\u2014'))
    .map((file) => path.relative(root, file))
    .sort();
}

module.exports = { dashedFiles };
