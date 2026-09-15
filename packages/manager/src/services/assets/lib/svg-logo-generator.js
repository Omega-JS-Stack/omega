/**
 * SVG logo generator — wordmark and combomark SVGs via opentype.js
 * text-to-path conversion. All text is converted to path outlines so the
 * SVGs are self-contained (no font dependency at render time).
 *
 * The path DATA is rendered here rather than by opentype.js's
 * `Path.prototype.toPathData`: its rounding helper builds a number by
 * string concatenation (`Math.round(decimalPart + 'e+' + places)`), so a
 * coordinate sitting within float noise of an integer stringifies in
 * exponential notation and rounds to NaN, which truncates the glyph at
 * that token and renders the whole wordmark as a sliver (#916; upstream
 * https://github.com/opentypejs/opentype.js/issues/876, fixed on master
 * in 9c0a65f but absent from every release through 2.0.0). The commands
 * opentype hands us are clean, so rendering them ourselves is the fix.
 */

/**
 * Render SVG path data from opentype.js path commands, the compact way
 * (a leading minus separates a pair on its own, so only non-negative
 * values need a space in front).
 *
 * @param {Array<Object>} commands - opentype.js path commands
 * @param {number} decimals - Coordinate decimal places
 * @returns {string} The `d` attribute value
 */
function renderPathData(commands, decimals = 4) {
  const pack = (values) => values.map((value, index) => {
    const text = String(Number(value.toFixed(decimals)));
    return index > 0 && !text.startsWith('-') ? ` ${text}` : text;
  }).join('');

  return commands.map((command) => {
    switch (command.type) {
      case 'M': return `M${pack([command.x, command.y])}`;
      case 'L': return `L${pack([command.x, command.y])}`;
      case 'C': return `C${pack([command.x1, command.y1, command.x2, command.y2, command.x, command.y])}`;
      case 'Q': return `Q${pack([command.x1, command.y1, command.x, command.y])}`;
      case 'Z': return 'Z';
      // opentype.js emits only those five; anything else means the font
      // parsed into a shape we have never seen, not a path we can draw
      default: throw new Error(`unknown opentype path command "${command.type}"`);
    }
  }).join('');
}

/**
 * Render a text path and refuse a non-finite coordinate. One NaN poisons
 * the whole `<path>` and every raster derived from it while the step
 * still reports success, so a broken sliver ships unnoticed (#916):
 * the run fails instead, naming the font file and the text.
 *
 * @param {Object} path - opentype.js Path for the text
 * @param {string} text - The text that was converted
 * @param {string} fontPath - Full path of the font file it came from
 * @returns {string} The `d` attribute value
 */
function textPathData(path, text, fontPath) {
  const pathData = renderPathData(path.commands);

  if (/NaN|Infinity/.test(pathData)) {
    throw new Error(`font "${fontPath}" produced a non-finite outline for "${text}" (the path carries NaN or Infinity); refusing to write a broken logo`);
  }

  return pathData;
}

/**
 * Generate a wordmark SVG (text-only logo).
 *
 * @param {string} brandName - The brand name text
 * @param {Object} font - opentype.js Font object
 * @param {string} fontPath - Full path of the font file (named when an outline is unusable)
 * @returns {string} SVG markup
 */
function generateWordmark(brandName, font, fontPath) {
  const fontSize = 72;
  const fill = '#000000';

  const path = font.getPath(brandName, 0, 0, fontSize);
  const bbox = path.getBoundingBox();

  const width = bbox.x2 - bbox.x1;
  const height = bbox.y2 - bbox.y1;

  // Translate path so it starts at origin
  const translateX = -bbox.x1;
  const translateY = -bbox.y1;

  const pathData = textPathData(path, brandName, fontPath);

  return buildSvg(width, height, [
    `<path d="${pathData}" fill="${fill}" transform="translate(${round(translateX)}, ${round(translateY)})"/>`,
  ]);
}

/**
 * Generate a combomark SVG (brandmark left, text right).
 *
 * @param {string} brandName - The brand name text
 * @param {string} brandmarkSvg - Raw SVG content of the brandmark
 * @param {Object} font - opentype.js Font object
 * @param {string} fontPath - Full path of the font file (named when an outline is unusable)
 * @returns {string} SVG markup
 */
