/**
 * The template marker: the tag that says "this file belongs to the brand
 * template, replace it". Onboard never overwrites a file a person wrote; a file
 * carrying this marker is the one exception, so the template's own
 * `package.json` and `README.md` give way to the generated ones on the first run.
 *
 *   package.json   one field: `"omega": { "template": true }`
 *   README.md      the first line is `<!-- omega:template -->`
 *
 * Only those two files can carry it. The generated files carry no marker, so a
 * second run replaces nothing.
 */

const path = require('node:path');
const jetpack = require('fs-jetpack');
const { resolveBrandRoot } = require('@omega.js/config');

// The starter repo every brand begins from: "Use this template", clone, `npm start`
const TEMPLATE_URL = 'https://github.com/Omega-JS-Stack/brand-template';

// The README's first line in the template, a hidden comment beside the
// `omega:consumer-override` tag OMEGA already writes into override files
const TEMPLATE_COMMENT = '<!-- omega:template -->';

/**
 * Whether a file carries the template marker.
 *
 * @param {string} filePath - The file's path; only its base name decides which marker applies.
 * @param {string} [contents] - Its contents; read from `filePath` when omitted.
 * @returns {boolean} True for a marked `package.json` or `README.md`, false for anything else or a missing file.
 */
function carriesTemplateMarker(filePath, contents) {
  const name = path.basename(filePath);
  if (name !== 'package.json' && name !== 'README.md') {
    return false;
  }

  const text = contents ?? jetpack.read(filePath);
  if (typeof text !== 'string') {
    return false;
  }

  if (name === 'package.json') {
    // A manifest that does not parse was written by hand: it carries no marker
    try {
      return JSON.parse(text)?.omega?.template === true;
    } catch {
      return false;
    }
  }

  return text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].trim() === TEMPLATE_COMMENT;
}

/**
 * Whether a folder is a template copy not yet started: no brand above it, and
 * its own `package.json` carries the marker.
 *
 * @param {string} dir - The folder.
 * @returns {boolean}
 */
function isTemplateCopy(dir) {
  return !resolveBrandRoot(dir) && carriesTemplateMarker(path.join(dir, 'package.json'));
}

module.exports = { TEMPLATE_URL, TEMPLATE_COMMENT, carriesTemplateMarker, isTemplateCopy };
