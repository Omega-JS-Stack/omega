/**
 * Site translation — post-build: reads built pages from dist/, translates
 * every text unit through @omega.js/devkit/translate (per-string committed
 * cache in <consumer>/translations/, provider from config), and writes
 * /{lang}/... copies with localized <html lang|dir>, canonical/og tags,
 * rewritten internal links, and hreflang alternates stitched into both the
 * copies and the originals (only the languages actually produced — hreflang
 * never lies; a provider failure skips its page-language pair whole rather
 * than shipping a mixed-language copy). No GitHub-branch cache, no separate
 * credentials: the cache is part of the repo, and the default claude provider
 * rides the local Claude Code install.
 *
 * dist/sitemap.xml is rewritten afterwards (./sitemap.js) so the produced
 * copies are listed with the same hreflang story the pages carry.
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const cheerio = require('cheerio');
const {
  resolveProvider,
  resolveTranslationSettings,
  translateStrings,
  languageName,
  ogLocale,
  isRTL,
  hashKey,
  loadCache,
  saveCache,
  LANGUAGE_NAMES,
} = require('@omega.js/devkit/translate');
const { collectTextNodes } = require('./collect-text-nodes.js');
const { defaultExcludedRoutes } = require('./default-routes.js');
const { updateSitemap } = require('./sitemap.js');
const { readPathPrefixStamp, stripPathPrefix } = require('../path-prefix.js');

// System folders never translated. The framework's default PAGES are derived
// from the defaults tree instead (./default-routes.js) — these are the folders
// whose contents the build generates or the brand fills, so no default page
// declares them.
const SYSTEM_EXCLUDED_FOLDERS = ['admin', 'test', 'team', 'updates', '__/auth'];

/**
 * A built file's route: 'about/index.html' → 'about', 'index.html' → ''.
 * @param {string} relPath - path relative to the output dir
 * @returns {string}
 */
function routeOf(relPath) {
  return relPath
    .replace(/\\/g, '/')
    .replace(/(^|\/)index\.html$/, '')
    .replace(/\.html$/, '')
    .replace(/\/+$/, '');
}

/**
 * Build the route-exclusion test from config + the framework's own sets. Every
 * KNOWN language code is excluded as a folder (not just the configured ones) so
 * copies from a previous run never get re-collected as source pages.
 * `translation.exclude` is for BRAND pages only (#605): the framework's default
 * pages exclude themselves, derived from the defaults tree, and each one guards
 * its subtree too (nothing under /app or /payment is marketing copy).
 * @param {object} config - resolved config (translation.exclude, socials)
 * @returns {Function} (route: string) → boolean
 */
function buildExclusionTest(config) {
  const userExcludes = (config.translation?.exclude || []).map((entry) => String(entry).replace(/^\/+|\/+$/g, ''));
  const frameworkRoutes = [...defaultExcludedRoutes()];

  const files = new Set([
    ...frameworkRoutes,
    ...Object.keys(config.socials || {}),
    ...userExcludes,
  ]);

  const folders = [...SYSTEM_EXCLUDED_FOLDERS, ...frameworkRoutes, ...Object.keys(LANGUAGE_NAMES), ...userExcludes];

  return (route) => {
    if (files.has(route)) {
      return true;
    }

    return folders.some((folder) => route === folder || route.startsWith(`${folder}/`));
  };
}

/**
 * Rewrite same-site links on a translated page to their /{lang}/ versions.
 * On a MOUNTED site (#355) the hrefs already carry the base path: the route
 * is read underneath it, and the language segment goes back on AFTER it.
 * @param {object} $ - cheerio root
 * @param {string} lang - target language
 * @param {string} baseUrl - site origin
 * @param {Function} isExcluded - route exclusion test
 * @param {string} pathPrefix - the base path the site is served under ('' at the domain root)
 */
function rewriteLinks($, lang, baseUrl, isExcluded, pathPrefix) {
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');

    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return;
    }

    try {
      const url = new URL(href, baseUrl);

      if (url.origin !== new URL(baseUrl).origin) {
        return;
      }

      const sitePath = stripPathPrefix(url.pathname, pathPrefix);
      const route = sitePath.replace(/^\/+|\/+$/g, '');
      if (isExcluded(route)) {
        return;
      }

      url.pathname = `${pathPrefix}/${lang}${sitePath}`;

      // Preserve relative-style hrefs as root-relative paths
      $(el).attr('href', href.startsWith('http') ? url.toString() : `${url.pathname}${url.search}${url.hash}`);
    } catch (e) {
      // Unparseable href — leave it alone
    }
  });
}

/**
 * Insert hreflang + og:locale:alternate tags for the given languages
 * (idempotent — existing tags are kept, missing ones added).
 * @param {object} $ - cheerio root
 * @param {string[]} languages - translated languages for THIS page
 * @param {string} defaultLang - source language code
 * @param {string} route - the page's route
 * @param {string} baseUrl - site origin (on a MOUNTED site brand.url carries
 *   the base path already — absolute URLs are never prefixed a second time)
 * @returns {boolean} whether anything was inserted
 */
