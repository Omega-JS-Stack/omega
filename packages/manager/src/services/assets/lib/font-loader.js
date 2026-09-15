/**
 * Font loader for wordmark/combomark generation — resolves `brand.font`
 * (a font filename without extension, e.g. `Inter-Bold`) to a parsed
 * opentype.js Font.
 *
 * Search order: the brand repo's own `assets/fonts/` first, then the
 * system font directories. omega-manager instead PACKAGED the company's
 * commercial fonts (CromaSans/NowAlt — licensed, so they can't ship in a
 * published package) and defaulted every brand to CromaSans-ExtraBold via
 * a hardcoded alias table; the port has no packaged fonts and no default —
 * the brand owns its font choice.
 */
const { join } = require('node:path');
const { homedir } = require('node:os');
const jetpack = require('fs-jetpack');
const opentype = require('opentype.js');

const FONT_EXTENSIONS = ['.otf', '.ttf', '.woff'];

const SYSTEM_FONT_DIRS = [
  join(homedir(), 'Library', 'Fonts'),
  '/Library/Fonts',
  '/System/Library/Fonts',
];

/**
 * Find a font file by name (without extension).
 *
 * @param {string} name - Font filename, e.g. 'Inter-Bold'
 * @param {string} brandRoot - Brand repo root (its assets/fonts/ is searched first)
 * @returns {string|null} Full path to the font file, or null
 */
function findFontFile(name, brandRoot) {
  const dirs = [join(brandRoot, 'assets', 'fonts'), ...SYSTEM_FONT_DIRS];

  for (const dir of dirs) {
    for (const ext of FONT_EXTENSIONS) {
      const filePath = join(dir, `${name}${ext}`);
      if (jetpack.exists(filePath)) {
        return filePath;
      }
    }
  }

  return null;
}

/**
 * Load and parse a font. The resolved PATH rides along with the parsed
 * font: the generator names the file it read when a glyph outline comes
 * out unusable (#916), and a font name alone never says which of the
 * search dirs won.
 *
 * @param {string} name - Font filename without extension
 * @param {string} brandRoot - Brand repo root
 * @returns {Object|null} `{ font, fontPath }`, or null when no file was found
 */
function loadFont(name, brandRoot) {
  const fontPath = findFontFile(name, brandRoot);
  if (!fontPath) {
    return null;
  }

  const buffer = jetpack.read(fontPath, 'buffer');
  // opentype.parse expects an ArrayBuffer
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return { font: opentype.parse(arrayBuffer), fontPath };
}

module.exports = { loadFont, findFontFile };
