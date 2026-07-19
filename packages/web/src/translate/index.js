/**
 * Site translation — post-build: reads built pages from dist/, translates
 * every text unit through @omega.js/devkit/translate (per-string committed
 * cache in <consumer>/translations/, provider from config), and writes
 * /{lang}/... copies with localized <html lang|dir>, canonical/og tags,
 * rewritten internal links, and hreflang alternates stitched into both the
 * copies and the originals (only for pages actually translated — hreflang
 * never lies). No GitHub-branch cache, no separate credentials: the cache is
 * part of the repo, and the default claude provider rides the local Claude
 * Code install.
 *
 * Sitemap alternates ride whenever @omega.js/web grows a sitemap generator —
 * dist/ carries none today.
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const cheerio = require('cheerio');
const {
  resolveProvider,
  resolveTranslationSettings,
  translateStrings,
  languageName,
  isRTL,
  hashKey,
  loadCache,
  saveCache,
  LANGUAGE_NAMES,
} = require('@omega.js/devkit/translate');
const { collectTextNodes } = require('./collect-text-nodes.js');

// System routes never translated (auth flows, transactional + legal pages)
const SYSTEM_EXCLUDED_ROUTES = [
  'oauth2',
  'authentication-token',
  'authentication-success',
  'authentication-required',
  'checkout',
  'checkout/confirmation',
  'submission/confirmation',
  'terms',
  'privacy',
  'cookies',
  '404',
];

// System folders never translated
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
 * Build the route-exclusion test from config + system sets. Every KNOWN
 * language code is excluded as a folder (not just the configured ones) so
 * copies from a previous run never get re-collected as source pages.
 * @param {object} config - resolved config (translation.exclude, socials)
 * @returns {Function} (route: string) → boolean
 */
function buildExclusionTest(config) {
  const userExcludes = (config.translation?.exclude || []).map((entry) => String(entry).replace(/^\/+|\/+$/g, ''));

  const files = new Set([
    ...SYSTEM_EXCLUDED_ROUTES,
    ...Object.keys(config.socials || {}),
    ...userExcludes,
  ]);

  const folders = [...SYSTEM_EXCLUDED_FOLDERS, ...Object.keys(LANGUAGE_NAMES), ...userExcludes];

  return (route) => {
    if (files.has(route)) {
      return true;
    }

    return folders.some((folder) => route === folder || route.startsWith(`${folder}/`));
  };
}

/**
 * Rewrite same-site links on a translated page to their /{lang}/ versions.
 * @param {object} $ - cheerio root
 * @param {string} lang - target language
 * @param {string} baseUrl - site origin
 * @param {Function} isExcluded - route exclusion test
 */
function rewriteLinks($, lang, baseUrl, isExcluded) {
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

      const route = url.pathname.replace(/^\/+|\/+$/g, '');
      if (isExcluded(route)) {
        return;
      }

      url.pathname = `/${lang}${url.pathname}`;

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
 * @param {string} baseUrl - site origin
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

  const ogLocale = $('head meta[property="og:locale"]');
  if (ogLocale.length) {
    const currentLang = ogLocale.attr('content');
    for (const lang of [defaultLang, ...languages]) {
      if (lang === currentLang || $(`head meta[property="og:locale:alternate"][content="${lang}"]`).length) {
        continue;
      }

      ogLocale.after(`\n<meta property="og:locale:alternate" content="${lang}"/>`);
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
 * @returns {Promise<object>} stats: { skipped?, pages, languages, newStrings, cachedStrings, failures, usage, skippedCold }
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
          // Fall back to source strings for the misses; the page still ships
          missIndices.forEach((i) => { translated[i] = strings[i]; });
          stats.failures.push(`${lang} /${route}: ${e.message}`);
          logger.warn(`✗ ${logTag} — ${e.message}`);
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
      $('meta[property="og:locale"]').attr('content', lang);

      rewriteLinks($, lang, baseUrl, isExcluded);
      insertAlternates($, settings.languages, settings.default, route, baseUrl);

      // Canonical URLs are extensionless (about.html ↔ /about), so the
      // language HOME must land as <lang>.html for /es to resolve as a FILE.
      // An es/index.html forces GitHub Pages' directory redirect (/es →
      // /es/), which fights the zone's strip-trailing-slash rule into a
      // 301 loop (live find, launch night 2026-07-19).
      const targetRel = relPath === 'index.html' ? `${lang}.html` : path.join(lang, relPath);
      jetpack.write(path.join(outDir, targetRel), $.html());
      producedLangs.push(lang);
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

  return stats;
}

module.exports = { translateSite, routeOf, collectTextNodes };
