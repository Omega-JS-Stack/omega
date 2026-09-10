/**
 * Generate the default-page translations packaged with @omega.js/web (#621).
 *
 *   npm run translate:defaults                              (in packages/web)
 *   node src/translate/generate-defaults.js --languages es,fa,de
 *
 * A framework maintenance tool, not a consumer verb: it is the ONLY thing that
 * ever calls a provider for the framework's own default pages, and it runs in
 * this repo, by hand, when the default pages change or a language is added.
 *
 * What it does, in one pass:
 *  1. Renders the packaged defaults tree through the REAL production build
 *     (./build.js) against a throwaway consumer whose brand name is the
 *     fixture token — no brand repo is touched, and the render itself makes
 *     zero provider calls because the translation pass is not part of it.
 *  2. Harvests each default route's strings with the SAME collector the
 *     translation pass uses, normalizing the fixture brand to the sentinel so
 *     one packaged entry serves every brand (./packaged-defaults.js).
 *  3. Translates only the strings the packaged cache does not already carry —
 *     across ALL routes at once, so the header/footer chrome every default page
 *     repeats is paid for exactly once.
 *  4. Writes them back per route, pruned to the current sources.
 *
 * Idempotent: a re-run translates only what is missing, so adding a language or
 * a page costs exactly what it adds. A provider failure, or a translation that
 * lost the brand sentinel, STOPS the run — a packaged file is never written
 * with partial or invented content.
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const cheerio = require('cheerio');
const Logger = require('@omega.js/devkit/logger');
const {
  resolveProvider,
  translateStrings,
  languageName,
  assertKnownLanguages,
  hashKey,
  loadCache,
  saveCache,
  BATCH_SIZE,
} = require('@omega.js/devkit/translate');
const { buildSite } = require('../build.js');
const { PATHS, resolveClientEntry } = require('../paths.js');
const { collectTextNodes } = require('./collect-text-nodes.js');
const { defaultExcludedRoutes, legalRoutes } = require('./default-routes.js');
const { routeOf, SYSTEM_EXCLUDED_FOLDERS } = require('./index.js');
const { SENTINEL, pageNamespace, normalizeBrand } = require('./packaged-defaults.js');

// The languages @omega.js/web ships default-page translations for. Extend it
// by RE-RUNNING with the new set — `npm run translate:defaults -- --languages
// es,fa,de` — which translates only what the new language is missing.
const SHIPPED_LANGUAGES = ['es', 'fa'];

// The brand the render runs as. It only ever exists inside the throwaway
// consumer built below, and every occurrence of it is swapped for the sentinel
// before hashing, so nothing about it reaches a packaged file.
const FIXTURE_BRAND = 'OmegaBrandFixture';

// The sentinel rides the provider as a placeholder token; the engine's own
// rules cover placeholders generally, this names ours.
const SENTINEL_RULE = `- "${SENTINEL}" is a brand-name placeholder: reproduce it EXACTLY, never translate it, never drop it, and keep the same number of occurrences.`;

/**
 * Render the packaged defaults tree once, as a production build.
 * @param {object} logger - devkit logger
 * @returns {Promise<{ outDir: string, remove: Function }>}
 */
async function renderDefaults(logger) {
  const workDir = jetpack.tmpDir().cwd();
  const consumerDir = path.join(workDir, 'site');
  const outDir = path.join(workDir, 'dist');

  // The one page the throwaway consumer owns — Eleventy needs an input tree,
  // and everything the harvest reads comes from the DEFAULTS behind it.
  jetpack.write(
    path.join(consumerDir, 'pages', 'index.html'),
    '---\nlayout: frontend/core/base\npermalink: /\n---\n<section><h2>Defaults render</h2></section>\n',
  );

  logger.log('Rendering the packaged defaults tree (production build, no provider calls)…');

  await buildSite({
    consumerDir,
    outDir,
    // Production is what a consumer deploys, so production is what the packaged
    // strings must match — dev-only pages drop out here exactly as they do there.
    environment: 'production',
    siteData: {
      url: 'https://defaults.omega.invalid',
      brand: {
        id: 'omega-defaults',
        name: FIXTURE_BRAND,
        description: 'The render the framework harvests its own default-page strings from',
      },
      theme: { id: 'classy' },
    },
    clientEntry: resolveClientEntry(),
    // CSS purging cannot change a text node, and it is most of the build's time
    skipPurge: true,
  });

  return { outDir, remove: () => jetpack.remove(workDir) };
}

/**
 * Harvest the default routes' source strings from a rendered tree.
 * @param {string} outDir - the rendered site
 * @returns {Map<string, string[]>} route → sentinel-normalized strings, deduped
 *   per route, in collector order
 */
