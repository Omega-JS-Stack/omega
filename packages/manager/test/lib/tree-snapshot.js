/**
 * Every entry under a folder, for "this run wrote nothing" checks: each file as
 * its size and modified time, each folder by its presence, so a rewrite, a new
 * file and a new empty folder all show. Symlinks are recorded, never followed.
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string} dir - The folder to read.
 * @returns {object} Relative path → `{ size, mtimeMs }` for a file, `'dir'` for a folder.
 */
function snapshot(dir) {
  const entries = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        entries[path.relative(dir, full)] = 'dir';
        walk(full);
        continue;
      }
      const stat = fs.lstatSync(full);
      entries[path.relative(dir, full)] = { size: stat.size, mtimeMs: stat.mtimeMs };
    }
  };
  walk(dir);
  return entries;
}

module.exports = { snapshot };