function generateCombomark(brandName, brandmarkSvg, font, fontPath) {
  const fontSize = 72;
  const fill = '#000000';
  const gapRatio = 0.3; // Gap between brandmark and text as fraction of brandmark height

  const textPath = font.getPath(brandName, 0, 0, fontSize);
  const textBbox = textPath.getBoundingBox();
  const textWidth = textBbox.x2 - textBbox.x1;
  const textHeight = textBbox.y2 - textBbox.y1;

  const viewBox = parseBrandmarkViewBox(brandmarkSvg);
  const brandmarkAspect = viewBox.width / viewBox.height;

  // Scale brandmark to match text height
  const brandmarkHeight = textHeight;
  const brandmarkWidth = brandmarkHeight * brandmarkAspect;

  // Layout: [brandmark] [gap] [text]
  const gapWidth = brandmarkHeight * gapRatio;
  const totalWidth = brandmarkWidth + gapWidth + textWidth;
  const totalHeight = Math.max(brandmarkHeight, textHeight);

  const brandmarkX = 0;
  const brandmarkY = (totalHeight - brandmarkHeight) / 2;

  const textOffsetX = brandmarkWidth + gapWidth - textBbox.x1;
  const textOffsetY = (totalHeight - textHeight) / 2 - textBbox.y1;

  const pathData = textPathData(textPath, brandName, fontPath);

  const brandmarkInner = extractSvgInner(brandmarkSvg);
  const viewBoxStr = `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;

  return buildSvg(totalWidth, totalHeight, [
    // Nested <svg> preserves the brandmark's viewBox so the renderer handles
    // content scaling and centering automatically (no manual transform needed)
    `<svg x="${round(brandmarkX)}" y="${round(brandmarkY)}" width="${round(brandmarkWidth)}" height="${round(brandmarkHeight)}" viewBox="${viewBoxStr}">`,
    ...brandmarkInner.map((line) => `  ${line}`),
    `</svg>`,
    `<path d="${pathData}" fill="${fill}" transform="translate(${round(textOffsetX)}, ${round(textOffsetY)})"/>`,
  ]);
}

/**
 * Build a clean, minimal SVG wrapper.
 */
function buildSvg(width, height, innerContent) {
  const w = round(width);
  const h = round(height);

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%">`,
    ...innerContent.map((line) => `  ${line}`),
    `</svg>`,
    ``,
  ].join('\n');
}

/**
 * Parse brandmark SVG viewBox dimensions.
 */
function parseBrandmarkViewBox(svgContent) {
  const match = svgContent.match(/viewBox="([^"]+)"/);
  if (!match) {
    return { x: 0, y: 0, width: 100, height: 100 };
  }

  const [x, y, width, height] = match[1].split(/\s+/).map(Number);
  return { x, y, width, height };
}

/**
 * Extract inner content from an SVG (everything between the opening <svg>
 * and closing </svg>). Preserves <g> groups, transforms, and all element
 * types; strips comments and vendor-specific attributes.
 */
function extractSvgInner(svgContent) {
  const openMatch = svgContent.match(/<svg\s[^>]*>/);
  if (!openMatch) {
    return [];
  }

  const innerStart = openMatch.index + openMatch[0].length;
  const innerEnd = svgContent.lastIndexOf('</svg>');
  if (innerEnd <= innerStart) {
    return [];
  }

  let inner = svgContent.slice(innerStart, innerEnd);

  inner = inner.replace(/<!--[\s\S]*?-->/g, '');
  inner = inner.replace(/<defs\s*\/>/g, '');
  inner = inner.replace(/\s+vectornator:\w+="[^"]*"/g, '');
  inner = inner.replace(/\s+xmlns:\w+="[^"]*"/g, '');
  inner = inner.replace(/\s+xml:space="[^"]*"/g, '');
  inner = inner.replace(/\s+opacity="1"/g, '');
  inner = inner.replace(/\s+stroke="none"/g, '');

  return inner.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Round to 2 decimal places (for positions/dimensions).
 */
function round(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { generateWordmark, generateCombomark, renderPathData };
