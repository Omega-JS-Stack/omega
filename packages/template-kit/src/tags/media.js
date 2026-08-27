/**
 * media.js — the media omega_ tags (icon, logo, image, video).
 *
 * Ported from jekyll-uj-powertools lib/tags/{icon,logo,image,video}.rb.
 * Icon/logo SVG loading is directory-injectable via the adapter options
 * (`options.icons.fontAwesomeDirs` — an ordered chain of icon roots, each
 * holding `{solid,regular,brands}/` subdirs, earlier dirs win;
 * `options.icons.aliasFile` — fontawesome-free's icon-families.json for
 * alias resolution; `options.icons.flagsDir` / `options.logos.dir`) — no
 * hardcoded node_modules path like the Ruby had. Icon semantics (candidate
 * order, root attributes, aliases) live in @omega.js/client's icon-core
 * (C4 cp108), shared with desktop's runtime icon server. Missing icons
 * fall back to the same default warning-triangle SVG with a warn-once.
 */

// Libraries
const fs = require('fs');
const path = require('path');
const { injectSvgAttributes, candidateRelPaths, buildAliasMap } = require('@omega.js/client/modules/icon-core.js');
const { resolveInput, parseArguments, parseOptions, stripQuotes } = require('../variable-resolver.js');
const { LANGUAGE_TO_COUNTRY } = require('../data/language-flags.js');

// Constants (verbatim from the Ruby port)
const DEFAULT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><!--!Font Awesome Free v7.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.--><path d="M320 64C334.7 64 348.2 72.1 355.2 85L571.2 485C577.9 497.4 577.6 512.4 570.4 524.5C563.2 536.6 550.1 544 536 544L104 544C89.9 544 76.9 536.6 69.6 524.5C62.3 512.4 62.1 497.4 68.8 485L284.8 85C291.8 72.1 305.3 64 320 64zM320 232C306.7 232 296 242.7 296 256L296 368C296 381.3 306.7 392 320 392C333.3 392 344 381.3 344 368L344 256C344 242.7 333.3 232 320 232zM346.7 448C347.3 438.1 342.4 428.7 333.9 423.5C325.4 418.4 314.7 418.4 306.2 423.5C297.7 428.7 292.8 438.1 293.4 448C292.8 457.9 297.7 467.3 306.2 472.5C314.7 477.6 325.4 477.6 333.9 472.5C342.4 467.3 347.3 457.9 346.7 448z"/></svg>';
const IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

// Caches (module-level like the Ruby class variables)
const iconCache = new Map();
const logoCache = new Map();
const aliasMaps = new Map(); // aliasFile path → Map(alias → canonical)
const warnedIcons = new Set(); // names already warned about (warn-once)
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

// Attribute-position escaping for caller-supplied strings — frontmatter can
// legitimately carry quotes (e.g. a post title used as the default alt), and
// an unescaped quote breaks out of the attribute.
function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function readFileIfExists(filePath) {
  if (!filePath) return null;
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// {% omega_icon name %} / {% omega_icon name, "css classes" %}
//                       / {% omega_icon name, "css classes", label="Meaning" %}
//
// The WRAPPER carries the accessibility answer (#538). Icons are decorative
// almost everywhere they appear — beside visible text in buttons, tiles and
// facts — so the default emit is `aria-hidden="true"`: hidden from the a11y
// tree by declaration instead of by the convention that screen readers skip
// text-free SVGs. The rare icon that CARRIES meaning says so with `label=`,
// and gets `role="img"` + `aria-label` instead of the hidden stamp.
const omegaIcon = {
  block: false,
  render(ctx, markup) {
    const parts = parseArguments(markup);
    const iconName = resolveNameArg(ctx, parts[0]) || '';
    // The css classes stay POSITIONAL; anything key=value is an option, so
    // `{% omega_icon "star", label="Featured" %}` never reads as a class list.
    const classArg = parts[1] && !parts[1].includes('=') ? parts[1] : null;
    const cssClasses = classArg ? resolveInput(ctx.lookup, classArg, true) : null;
    const label = parseOptions(parts.slice(1), ctx.lookup).label;

    const iconSvg = loadIcon(ctx, iconName);
    if (!iconSvg) return '';

    const processed = injectSvgAttributes(iconSvg);
    const dataAttr = iconName ? ` data-icon="${escapeAttr(iconName)}"` : '';
    const a11yAttrs = label
      ? ` role="img" aria-label="${escapeAttr(label)}"`
      : ' aria-hidden="true"';

    if (cssClasses) {
      return `<i class="fa ${escapeAttr(cssClasses)}"${dataAttr}${a11yAttrs}>${processed}</i>`;
    }
    return `<i class="fa"${dataAttr}${a11yAttrs}>${processed}</i>`;
  },
};

function loadIcon(ctx, iconName) {
  const icons = (ctx.options && ctx.options.icons) || {};
  const dirs = icons.fontAwesomeDirs || [];
  const style = (ctx.site.config.icons && ctx.site.config.icons.style) || icons.style || 'solid';
  const cacheKey = `${dirs.join('|')}|${style}/${iconName}`;

  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey);

  const svg = tryLoadFontAwesome(icons, iconName, style)
    || tryLoadFlag(icons, iconName)
    || defaultIconWithWarning(iconName, dirs);

  iconCache.set(cacheKey, svg);
  return svg;
}

