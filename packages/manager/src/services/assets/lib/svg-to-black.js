/**
 * Convert an SVG to a pure black version — the source for the `black-*`
 * logo variants (and macOS template images, which must be pure black with
 * alpha so the system can invert them in dark mode).
 *
 * Replaces all fills and strokes with #000000:
 * - Removes <defs> blocks (gradients, filters, patterns)
 * - Converts fill="..." / stroke="..." attributes (fill="none" preserved)
 * - Converts fill:... / stroke:... in style attributes (none preserved)
 */

/**
 * @param {string} svgContent - Raw SVG string
 * @returns {string} SVG with all colors replaced by black
 */
function convertSvgToBlack(svgContent) {
  let svg = svgContent;

  svg = svg.replace(/<defs>[\s\S]*?<\/defs>/gi, '');
  svg = svg.replace(/<defs\s*\/>/gi, '');

  svg = svg.replace(/\bfill="(?!none)[^"]*"/g, 'fill="#000000"');
  svg = svg.replace(/\bstroke="(?!none)[^"]*"/g, 'stroke="#000000"');

  // fill:url(#...), fill:#hex, fill:rgb(...), fill:colorname inside style="..."
  svg = svg.replace(/\bfill\s*:\s*(?!none)[^;}"]+/g, 'fill:#000000');
  svg = svg.replace(/\bstroke\s*:\s*(?!none)[^;}"]+/g, 'stroke:#000000');

  return svg;
}

module.exports = { convertSvgToBlack };
