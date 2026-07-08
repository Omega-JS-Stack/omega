/**
 * SEO template registry with convention-based auto-discovery. Each template
 * is a directory here; files starting with `_` and ending with `.js` are
 * generators (strip both → target path, e.g. _README.md.js → README.md),
 * everything else is a static file pushed as-is.
 */
const { join, relative, resolve, dirname, basename } = require('node:path');
const jetpack = require('fs-jetpack');

const TEMPLATES = [
  'developer-tool',
];

const loaded = {};

for (const name of TEMPLATES) {
  const templateDir = join(__dirname, name);
  // find() returns cwd-relative paths — resolve to absolute so template
  // loading works from any cwd (the manager runs from the brand root)
  const allPaths = jetpack.find(templateDir, { recursive: true, files: true }).map((p) => resolve(p));
  const files = [];

  for (const absPath of allPaths) {
    const relPath = relative(templateDir, absPath);
    const fileName = basename(absPath);

    if (fileName.startsWith('_') && fileName.endsWith('.js')) {
      const targetName = fileName.slice(1, -3);
      const dir = dirname(relPath);
      const targetPath = dir === '.' ? targetName : join(dir, targetName);
      files.push({ path: targetPath, generate: require(absPath) });
    } else {
      files.push({ path: relPath, content: jetpack.read(absPath) });
    }
  }

  loaded[name] = { files };
}

/**
 * Load a template by name
 *
 * @param {string} name - Template name (e.g. 'developer-tool')
 * @returns {{ files: Array<{path: string, generate?: Function, content?: string}> }}
 */
function loadTemplate(name) {
  const template = loaded[name];

  if (!template) {
    const available = Object.keys(loaded).join(', ');
    throw new Error(`Unknown SEO template: "${name}". Available: ${available}`);
  }

  return template;
}

module.exports = { loadTemplate };
