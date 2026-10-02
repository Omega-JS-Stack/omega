/**
 * What `npm install` leaves at a brand root, without running npm: every
 * declared dependency of the root and its targets under node_modules (the
 * @omega.js ones linked to this checkout), and one link per workspace.
 */
const fs = require('node:fs');
const path = require('node:path');

const PACKAGES = path.join(__dirname, '..', '..', '..');

const manifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

/**
 * @param {string} root - An onboarded brand root.
 * @returns {string} The same root, now installed.
 */
function install(root) {
  const targets = fs.readdirSync(path.join(root, 'targets')).map((name) => path.join(root, 'targets', name));
  const modules = path.join(root, 'node_modules');
  for (const dir of [root, ...targets]) {
    const { dependencies = {}, devDependencies = {} } = manifest(dir);
    for (const name of Object.keys({ ...dependencies, ...devDependencies })) {
      const dest = path.join(modules, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(dest)) continue;
      if (name.startsWith('@omega.js/')) fs.symlinkSync(path.join(PACKAGES, name.slice('@omega.js/'.length)), dest, 'dir');
      else fs.mkdirSync(dest);
    }
  }
  for (const dir of targets) fs.symlinkSync(dir, path.join(modules, manifest(dir).name), 'dir');
  return root;
}

module.exports = { install };
