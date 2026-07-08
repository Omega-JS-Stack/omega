/**
 * SVG logo generator — wordmark and combomark SVGs via opentype.js
 * text-to-path conversion. All text is converted to path outlines so the
 * SVGs are self-contained (no font dependency at render time).
 */

/**
 * Generate a wordmark SVG (text-only logo).
 *
 * @param {string} brandName - The brand name text
 * @param {Object} font - opentype.js Font object
 * @returns {string} SVG markup
 */
function generateWordmark(brandName, font) {
  const fontSize = 72;
  const fill = '#000000';

  const path = font.getPath(brandName, 0, 0, fontSize);
  const bbox = path.getBoundingBox();

  const width = bbox.x2 - bbox.x1;
  const height = bbox.y2 - bbox.y1;

  // Translate path so it starts at origin
  const translateX = -bbox.x1;
  const translateY = -bbox.y1;

  const pathData = path.toPathData(4);

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
 * @returns {string} SVG markup
 */
function generateCombomark(brandName, brandmarkSvg, font) {
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

  const textPathData = textPath.toPathData(4);

  const brandmarkInner = extractSvgInner(brandmarkSvg);
  const viewBoxStr = `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;

  return buildSvg(totalWidth, totalHeight, [
    // Nested <svg> preserves the brandmark's viewBox so the renderer handles
    // content scaling and centering automatically (no manual transform needed)
    `<svg x="${round(brandmarkX)}" y="${round(brandmarkY)}" width="${round(brandmarkWidth)}" height="${round(brandmarkHeight)}" viewBox="${viewBoxStr}">`,
    ...brandmarkInner.map((line) => `  ${line}`),
    `</svg>`,
    `<path d="${textPathData}" fill="${fill}" transform="translate(${round(textOffsetX)}, ${round(textOffsetY)})"/>`,
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

module.exports = { generateWordmark, generateCombomark };