function tryLoadFontAwesome(icons, iconName, style) {
  const dirs = icons.fontAwesomeDirs || [];
  if (!dirs.length || !iconName) return null;

  const alias = aliasFor(icons.aliasFile, iconName);
  const names = alias ? [iconName, alias] : [iconName];

  for (const dir of dirs) {
    for (const name of names) {
      for (const rel of candidateRelPaths(name, style)) {
        const svg = readFileIfExists(path.join(dir, rel));
        if (svg) return svg;
      }
    }
  }
  return null;
}

/** Alias slug → canonical slug from the configured metadata file (cached). */
function aliasFor(aliasFile, iconName) {
  if (!aliasFile) return null;

  if (!aliasMaps.has(aliasFile)) {
    let map = new Map();
    const raw = readFileIfExists(aliasFile);
    if (raw) {
      try {
        map = buildAliasMap(JSON.parse(raw));
      } catch {
        // Unparseable metadata — resolve without aliases.
      }
    }
    aliasMaps.set(aliasFile, map);
  }
  return aliasMaps.get(aliasFile).get(iconName) || null;
}

/** The default warning-triangle, with a once-per-name build warning. */
function defaultIconWithWarning(iconName, dirs) {
  if (iconName && dirs.length && !warnedIcons.has(iconName)) {
    warnedIcons.add(iconName);
    console.warn(`[@omega.js/template-kit:media] omega_icon: no SVG found for "${iconName}" — rendering the default icon`);
  }
  return tagMissing(DEFAULT_ICON, iconName);
}

/**
 * Stamp the failed slug onto the fallback SVG so the browser can see it:
 * the dev-only icon audit (web core/js/core/dev-icon-audit.js) scans
 * [data-omega-icon-missing] and console.errors every miss.
 */
