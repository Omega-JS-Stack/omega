/**
 * media.js — the media uj tags (icon, logo, image, video).
 *
 * Ported from jekyll-uj-powertools lib/tags/{icon,logo,image,video}.rb.
 * Icon/logo SVG loading is directory-injectable via the adapter options
 * (`options.icons.fontAwesomeDir` / `options.icons.flagsDir` /
 * `options.logos.dir`) — no hardcoded node_modules path like the Ruby had.
 * Missing dirs or files fall back to the same default warning-triangle SVG.
 */

// Libraries
const fs = require('fs');
const path = require('path');
const { resolveInput, parseArguments, parseOptions, stripQuotes } = require('../variable-resolver.js');
const { LANGUAGE_TO_COUNTRY } = require('../data/language-flags.js');

// Constants (verbatim from the Ruby port)
const DEFAULT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.--><path d="M320 64C334.7 64 348.2 72.1 355.2 85L571.2 485C577.9 497.4 577.6 512.4 570.4 524.5C563.2 536.6 550.1 544 536 544L104 544C89.9 544 76.9 536.6 69.6 524.5C62.3 512.4 62.1 497.4 68.8 485L284.8 85C291.8 72.1 305.3 64 320 64zM320 232C306.7 232 296 242.7 296 256L296 368C296 381.3 306.7 392 320 392C333.3 392 344 381.3 344 368L344 256C344 242.7 333.3 232 320 232zM346.7 448C347.3 438.1 342.4 428.7 333.9 423.5C325.4 418.4 314.7 418.4 306.2 423.5C297.7 428.7 292.8 438.1 293.4 448C292.8 457.9 297.7 467.3 306.2 472.5C314.7 477.6 325.4 477.6 333.9 472.5C342.4 467.3 347.3 457.9 346.7 448z"/></svg>';
const IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

// Caches (module-level like the Ruby class variables)
const iconCache = new Map();
const logoCache = new Map();
let logoInstanceCounter = 0;

/**
 * Resolve a tag argument that may be a variable but should fall back to the
 * literal when it resolves to a non-string (Ruby's icon/logo/language pattern).
 */
function resolveNameArg(ctx, arg) {
  if (!arg) return null;
  const resolved = resolveInput(ctx.lookup, arg, true);
  return typeof resolved === 'string' ? stripQuotes(resolved) : stripQuotes(arg);
}

function readFileIfExists(filePath) {
  if (!filePath) return null;
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// {% uj_icon name %} / {% uj_icon name, "css classes" %}
const ujIcon = {
  block: false,
  render(ctx, markup) {
    const parts = parseArguments(markup);
    const iconName = resolveNameArg(ctx, parts[0]) || '';
    const cssClasses = parts[1] ? resolveInput(ctx.lookup, parts[1], true) : null;

    const iconSvg = loadIcon(ctx, iconName);
    if (!iconSvg) return '';

    const processed = injectSvgAttributes(iconSvg);
    const dataAttr = iconName ? ` data-icon="${iconName}"` : '';

    if (cssClasses) {
      return `<i class="fa ${cssClasses}"${dataAttr}>${processed}</i>`;
    }
    return `<i class="fa"${dataAttr}>${processed}</i>`;
  },
};

function loadIcon(ctx, iconName) {
  const icons = (ctx.options && ctx.options.icons) || {};
  const style = (ctx.site.config.icons && ctx.site.config.icons.style) || icons.style || 'solid';
  const cacheKey = `${icons.fontAwesomeDir || ''}|${style}/${iconName}`;

  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey);

  const svg = tryLoadFontAwesome(icons, iconName, style)
    || tryLoadFlag(icons, iconName)
    || DEFAULT_ICON;

  iconCache.set(cacheKey, svg);
  return svg;
}

function tryLoadFontAwesome(icons, iconName, style) {
  if (!icons.fontAwesomeDir || !iconName) return null;

  const styled = readFileIfExists(path.join(icons.fontAwesomeDir, style, `${iconName}.svg`));
  if (styled) return styled;

  if (style !== 'brands') {
    return readFileIfExists(path.join(icons.fontAwesomeDir, 'brands', `${iconName}.svg`));
  }
  return null;
}

