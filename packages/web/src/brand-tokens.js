/**
 * Brand accent ramp — derives the accent token family from ONE brand color
 * (C3/D6: `brand.color` drives the accent everywhere via CSS custom
 * properties; the static token sheet's neutral placeholder stands when the
 * brand has no usable color).
 *
 * Pure math, dependency-free: hex → RGB → HSL round-trips plus WCAG
 * relative luminance for the on-accent ink pick. Every output value is
 * regenerated from parsed numbers, so nothing from config reaches the
 * emitted <style> block verbatim.
 */

const INK_DARK = '#111213';
const INK_LIGHT = '#ffffff';

// WCAG contrast-vs-white beats contrast-vs-black below this luminance
const INK_LUMINANCE_THRESHOLD = 0.1791;

// Accents darker than this lightness brighten on hover instead of darkening
const HOVER_LIGHTEN_THRESHOLD = 0.25;

/**
 * Parse a 3- or 6-digit hex color.
 * @param {*} value - candidate color
 * @returns {{ r: number, g: number, b: number }|null} channels 0-255, or null
 */
function parseHex(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) {
    return null;
  }

  let hex = match[1].toLowerCase();
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }

  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

/**
 * WCAG 2.x relative luminance.
 * @param {{ r: number, g: number, b: number }} rgb - channels 0-255
 * @returns {number} 0 (black) to 1 (white)
 */
function relativeLuminance({ r, g, b }) {
  const linearize = (channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : (((c + 0.055) / 1.055) ** 2.4);
  };
  return (0.2126 * linearize(r)) + (0.7152 * linearize(g)) + (0.0722 * linearize(b));
}

/**
 * RGB (0-255) → HSL (h 0-360, s/l 0-1).
 */
function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) {
    h = ((gn - bn) / d) + (gn < bn ? 6 : 0);
  } else if (max === gn) {
    h = ((bn - rn) / d) + 2;
  } else {
    h = ((rn - gn) / d) + 4;
  }

  return { h: h * 60, s, l };
}

/**
 * HSL (h 0-360, s/l 0-1) → RGB (0-255).
 */
function hslToRgb({ h, s, l }) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }

  const hueToChannel = (p, q, t) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + ((q - p) * 6 * tn);
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + ((q - p) * ((2 / 3) - tn) * 6);
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - (l * s);
  const p = (2 * l) - q;
  const hn = h / 360;

  return {
    r: Math.round(hueToChannel(p, q, hn + (1 / 3)) * 255),
    g: Math.round(hueToChannel(p, q, hn) * 255),
    b: Math.round(hueToChannel(p, q, hn - (1 / 3)) * 255),
  };
}

/**
 * RGB → #rrggbb.
 */
function toHex({ r, g, b }) {
  const pair = (v) => v.toString(16).padStart(2, '0');
  return `#${pair(r)}${pair(g)}${pair(b)}`;
}

/**
 * Shift an accent's lightness for hover/active states — darker accents
 * brighten, everything else deepens, clamped to [0, 1].
 * @param {{ h: number, s: number, l: number }} hsl - base accent
 * @param {number} amount - lightness delta (positive magnitude)
 * @returns {string} #rrggbb
 */
function shiftLightness(hsl, amount) {
  const direction = hsl.l < HOVER_LIGHTEN_THRESHOLD ? 1 : -1;
  const l = Math.min(1, Math.max(0, hsl.l + (direction * amount)));
  return toHex(hslToRgb({ ...hsl, l }));
}

/**
 * Compose the accent token family from a brand color.
 * @param {string} color - brand color (#rgb or #rrggbb)
 * @returns {object|null} ramp for the head emitter, or null when unusable:
 *   { accent, accentHover, accentActive, accentSubtle, accentInk, accentRing }
 */
function composeBrandTokens(color) {
  const rgb = parseHex(color);
  if (!rgb) {
    return null;
  }

  const hsl = rgbToHsl(rgb);
  const luminance = relativeLuminance(rgb);

  return {
    accent: toHex(rgb),
    accentHover: shiftLightness(hsl, 0.07),
    accentActive: shiftLightness(hsl, 0.11),
    accentSubtle: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`,
    accentInk: luminance > INK_LUMINANCE_THRESHOLD ? INK_DARK : INK_LIGHT,
    accentRing: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`,
  };
}

module.exports = { composeBrandTokens, parseHex, relativeLuminance };