function tagMissing(svg, name) {
  const safe = String(name || 'unknown').replace(/["<>&]/g, '');
  return svg.replace('<svg ', `<svg data-omega-icon-missing="${safe}" `);
}

function tryLoadFlag(icons, iconName) {
  if (!icons.flagsDir || !iconName) return null;

  const direct = readFileIfExists(path.join(icons.flagsDir, `${iconName}.svg`));
  if (direct) return normalizeFlagSvg(direct);

  const countryCode = LANGUAGE_TO_COUNTRY[iconName.toLowerCase()];
  if (!countryCode) return null;
  const mapped = readFileIfExists(path.join(icons.flagsDir, `${countryCode}.svg`));
  return mapped ? normalizeFlagSvg(mapped) : null;
}

/**
 * The flag set carries hardcoded width/height="512" on the root — strip
 * them so injectSvgAttributes' standard 1em inline-icon sizing applies
 * (FA sources never carry dimensions; flags are the exception).
 * @param {string} svg
 * @returns {string}
 */
function normalizeFlagSvg(svg) {
  return svg.replace(/<svg([^>]*)>/, (match, attrs) => `<svg${attrs.replace(/\s(?:width|height)="[^"]*"/g, '')}>`);
}

// {% omega_logo name %} / {% omega_logo name, type, color %} — inline SVG with
// instance-unique ID prefixing so repeated logos don't collide
const omegaLogo = {
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

  let svg = logos.dir && readFileIfExists(path.join(logos.dir, type, color, `${logoName}.svg`));
  if (!svg) {
    if (!warnedIcons.has(`logo:${logoName}`)) {
      warnedIcons.add(`logo:${logoName}`);
      console.warn(`[@omega.js/template-kit:media] omega_logo: no SVG found for "${type}/${color}/${logoName}" — rendering the default icon`);
    }
    svg = tagMissing(DEFAULT_ICON, `logo:${logoName}`);
  }

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
 * Build the responsive image HTML for a source + options (shared by omega_image,
 * the member/post image-tag properties, and @omega.js/web's markdown image
 * renderer — one image-markup SSOT).
 * @param {string} src
 * @param {object} options - alt/title/class/style/width/height/max_width/webp/loading
 * @returns {string}
 */
function buildImageHtml(src, options = {}) {
  const isExternal = /^https?:\/\//.test(src);
  if (isExternal) return buildExternalImage(src, options);

  const rawExtension = path.extname(src);
  // src is caller-supplied like the options — escape once at derivation;
  // every interpolation below is attribute-position
  const srcPath = escapeAttr(rawExtension ? src.slice(0, -rawExtension.length) : src);
  const extension = escapeAttr(rawExtension);
  src = escapeAttr(src);
  const maxWidthRaw = options.max_width || options['max-width'] || false;
  const maxWidth = maxWidthRaw ? String(maxWidthRaw) : false;

  let html = '<picture>\n';
  if (options.webp !== 'false' && options.webp !== false) {
    html += buildWebpSources(srcPath, maxWidth);
  }
  html += buildOriginalSources(srcPath, extension, maxWidth, src);

  const alt = escapeAttr(options.alt || '');
  const title = escapeAttr(options.title || '');
  const cssClass = escapeAttr(options.class || '');
  const style = escapeAttr(options.style || '');
  const width = escapeAttr(options.width || '');
  const height = escapeAttr(options.height || '');

  html += '<img\n';
  html += `src="${IMAGE_PLACEHOLDER}"\n`;
  html += `data-lazy="@src ${src}"\n`;
  if (cssClass) html += `class="${cssClass}"\n`;
  html += `alt="${alt}"\n`;
  if (title) html += `title="${title}"\n`;
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
  src = escapeAttr(src);
  const alt = escapeAttr(options.alt || '');
  const title = escapeAttr(options.title || '');
  const cssClass = escapeAttr(options.class || '');
  const style = escapeAttr(options.style || '');
  const width = escapeAttr(options.width || '');
  const height = escapeAttr(options.height || '');
  const loading = escapeAttr(options.loading || 'lazy');

  let html = '<img';
  html += ` src="${IMAGE_PLACEHOLDER}"`;
  html += ` data-lazy="@src ${src}"`;
  if (cssClass) html += ` class="${cssClass}"`;
  html += ` alt="${alt}"`;
  if (title) html += ` title="${title}"`;
  html += ` loading="${loading}"`;
  if (style) html += ` style="${style}"`;
  if (width) html += ` width="${width}"`;
  if (height) html += ` height="${height}"`;
  html += '>';

  return html;
}

// {% omega_image "/path.png", alt="...", max_width="640" %}
const omegaImage = {
  block: false,
  render(ctx, markup) {
    const args = parseArguments(markup);
    const src = resolveInput(ctx.lookup, args[0], true);
    if (!src) return '';

    const options = parseOptions(args.slice(1), ctx.lookup);
    return buildImageHtml(String(src), options);
  },
};

// {% omega_video "/path.mp4", autoplay="true", ... %}
const omegaVideo = {
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

  const rawExtension = path.extname(src);
  // Same attribute-position escaping at derivation as buildImageHtml
  const srcPath = escapeAttr(rawExtension ? src.slice(0, -rawExtension.length) : src);
  const extension = escapeAttr(rawExtension);
  src = escapeAttr(src);
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
  if (options.class) html += attr(`class="${escapeAttr(options.class)}"`);
  if (options.style) html += attr(`style="${escapeAttr(options.style)}"`);
  if (options.width) html += attr(`width="${escapeAttr(options.width)}"`);
  if (options.height) html += attr(`height="${escapeAttr(options.height)}"`);
  if (flagOn(options.autoplay)) html += attr('autoplay');
  if (flagOn(options.loop)) html += attr('loop');
  if (flagOn(options.muted)) html += attr('muted');
  // controls defaults ON; bare `controls=false` now resolves to boolean false
  if (options.controls !== 'false' && options.controls !== false) html += attr('controls');
  if (flagOn(options.playsinline)) html += attr('playsinline');
  html += attr(`preload="${escapeAttr(options.preload || 'metadata')}"`);
  if (options.poster) html += attr(`poster="${escapeAttr(options.poster)}"`);

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
  html += `<source data-lazy="@src ${escapeAttr(src)}" type="video/${mime}">`;
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
  omegaIcon,
  omegaLogo,
  omegaImage,
  omegaVideo,
  buildImageHtml,
  buildExternalImage,
  DEFAULT_ICON,
  IMAGE_PLACEHOLDER,
};
