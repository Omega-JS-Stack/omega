/**
 * Post-translation sitemap rewrite. The build emits dist/sitemap.xml from the
 * source-language collection, before translation runs; this stitches the
 * produced copies in: one <url> per produced page-language pair, and every
 * entry of a translated set (source + copies) carrying the full xhtml:link
 * hreflang alternate list with x-default at the source language — so the
 * sitemap and the page-level hreflang tell the same story.
 *
 * The language-prefixed entries are OWNED here: each run drops them all and
 * re-emits only what it produced, so a skipped or failed page-language pair
 * appears nowhere (the sitemap never lies either).
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const cheerio = require('cheerio');
const { LANGUAGE_NAMES } = require('@omega.js/devkit/translate');

// cheerio's .text() decodes entities, so every value we interpolate back into
// XML gets re-escaped here (a loc like ?a=1&b=2 must not emit a bare &)
function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Rewrite dist/sitemap.xml to carry the produced translated URLs.
 * @param {object} options
 * @param {string} options.outDir - built site dir (dist)
 * @param {string} options.baseUrl - site origin, no trailing slash
 * @param {string} options.defaultLang - source language code
 * @param {Map<string, string[]>} options.produced - route → languages produced
 * @param {object} [options.logger] - devkit logger (silent when omitted)
 * @returns {number|null} translated entries written, or null when there is no sitemap
 */
function updateSitemap(options) {
  const { outDir, baseUrl, defaultLang, produced } = options;
  const logger = options.logger || { warn: () => {} };
  const file = path.join(outDir, 'sitemap.xml');
  const xml = jetpack.read(file);

  if (!xml) {
    return null;
  }

  const openIndex = xml.search(/[ \t]*<url>/);
  const closeIndex = xml.lastIndexOf('</url>');
  if (openIndex === -1 || closeIndex === -1) {
    return null;
  }

  const $ = cheerio.load(xml, { xmlMode: true });
  const languageCodes = new Set(Object.keys(LANGUAGE_NAMES));
  const entries = [];
  const dropped = [];
  let translated = 0;

  $('urlset > url').each((_, el) => {
    const node = $(el);
    const loc = node.children('loc').text().trim();

    // Only our own emissions are rewritable; anything else passes through
    if (!loc.startsWith(baseUrl)) {
      entries.push({ loc, xml: $.xml(node) });
      return;
    }

    const route = loc.slice(baseUrl.length).replace(/^\/+|\/+$/g, '');

    // Language-prefixed entries belong to this function — drop and re-emit
    if (languageCodes.has(route.split('/')[0])) {
      dropped.push(loc);
      return;
    }

    node.children('xhtml\\:link').remove();
    const langs = produced.get(route) || [];
    const alternates = langs.length
      ? [[defaultLang, loc], ['x-default', loc], ...langs.map((lang) => [lang, `${baseUrl}/${lang}${route ? `/${route}` : ''}`])]
      : [];
    const links = alternates.map(([lang, href]) => `\n    <xhtml:link rel="alternate" hreflang="${lang}" href="${escapeXml(href)}"/>`).join('');
    const inner = `${node.html().replace(/\s+$/, '')}${links}\n  `;

    entries.push({ loc, xml: `<url>${inner}</url>` });

    for (const [, href] of alternates.slice(2)) {
      entries.push({ loc: href, xml: `<url>${inner.replace(/<loc>[^<]*<\/loc>/, `<loc>${escapeXml(href)}</loc>`)}</url>` });
      translated++;
    }
  });

  // A dropped entry we did not re-emit is either stale (fine, say so) or a REAL
  // page living under a language-code path — either way the removal is not silent
  const reEmitted = new Set(entries.map((entry) => entry.loc));
  const lost = dropped.filter((loc) => !reEmitted.has(loc));
  if (lost.length) {
    logger.warn(`sitemap: dropped ${lost.length} language-prefixed entr${lost.length === 1 ? 'y' : 'ies'} not produced this run (stale copies — or real pages under a language-code path): ${lost.join(', ')}`);
  }

  // Byte order, as the source template emits it (cp227)
  entries.sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));

  const header = xml.slice(0, openIndex);
  const footer = xml.slice(closeIndex + '</url>'.length);
  jetpack.write(file, `${header}${entries.map((entry) => `  ${entry.xml}`).join('\n')}${footer}`);

  return translated;
}

module.exports = { updateSitemap };
