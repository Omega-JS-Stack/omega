/**
 * The brand-template repo's two files, exactly as the template ships them: a
 * `package.json` carrying the template marker, whose `npm start` installs and
 * runs onboard, and a README whose first line is the marker comment.
 */
const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE_PACKAGE = {
  name: 'omega-brand-template',
  private: true,
  engines: { node: '>=22' },
  omega: { template: true },
  scripts: {
    prestart: "node -e \"if (+process.versions.node.split('.')[0] < 22) { console.error('OMEGA needs Node 22 or newer. You have ' + process.version + '.'); process.exit(1) }\"",
    start: 'npm install && omega onboard',
  },
  devDependencies: { '@omega.js/manager': 'latest' },
};

const TEMPLATE_README = '<!-- omega:template -->\n# OMEGA brand template\n\nClick "Use this template", clone your copy, and run `npm start`.\n';

/**
 * Write the template's two files into `dir`, as a fresh copy of the repo holds them.
 * @param {string} dir - The folder to stage into (created when missing).
 * @returns {string} The folder.
 */
function stageTemplate(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(TEMPLATE_PACKAGE, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'README.md'), TEMPLATE_README);
  return dir;
}

module.exports = { TEMPLATE_PACKAGE, TEMPLATE_README, stageTemplate };