function insertAlternates($, languages, defaultLang, route, baseUrl) {
  const urlFor = (lang) => `${baseUrl}/${lang}${route ? `/${route}` : ''}`;
  let changed = false;

  const anchor = $('head link[rel="alternate"][hreflang]').last();
  for (const lang of languages) {
    if ($(`head link[rel="alternate"][hreflang="${lang}"]`).length) {
      continue;
    }

    const tag = `<link rel="alternate" href="${urlFor(lang)}" hreflang="${lang}"/>`;
    if (anchor.length) {
      anchor.after(`\n${tag}`);
    } else {
      $('head').append(`\n${tag}`);
    }
    changed = true;
  }

  const ogLocaleTag = $('head meta[property="og:locale"]');
  if (ogLocaleTag.length) {
    const currentLocale = ogLocaleTag.attr('content');
    for (const lang of [defaultLang, ...languages]) {
      const locale = ogLocale(lang);
      if (locale === currentLocale || $(`head meta[property="og:locale:alternate"][content="${locale}"]`).length) {
        continue;
      }

      ogLocaleTag.after(`\n<meta property="og:locale:alternate" content="${locale}"/>`);
      changed = true;
    }
  }

  return changed;
}

/**
 * Translate the built site into every configured language.
 * @param {object} options
 * @param {string} options.root - consumer project root (translations/ cache home)
 * @param {string} options.outDir - built site dir (dist)
 * @param {object} options.config - resolved config (translation, brand, socials, url)
 * @param {object} [options.logger] - devkit logger (silent when omitted)
 * @param {Function} [options.send] - provider send override (tests)
 * @param {string} [options.only] - translate only the page whose route/relPath matches
 * @param {boolean} [options.cachedOnly] - never call the provider: pages with
 *   any cold (uncached) string are skipped whole (listed in stats.skippedCold)
 *   instead of shipping mixed-language copies — `omega build` runs this way;
 *   explicit `omega translate` owns live-LLM translation (friction #24)
 * @returns {Promise<object>} stats: { skipped?, pages, languages, newStrings,
 *   cachedStrings, failures (page-language pairs skipped whole), usage, skippedCold }
 */