function harvestDefaults(outDir) {
  const routes = defaultExcludedRoutes();
  // The framework's legal boilerplate is deliberately NOT shipped translated:
  // terms/privacy/cookies are legally binding in ONE language
  // (docs/shared/translation.md), so those routes are harvested from nowhere.
  const legal = legalRoutes();
  const pages = new Map();

  for (const file of jetpack.find(outDir, { matching: '**/*.html' })) {
    const route = routeOf(path.relative(outDir, file));

    if (!routes.has(route) || legal.has(route)) {
      continue;
    }

    // Folders whose pages are never a consumer's shipped chrome — the same set
    // the translation pass guards.
    if (SYSTEM_EXCLUDED_FOLDERS.some((folder) => route === folder || route.startsWith(`${folder}/`))) {
      continue;
    }

    const strings = collectTextNodes(cheerio.load(jetpack.read(file)))
      .map((node) => normalizeBrand(node.text, FIXTURE_BRAND));

    pages.set(route, [...new Set(strings)]);
  }

  return new Map([...pages].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Translate and write one language's packaged files.
 * @param {object} options
 * @param {string} options.lang - target language
 * @param {Map<string, string[]>} options.pages - harvested route → strings
 * @param {string} options.root - packaged translations root
 * @param {Function} options.send - provider send
 * @param {object} options.logger - devkit logger
 * @returns {Promise<{ translated: number, reused: number, batches: number, usage: object }>}
 */
async function generateLanguage(options) {
  const { lang, pages, root, send, logger } = options;

  // Everything already packaged for this language, from every route: the same
  // source string is the same translation wherever it renders, so a chrome
  // string only ever costs one call in total.
  const known = new Map();
  for (const route of pages.keys()) {
    for (const [key, value] of Object.entries(loadCache(root, lang, pageNamespace(route)))) {
      known.set(key, value);
    }
  }

  const missing = [];
  const queued = new Set();
  for (const strings of pages.values()) {
    for (const source of strings) {
      const key = hashKey(source);

      if (!known.has(key) && !queued.has(key)) {
        queued.add(key);
        missing.push(source);
      }
    }
  }

  const batches = Math.ceil(missing.length / BATCH_SIZE);
  const usage = { input: 0, output: 0 };

  if (missing.length) {
    logger.log(`[${lang}] ${languageName(lang)}: ${missing.length} new string(s) in ${batches} batch(es), ${known.size} already packaged`);

    // A failure throws out of here and out of the run: no file is written for
    // this language, so the tree keeps whatever last succeeded.
    const result = await translateStrings({
      strings: missing,
      language: lang,
      languageName: languageName(lang),
      brand: SENTINEL,
      extraRules: SENTINEL_RULE,
      send,
    });

    const occurrences = (text) => text.split(SENTINEL).length - 1;
    const broken = missing.filter((source, i) => occurrences(source) !== occurrences(result.result[i]));

    if (broken.length) {
      throw new Error(`[${lang}] ${broken.length} translation(s) lost the ${SENTINEL} placeholder — nothing written. First: ${JSON.stringify(broken[0])}`);
    }

    missing.forEach((source, i) => known.set(hashKey(source), result.result[i]));
    usage.input += result.usage.input;
    usage.output += result.usage.output;
  } else {
    logger.log(`[${lang}] ${languageName(lang)}: nothing new — every string is already packaged`);
  }

  for (const [route, strings] of pages) {
    saveCache(
      root,
      lang,
      pageNamespace(route),
      Object.fromEntries(strings.map((source) => [hashKey(source), known.get(hashKey(source))])),
      strings,
    );
  }

  return { translated: missing.length, reused: known.size - missing.length, batches, usage };
}

/**
 * Generate the packaged default-page translations.
 * @param {object} [options]
 * @param {string[]} [options.languages] - the shipped set (default SHIPPED_LANGUAGES)
 * @param {string} [options.root] - packaged translations root (default: this package's)
 * @param {Function} [options.send] - provider send override (tests)
 * @param {string} [options.provider] - translation provider (default: claude)
 * @param {string} [options.model] - provider model override
 * @param {object} [options.logger] - devkit logger
 * @returns {Promise<object>} { routes, sources, languages: { [lang]: { translated, reused, batches, usage } } }
 */
async function generateDefaultTranslations(options) {
  options = options || {};
  const logger = options.logger || new Logger('translate-defaults');
  const languages = options.languages || SHIPPED_LANGUAGES;
  const root = options.root || PATHS.translations;
  const send = options.send || resolveProvider({ provider: options.provider, model: options.model }).send;

  assertKnownLanguages(languages);

  const render = await renderDefaults(logger);

  try {
    const pages = harvestDefaults(render.outDir);
    const sources = new Set([...pages.values()].flat());

    if (!pages.size) {
      throw new Error('The defaults render produced no default-page routes to harvest — the defaults tree or the render is broken.');
    }

    logger.log(`Harvested ${sources.size} unique string(s) across ${pages.size} default route(s) → ${languages.join(', ')}`);

    const stats = { routes: pages.size, sources: sources.size, languages: {} };

    for (const lang of languages) {
      stats.languages[lang] = await generateLanguage({ lang, pages, root, send, logger });
    }

    for (const [lang, result] of Object.entries(stats.languages)) {
      logger.log(`[${lang}] wrote ${pages.size} namespace(s) — ${result.translated} translated, ${result.reused} reused (${result.usage.input.toLocaleString()} in / ${result.usage.output.toLocaleString()} out tokens)`);
    }

    return stats;
  } finally {
    render.remove();
  }
}

/**
 * Read `--languages es,fa` off a CLI argv.
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {string[]|undefined}
 */
function parseLanguages(argv) {
  const index = argv.indexOf('--languages');

  return index === -1 ? undefined : String(argv[index + 1] || '').split(',').map((code) => code.trim()).filter(Boolean);
}

if (require.main === module) {
  generateDefaultTranslations({ languages: parseLanguages(process.argv.slice(2)) })
    .catch((error) => {
      // Loud and total: a half-generated language is worse than none, and the
      // tree still holds whatever the last successful run wrote.
      new Logger('translate-defaults').error(`Default-page translation failed — nothing further written: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  generateDefaultTranslations,
  harvestDefaults,
  parseLanguages,
  SHIPPED_LANGUAGES,
  FIXTURE_BRAND,
};
