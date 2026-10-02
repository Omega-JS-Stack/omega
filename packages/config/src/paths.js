/**
 * The one spelling of a config path: keys joined with `.`, a list position in
 * brackets (`seo.github.content[0].org`). Every walker that reports a path
 * builds it here, and `pathSteps` is the one parser that reads it back.
 */

/**
 * The path of a key under a parent path.
 * @param {string} parent - The parent's path, '' at the root.
 * @param {string} key
 * @returns {string} e.g. 'seo.github'
 */
function keyPath(parent, key) {
  return parent ? `${parent}.${key}` : key;
}

/**
 * The path of a list item under its list's path.
 * @param {string} parent - The list's path.
 * @param {number} index
 * @returns {string} e.g. 'seo.github.content[0]'
 */
function itemPath(parent, index) {
  return `${parent}[${index}]`;
}

/**
 * The steps of a path as the walkers report it, a list position a number.
 * @param {string} path - e.g. 'seo.github.content[0].org'.
 * @returns {Array<string|number>} e.g. ['seo', 'github', 'content', 0, 'org'].
 */
function pathSteps(path) {
  return path.split('.').flatMap((segment) => {
    const [key, ...positions] = segment.split('[');
    return [key, ...positions.map((position) => Number(position.slice(0, -1)))];
  });
}

/**
 * The path of a list of steps, the inverse of pathSteps: a number step a list position.
 * @param {Array<string|number>} steps - e.g. ['seo', 'github', 'content', 0, 'org'].
 * @returns {string} e.g. 'seo.github.content[0].org'.
 */
function spellSteps(steps) {
  return steps.reduce((spelled, step) => (typeof step === 'number' ? itemPath(spelled, step) : keyPath(spelled, step)), '');
}

module.exports = { keyPath, itemPath, pathSteps, spellSteps };