function tryLoadFlag(icons, iconName) {
  if (!icons.flagsDir || !iconName) return null;

  const direct = readFileIfExists(path.join(icons.flagsDir, `${iconName}.svg`));
  if (direct) return direct;

  const countryCode = LANGUAGE_TO_COUNTRY[iconName.toLowerCase()];
  if (!countryCode) return null;
  return readFileIfExists(path.join(icons.flagsDir, `${countryCode}.svg`));
}

/**
 * Inject width/height/fill into the opening <svg> tag when absent.
 */
function injectSvgAttributes(svgContent) {
  if (!svgContent.includes('<svg')) return svgContent;

  return svgContent.replace(/<svg([^>]*)>/, (match, existingAttrs) => {
    const toAdd = [];
    if (!existingAttrs.includes('width=')) toAdd.push('width="1em"');
    if (!existingAttrs.includes('height=')) toAdd.push('height="1em"');
    if (!existingAttrs.includes('fill=')) toAdd.push('fill="currentColor"');

    return toAdd.length ? `<svg${existingAttrs} ${toAdd.join(' ')}>` : match;
  });
}

// {% uj_logo name %} / {% uj_logo name, type, color %} — inline SVG with
// instance-unique ID prefixing so repeated logos don't collide
const ujLogo = {
  block: false,
  render(ctx, markup) {
    const parts = parseArguments(markup);
    const logoName = resolveNameArg(ctx, parts[0]);
    if (!logoName) return '';

    const type = resolveNameArg(ctx, parts[1]) || 'brandmarks';
    const color = resolveNameArg(ctx, parts[2]) || 'original';

    const rawSvg = loadLogo(ctx, logoName, type, color);
    if (!rawSvg) return '';

    logoInstanceCounter++;
    return prefixSvgIds(rawSvg, `${logoName}-${logoInstanceCounter}`);
  },
};

function loadLogo(ctx, logoName, type, color) {
  const logos = (ctx.options && ctx.options.logos) || {};
  const cacheKey = `${logos.dir || ''}|${type}/${color}/${logoName}`;

  if (logoCache.has(cacheKey)) return logoCache.get(cacheKey);

  const svg = (logos.dir && readFileIfExists(path.join(logos.dir, type, color, `${logoName}.svg`)))
    || DEFAULT_ICON;

  logoCache.set(cacheKey, svg);
  return svg;
}

/**
 * Prefix all IDs in an SVG (and their url()/href references) to prevent
 * conflicts when multiple SVGs are inlined on the same page.
 */
function prefixSvgIds(svgContent, prefix) {
  const ids = [...new Set([...svgContent.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]))];
  if (!ids.length) return svgContent;

  let result = svgContent;
  for (const id of ids) {
    const newId = `${prefix}-${id}`;
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    result = result
      .replace(new RegExp(`\\bid=(["'])${escaped}\\1`, 'g'), `id="${newId}"`)
      .replace(new RegExp(`url\\(\\s*#${escaped}\\s*\\)`, 'g'), `url(#${newId})`)
      .replace(new RegExp(`url\\(\\s*["']#${escaped}["']\\s*\\)`, 'g'), `url(#${newId})`)
      .replace(new RegExp(`xlink:href=["']#${escaped}["']`, 'g'), `xlink:href="#${newId}"`)
      .replace(new RegExp(`x:href=["']#${escaped}["']`, 'g'), `href="#${newId}"`)
      .replace(new RegExp(`\\bhref=["']#${escaped}["']`, 'g'), `href="#${newId}"`);
  }
  return result;
}

/**
 * Build the responsive image HTML for a source + options (shared by uj_image
 * and the member/post image-tag properties).
 * @param {string} src
 * @param {object} options - alt/class/style/width/height/max_width/webp/loading
 * @returns {string}
 */
function buildImageHtml(src, options = {}) {
  const isExternal = /^https?:\/\//.test(src);
  if (isExternal) return buildExternalImage(src, options);

  const extension = path.extname(src);
  const srcPath = extension ? src.slice(0, -extension.length) : src;
  const maxWidthRaw = options.max_width || options['max-width'] || false;
  const maxWidth = maxWidthRaw ? String(maxWidthRaw) : false;

  let html = '<picture>\n';
  if (options.webp !== 'false') {
    html += buildWebpSources(srcPath, maxWidth);
  }
  html += buildOriginalSources(srcPath, extension, maxWidth, src);

  const alt = options.alt || '';
  const cssClass = options.class || '';
  const style = options.style || '';
  const width = options.width || '';
  const height = options.height || '';

  html += '<img\n';
  html += `src="${IMAGE_PLACEHOLDER}"\n`;
  html += `data-lazy="@src ${src}"\n`;
  if (cssClass) html += `class="${cssClass}"\n`;
  html += `alt="${alt}"\n`;
  if (style) html += `style="${style}"\n`;
  if (width) html += `width="${width}"\n`;
  if (height) html += `height="${height}"\n`;
  html += '>\n';
  html += '</picture>';

  return html;
}

