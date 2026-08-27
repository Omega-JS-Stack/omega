/**
 * content.js — the content/metadata omega_ tags.
 *
 * Ported from jekyll-uj-powertools lib/tags/{readtime,fake_comments,external,
 * social,language,translation_url}.rb. Engine-neutral renderers (see
 * conditionals.js for the ctx contract).
 */

// Libraries
const { resolveInput, parseArguments } = require('../variable-resolver.js');
const { LANGUAGES } = require('../data/languages.js');
const { SOCIAL_URLS } = require('../data/social-urls.js');

/**
 * Strip HTML (script/style blocks first, then tags) and collapse whitespace.
 * @param {string} content
 * @returns {string}
 */
function stripHtml(content) {
  return String(content)
    .replace(/<script[\s\S]*?<\/script>/gm, '')
    .replace(/<style[\s\S]*?<\/style>/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve tag content: no argument = current page content, else resolve input.
 */
function resolveContent(ctx, markup) {
  if (!markup) {
    return ctx.page ? ctx.page.content : null;
  }
  return resolveInput(ctx.lookup, markup);
}

// {% omega_readtime %} / {% omega_readtime page.description %} — minutes at 269 wpm, min 1
const omegaReadtime = {
  block: false,
  render(ctx, markup) {
    const content = resolveContent(ctx, markup.trim());
    if (!content) return '1';

    const words = stripHtml(content).split(/\s+/).length;
    return String(Math.max(1, Math.ceil(words / 269)));
  },
};

// {% omega_fake_comments %} — deterministic pseudo comment count (words % 13)
const omegaFakeComments = {
  block: false,
  render(ctx, markup) {
    const content = resolveContent(ctx, markup.trim());
    if (!content) return '0';

    const words = stripHtml(content).split(/\s+/).length;
    return String(words % 13);
  },
};

// {% omega_external path %} — absolutize a path against site.url (pass through full URLs)
const omegaExternal = {
  block: false,
  render(ctx, markup) {
    let path = resolveInput(ctx.lookup, markup.trim());
    if (!path) return '';

    path = String(path);
    if (/^https?:\/\//.test(path) || /^\/\//.test(path)) return path;

    const siteUrl = String(ctx.site.config.url || '').replace(/\/$/, '');
    if (!path.startsWith('/')) path = `/${path}`;
    return `${siteUrl}${path}`;
  },
};

// {% omega_social platform %} — profile URL from resolved.config.socials.{platform}
const omegaSocial = {
  block: false,
  render(ctx, markup) {
    const platform = resolveInput(ctx.lookup, markup.trim()) || markup.trim();
    if (!ctx.page) return '';

    // Two shapes of the same scope: legacy UJM injected `resolved` INTO the
    // page; @omega.js/web's data cascade puts it beside `page` (its migrate
    // rule 1: `page.resolved.` → `resolved.`). Config keys live under
    // `resolved.config` since #607 — `socials` is one of them.
    const resolved = ctx.page.resolved || ctx.lookup('resolved');
    const socials = resolved && resolved.config && resolved.config.socials;
    const entry = socials && socials[platform];
    // An entry is a handle, or { handle, redirect } when the shortlink goes
    // somewhere other than the profile (#429) — sameAs reads the PROFILE.
    const handle = entry && typeof entry === 'object' ? entry.handle : entry;
    if (!handle) return '';

    const pattern = SOCIAL_URLS[platform];
    if (!pattern) return '';

    return pattern.replace('%s', handle);
  },
};

// {% omega_language "es" %} / {% omega_language code, "native" %} — language name lookup
const omegaLanguage = {
  block: false,
  render(ctx, markup) {
    const parts = parseArguments(markup);

    let isoCode = parts[0] || '';
    const resolved = resolveInput(ctx.lookup, isoCode, true);
    isoCode = typeof resolved === 'string'
      ? resolved.replace(/^['"]|['"]$/g, '')
      : isoCode.replace(/^['"]|['"]$/g, '');

    const outputType = String(resolveInput(ctx.lookup, parts[1], true) || 'english').toLowerCase();
    isoCode = isoCode.toLowerCase();

    const language = LANGUAGES[isoCode];
    if (!language) return isoCode;

    return outputType === 'native' ? language[1] : language[0];
  },
};

// {% omega_translation_url lang, page.url %} — language-prefixed URL honoring
// site.translation { default, languages, exclude }
const omegaTranslationUrl = {
  block: false,
  render(ctx, markup) {
    const parts = parseArguments(markup);
    if (parts.length === 0 || !parts[0]) return '/';

    let languageCode = resolveInput(ctx.lookup, parts[0]);
    const urlPath = resolveInput(ctx.lookup, parts[1]) || '/';

    const translation = ctx.site.config.translation || {};
    const defaultLanguage = translation.default || 'en';
    const availableLanguages = translation.languages || [defaultLanguage];

    if (!availableLanguages.includes(languageCode)) {
      languageCode = defaultLanguage;
    }

    const normalizedPath = normalizePath(urlPath);

    const excludes = translation.exclude || [];
    if (pageExcluded(normalizedPath, excludes)) {
      return normalizedPath === '' ? '/' : `/${normalizedPath}`;
    }

    if (languageCode === defaultLanguage) {
      return normalizedPath === '' ? '/' : `/${normalizedPath}`;
    }
    return normalizedPath === '' ? `/${languageCode}` : `/${languageCode}/${normalizedPath}`;
  },
};

function normalizePath(path) {
  if (!path) return '';

  let clean = String(path).startsWith('/') ? String(path).slice(1) : String(path);
  if (!clean) return '';

  clean = clean.replace(/^blog\/index\.html$/, 'blog');
  clean = clean.replace(/^blog\/page\/(\d+)\.html$/, 'blog/page/$1');
  return clean;
}

function pageExcluded(normalizedPath, excludes) {
  if (!excludes.length || !normalizedPath) return false;
  return excludes.some((exclude) => normalizedPath === exclude || normalizedPath.startsWith(`${exclude}/`));
}

module.exports = { omegaReadtime, omegaFakeComments, omegaExternal, omegaSocial, omegaLanguage, omegaTranslationUrl, stripHtml };