async function translateSite(options) {
  const { root, outDir, config } = options;
  const logger = options.logger || { log: () => {}, warn: () => {}, error: () => {} };

  const settings = resolveTranslationSettings(config);
  if (!settings.enabled) {
    return { skipped: true };
  }

  const provider = options.send
    ? { name: 'custom', model: '', send: options.send }
    : resolveProvider({ provider: settings.provider, model: settings.model });

  const baseUrl = (config.url || config.brand?.url || 'http://localhost').replace(/\/+$/, '');
  const brand = config.brand?.name;
  const cacheRoot = path.join(root, 'translations');
  const isExcluded = buildExclusionTest(config);

  // Collect translatable pages
  const allFiles = jetpack.find(outDir, { matching: '**/*.html' })
    .map((file) => path.relative(outDir, file))
    .filter((relPath) => !isExcluded(routeOf(relPath)));

  const files = options.only
    ? allFiles.filter((relPath) => relPath === options.only || routeOf(relPath) === options.only.replace(/^\/+|\/+$/g, ''))
    : allFiles;

  // Base path (#355): the build stamped the mount point on every page it
  // emitted, so the pass reads it off the site itself — no caller plumbing,
  // and `omega translate` run on its own gets it too. dist IS the mount root,
  // so only the URLs carry it; the copies' file paths never do (#359).
  const pathPrefix = files.length ? readPathPrefixStamp(jetpack.read(path.join(outDir, files[0]))) : '';

  logger.log(`Translating ${files.length} pages into ${settings.languages.length} language(s): ${settings.languages.join(', ')} (provider: ${provider.name}${provider.model ? `/${provider.model}` : ''})`);

  const stats = { pages: 0, languages: settings.languages, newStrings: 0, cachedStrings: 0, failures: [], usage: { input: 0, output: 0 }, skippedCold: [] };
  const translatedRoutes = new Map(); // relPath → langs successfully produced
  const total = files.length * settings.languages.length;
  let done = 0;

  for (const relPath of files) {
    const route = routeOf(relPath);
    const sourceHtml = jetpack.read(path.join(outDir, relPath));
    const namespace = `pages/${route || 'home'}`;

    // Source strings (collected once per page from a throwaway DOM)
    const strings = collectTextNodes(cheerio.load(sourceHtml)).map((n) => n.text);
    const producedLangs = [];
    const copies = [];

    for (const lang of settings.languages) {
      done++;
      const logTag = `[${done}/${total}] [${lang}] /${route}`;

      // Cache lookup per string
      const cache = loadCache(cacheRoot, lang, namespace);
      const translated = new Array(strings.length);
      const missIndices = [];

      strings.forEach((text, i) => {
        const hit = cache[hashKey(text)];
        if (hit !== undefined) {
          translated[i] = hit;
          stats.cachedStrings++;
        } else {
          missIndices.push(i);
        }
      });

      // Cold strings under cachedOnly: skip the whole page-language pair —
      // a partially translated page is worse than none, and hreflang stays
      // honest because only produced copies get alternates
      if (options.cachedOnly && missIndices.length) {
        stats.skippedCold.push(`${lang} /${route}`);
        logger.log(`⊘ ${logTag} — ${missIndices.length} cold string(s), skipped`);
        continue;
      }

      // Translate the misses
      if (missIndices.length) {
        try {
          const { result, usage } = await translateStrings({
            strings: missIndices.map((i) => strings[i]),
            language: lang,
            languageName: languageName(lang),
            brand,
            send: provider.send,
          });

          missIndices.forEach((origIndex, j) => {
            translated[origIndex] = result[j];
            cache[hashKey(strings[origIndex])] = result[j];
          });

          stats.newStrings += missIndices.length;
          stats.usage.input += usage.input;
          stats.usage.output += usage.output;
          logger.log(`✓ ${logTag} — ${missIndices.length} new + ${strings.length - missIndices.length} cached`);
        } catch (e) {
          // Skip the whole page-language pair, exactly like a cold cache
          // under cachedOnly: a half-translated copy is worse than none, and
          // it would ship silently behind full language chrome
          stats.failures.push(`${lang} /${route}: ${e.message}`);
          logger.warn(`✗ ${logTag} — ${e.message} — page skipped (no ${lang} copy)`);
          continue;
        }
      } else {
        logger.log(`✓ ${logTag} — all ${strings.length} strings cached`);
      }

      saveCache(cacheRoot, lang, namespace, cache, strings);

      // Build the translated page on a fresh DOM
      const $ = cheerio.load(sourceHtml);
      collectTextNodes($).forEach((n, i) => {
        const value = translated[i];
        if (value === undefined) {
          return;
        }

        if (n.type === 'data') {
          n.reference.data = value;
        } else if (n.type === 'text') {
          n.node.text(value);
        } else if (n.type === 'attr') {
          n.node.attr(n.attr, value);
        }
      });

      // Localize the document chrome
      const pageUrl = `${baseUrl}/${lang}${route ? `/${route}` : ''}`;
      $('html').attr('lang', lang);
      $('html').attr('dir', isRTL(lang) ? 'rtl' : 'ltr');
      $('link[rel="canonical"]').attr('href', pageUrl);
      $('meta[property="og:url"]').attr('content', pageUrl);
      $('meta[property="og:locale"]').attr('content', ogLocale(lang));

      rewriteLinks($, lang, baseUrl, isExcluded, pathPrefix);

      // Canonical URLs are extensionless (about.html ↔ /about), so the
      // language HOME must land as <lang>.html for /es to resolve as a FILE.
      // An es/index.html forces GitHub Pages' directory redirect (/es →
      // /es/), which fights the zone's strip-trailing-slash rule into a
      // 301 loop (live find, launch night 2026-07-19).
      const targetRel = relPath === 'index.html' ? `${lang}.html` : path.join(lang, relPath);
      copies.push({ targetRel, $ });
      producedLangs.push(lang);
    }

    // Copies land after the page's whole language pass so their alternates
    // name only the languages actually produced — a skipped pair (cold cache
    // or provider failure) is never advertised (hreflang never lies)
    for (const { targetRel, $ } of copies) {
      insertAlternates($, producedLangs, settings.default, route, baseUrl);
      jetpack.write(path.join(outDir, targetRel), $.html());
    }

    if (producedLangs.length) {
      translatedRoutes.set(relPath, producedLangs);
      stats.pages++;
    }
  }

  // Stitch alternates into the ORIGINALS — only for pages actually translated
  for (const [relPath, langs] of translatedRoutes) {
    const file = path.join(outDir, relPath);
    const $ = cheerio.load(jetpack.read(file));

    if (insertAlternates($, langs, settings.default, routeOf(relPath), baseUrl)) {
      jetpack.write(file, $.html());
    }
  }

  // The sitemap tells the same story: the produced copies join it with their
  // hreflang alternates, and a skipped pair is listed nowhere
  const sitemapUrls = updateSitemap({
    outDir,
    baseUrl,
    defaultLang: settings.default,
    produced: new Map([...translatedRoutes].map(([relPath, langs]) => [routeOf(relPath), langs])),
    logger,
  });

  if (sitemapUrls !== null) {
    stats.sitemapUrls = sitemapUrls;
    logger.log(`Sitemap: ${sitemapUrls} translated URL(s) with hreflang alternates`);
  }

  return stats;
}

module.exports = { translateSite, routeOf, collectTextNodes };