function buildWebpSources(srcPath, maxWidth) {
  switch (maxWidth) {
    case '320':
      return `<source data-lazy="@srcset ${srcPath}-320px.webp" type="image/webp">\n`;
    case '640':
      return `<source data-lazy="@srcset ${srcPath}-320px.webp" media="(max-width: 320px)" type="image/webp">\n`
        + `<source data-lazy="@srcset ${srcPath}-640px.webp" type="image/webp">\n`;
    case '1024':
      return `<source data-lazy="@srcset ${srcPath}-320px.webp" media="(max-width: 320px)" type="image/webp">\n`
        + `<source data-lazy="@srcset ${srcPath}-640px.webp" media="(max-width: 640px)" type="image/webp">\n`
        + `<source data-lazy="@srcset ${srcPath}-1024px.webp" type="image/webp">\n`;
    default:
      return `<source data-lazy="@srcset ${srcPath}-320px.webp" media="(max-width: 320px)" type="image/webp">\n`
        + `<source data-lazy="@srcset ${srcPath}-640px.webp" media="(max-width: 640px)" type="image/webp">\n`
        + `<source data-lazy="@srcset ${srcPath}-1024px.webp" media="(max-width: 1024px)" type="image/webp">\n`
        + `<source data-lazy="@srcset ${srcPath}.webp" type="image/webp">\n`;
  }
}

function buildOriginalSources(srcPath, extension, maxWidth, src) {
  switch (maxWidth) {
    case '320':
      return `<source data-lazy="@srcset ${srcPath}-320px${extension}">\n`;
    case '640':
      return `<source data-lazy="@srcset ${srcPath}-320px${extension}" media="(max-width: 320px)">\n`
        + `<source data-lazy="@srcset ${srcPath}-640px${extension}">\n`;
    case '1024':
      return `<source data-lazy="@srcset ${srcPath}-320px${extension}" media="(max-width: 320px)">\n`
        + `<source data-lazy="@srcset ${srcPath}-640px${extension}" media="(max-width: 640px)">\n`
        + `<source data-lazy="@srcset ${srcPath}-1024px${extension}">\n`;
    default:
      return `<source data-lazy="@srcset ${srcPath}-320px${extension}" media="(max-width: 320px)">\n`
        + `<source data-lazy="@srcset ${srcPath}-640px${extension}" media="(max-width: 640px)">\n`
        + `<source data-lazy="@srcset ${srcPath}-1024px${extension}" media="(max-width: 1024px)">\n`
        + `<source data-lazy="@srcset ${src}" media="(min-width: 1025px)">\n`;
  }
}

function buildExternalImage(src, options) {
  const alt = options.alt || '';
  const cssClass = options.class || '';
  const style = options.style || '';
  const width = options.width || '';
  const height = options.height || '';
  const loading = options.loading || 'lazy';

  let html = '<img';
  html += ` src="${IMAGE_PLACEHOLDER}"`;
  html += ` data-lazy="@src ${src}"`;
  if (cssClass) html += ` class="${cssClass}"`;
  html += ` alt="${alt}"`;
  html += ` loading="${loading}"`;
  if (style) html += ` style="${style}"`;
  if (width) html += ` width="${width}"`;
  if (height) html += ` height="${height}"`;
  html += '>';

  return html;
}

// {% uj_image "/path.png", alt="...", max_width="640" %}
const ujImage = {
  block: false,
  render(ctx, markup) {
    const args = parseArguments(markup);
    const src = resolveInput(ctx.lookup, args[0], true);
    if (!src) return '';

    const options = parseOptions(args.slice(1), ctx.lookup);
    return buildImageHtml(String(src), options);
  },
};

// {% uj_video "/path.mp4", autoplay="true", ... %}
const ujVideo = {
  block: false,
  render(ctx, markup) {
    const args = parseArguments(markup);
    const src = resolveInput(ctx.lookup, args[0], true);
    if (!src) return '';

    const options = parseOptions(args.slice(1), ctx.lookup);
    return buildVideoHtml(String(src), options);
  },
};

