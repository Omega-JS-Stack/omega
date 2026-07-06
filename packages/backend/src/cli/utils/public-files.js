// Hosting boilerplate generator — public/index.html + public/404.html from
// templates/public/. Consumers never edit or track these files (setup
// overwrites them on every run; the Default Values .gitignore ignores
// /public/), so they behave like the root package.json proxy:
// framework-generated output.
//
// Two entry points:
//   - writePublicFiles (setup test, overwrite: true) — authoritative regen
//     with the brand URL from the consumer's backend-manager-config.json
//   - ensurePublicFiles (emulator boot / deploy, fill-if-missing) — a fresh
//     clone has no public/ at all (it's gitignored), and firebase-tools
//     refuses to boot or deploy hosting without the folder; this fills it
//     without requiring a setup run first

const jetpack = require('fs-jetpack');
const path = require('path');
const powertools = require('node-powertools');
const JSON5 = require('json5');

const TEMPLATE_DIR = path.resolve(__dirname, '../../../templates/public');
const FILES = ['index.html', '404.html'];

function writePublicFiles(projectPath, options) {
  options = options || {};

  FILES.forEach((file) => {
    const destination = path.join(projectPath, 'public', file);

    if (!options.overwrite && jetpack.exists(destination)) {
      return;
    }

    const template = jetpack.read(path.join(TEMPLATE_DIR, file));
    jetpack.write(destination, powertools.template(template, { url: options.url || '' }));
  });
}

function ensurePublicFiles(projectPath) {
  // backend-manager-config.json is JSON5 (comments allowed) — strict JSON.parse fails
  let url = '';
  try {
    url = JSON5.parse(jetpack.read(path.join(projectPath, 'functions', 'backend-manager-config.json')))?.brand?.url || '';
  } catch (e) {
    // Unreadable config — boilerplate links home to '' until setup writes the real one
  }

  writePublicFiles(projectPath, { url, overwrite: false });
}

module.exports = { writePublicFiles, ensurePublicFiles };