function buildVideoHtml(src, options) {
  const isExternal = /^https?:\/\//.test(src);
  if (isExternal) return buildExternalVideo(src, options);

  const extension = path.extname(src);
  const srcPath = extension ? src.slice(0, -extension.length) : src;
  const maxWidthRaw = options.max_width || options['max-width'] || false;
  const maxWidth = maxWidthRaw ? String(maxWidthRaw) : false;

  let html = '<div class="lazy-loading" data-lazy-load-container>\n';
  html += '<video\n';
  html += videoAttributes(options, '\n');
  html += '>\n';
  html += buildVideoSources(srcPath, extension, maxWidth, src);
  html += 'Your browser does not support the video tag.\n';
  html += '</video>\n';
  html += '</div>';

  return html;
}

/**
 * Shared <video> attribute rendering. `sep` is '\n' for local (multi-line)
 * and '' (leading-space single-line) for external — matching the Ruby output.
 */
function videoAttributes(options, sep) {
  const attr = (text) => (sep === '\n' ? `${text}\n` : ` ${text}`);
  const flagOn = (value) => value && value !== '' && value !== 'false';

  let html = '';
  if (options.class) html += attr(`class="${options.class}"`);
  if (options.style) html += attr(`style="${options.style}"`);
  if (options.width) html += attr(`width="${options.width}"`);
  if (options.height) html += attr(`height="${options.height}"`);
  if (flagOn(options.autoplay)) html += attr('autoplay');
  if (flagOn(options.loop)) html += attr('loop');
  if (flagOn(options.muted)) html += attr('muted');
  if ((options.controls || 'true') !== 'false') html += attr('controls');
  if (flagOn(options.playsinline)) html += attr('playsinline');
  html += attr(`preload="${options.preload || 'metadata'}"`);
  if (options.poster) html += attr(`poster="${options.poster}"`);

  return html;
}

function buildVideoSources(srcPath, extension, maxWidth, src) {
  const mime = getVideoMimeType(extension);
  switch (maxWidth) {
    case '320':
      return `<source data-lazy="@src ${srcPath}-320px${extension}" type="video/${mime}">\n`;
    case '640':
      return `<source data-lazy="@src ${srcPath}-320px${extension}" media="(max-width: 320px)" type="video/${mime}">\n`
        + `<source data-lazy="@src ${srcPath}-640px${extension}" type="video/${mime}">\n`;
    case '1024':
      return `<source data-lazy="@src ${srcPath}-320px${extension}" media="(max-width: 320px)" type="video/${mime}">\n`
        + `<source data-lazy="@src ${srcPath}-640px${extension}" media="(max-width: 640px)" type="video/${mime}">\n`
        + `<source data-lazy="@src ${srcPath}-1024px${extension}" type="video/${mime}">\n`;
    default:
      return `<source data-lazy="@src ${srcPath}-320px${extension}" media="(max-width: 320px)" type="video/${mime}">\n`
        + `<source data-lazy="@src ${srcPath}-640px${extension}" media="(max-width: 640px)" type="video/${mime}">\n`
        + `<source data-lazy="@src ${srcPath}-1024px${extension}" media="(max-width: 1024px)" type="video/${mime}">\n`
        + `<source data-lazy="@src ${src}" media="(min-width: 1025px)" type="video/${mime}">\n`;
  }
}

function buildExternalVideo(src, options) {
  let html = '<div class="lazy-loading" data-lazy-load-container>';
  html += '<video';
  html += videoAttributes(options, '');
  html += '>';

  const mime = getVideoMimeType(path.extname(src));
  html += `<source data-lazy="@src ${src}" type="video/${mime}">`;
  html += 'Your browser does not support the video tag.';
  html += '</video>';
  html += '</div>';

  return html;
}

function getVideoMimeType(extension) {
  switch (String(extension).toLowerCase()) {
    case '.mp4': return 'mp4';
    case '.webm': return 'webm';
    case '.ogg':
    case '.ogv': return 'ogg';
    case '.mov': return 'quicktime';
    case '.avi': return 'x-msvideo';
    default: return 'mp4';
  }
}

module.exports = {
  ujIcon,
  ujLogo,
  ujImage,
  ujVideo,
  buildImageHtml,
  DEFAULT_ICON,
  IMAGE_PLACEHOLDER,
};
