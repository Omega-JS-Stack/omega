// Libraries
const Manager = new (require('../../build.js'));
const logger = Manager.logger('translate');
const { series } = require('gulp');
const jetpack = require('fs-jetpack');
const path = require('path');
const JSON5 = require('json5');
const {
  resolveProvider,
  resolveTranslationSettings,
  translateStrings,
  languageName,
  hashKey,
  loadCache,
  saveCache,
} = require('@omega.js/devkit/translate');

// Locale field limits (shared with audit.js)
const { limits: LOCALE_LIMITS } = require('../config/locales.js');

// Paths
const configMessagesPath = path.join(process.cwd(), 'config', 'messages.json');
const configDescriptionPath = path.join(process.cwd(), 'config', 'description.md');
const distLocalesDir = path.join(process.cwd(), 'dist', '_locales');

// Committed per-string cache (replaces the legacy gitignored .cache/):
// translations/{lang}/messages.json (hash → translated message) and
// translations/{lang}/description.md (translated markdown + source marker)
const translationsDir = path.join(process.cwd(), 'translations');

// First line of a translated description — records the source hash so a
// source edit invalidates it; stripped when the file is consumed
const DESCRIPTION_MARKER = /^<!-- omega:source ([0-9a-f]{12}) -->\n?/;

// Helper: Read and parse config/messages.json (JSON5 → object)
function readConfigMessages() {
  if (!jetpack.exists(configMessagesPath)) {
    return null;
  }

  try {
    return JSON5.parse(jetpack.read(configMessagesPath));
  } catch (e) {
    logger.error(`Failed to parse config/messages.json: ${e.message}`);
    return null;
  }
}

// Helper: translation settings from the RESOLVED config (brand root included)
function getSettings() {
  return resolveTranslationSettings(Manager.getConfig());
}

// Helper: compose a locale's messages.json from the EN source + cache
// (missing translations fall back to English so the file is always complete)
function composeMessages(enMessages, lang, baseDir) {
  const cache = loadCache(baseDir || translationsDir, lang, 'messages');
  const composed = {};

  for (const [key, entry] of Object.entries(enMessages)) {
    composed[key] = {
      ...entry,
      message: cache[hashKey(entry.message)] ?? entry.message,
    };
  }

  return composed;
}

// Deploy locales to dist/_locales/ — EN from config, translations from the
// committed cache. Always runs (dev + build) so package has all locale files.
async function deployTranslations(complete) {
  const enMessages = readConfigMessages();
  if (!enMessages) {
    logger.warn('config/messages.json not found or invalid, skipping');
    return complete();
  }

  // EN straight from config
  jetpack.write(path.join(distLocalesDir, 'en', 'messages.json'), JSON.stringify(enMessages, null, 2));

  // Configured languages from the committed cache (none when disabled)
  const settings = getSettings();
  const languages = settings.enabled ? settings.languages : [];
  let count = 0;

  for (const lang of languages) {
    jetpack.write(
      path.join(distLocalesDir, lang, 'messages.json'),
      JSON.stringify(composeMessages(enMessages, lang), null, 2)
    );
    count++;
  }

  logger.log(`Deployed locales to dist/_locales/: en${count ? ` + ${count} translation(s)` : ''}`);

  // Complete
  return complete();
}

// Translate config/messages.json message values — per-KEY incremental: only
// strings without a cache entry (new or edited source) hit the provider.
async function translateMessages(complete) {
  // Only run in build mode
  if (!Manager.isBuildMode()) {
    logger.log('Skipping messages translation (not in build mode)');
    return complete();
  }

  const settings = getSettings();
  if (!settings.enabled) {
    logger.log('Translation disabled (set translation.languages in omega.json5)');
    return complete();
  }

  const enMessages = readConfigMessages();
  if (!enMessages) {
    logger.warn('config/messages.json not found or invalid, skipping');
    return complete();
  }

  const brand = Manager.getConfig()?.brand?.name;
  const limitsRules = Object.entries(LOCALE_LIMITS)
    .map(([field, limit]) => `- The translation of the "${field}" message must be at most ${limit} characters (Chrome Web Store limit).`)
    .join('\n');

  let provider = null;

  for (const lang of settings.languages) {
    const cache = loadCache(translationsDir, lang, 'messages');
    const sources = Object.values(enMessages).map((entry) => entry.message);
    const misses = [...new Set(sources.filter((text) => cache[hashKey(text)] === undefined))];

    if (!misses.length) {
      logger.log(`[${lang}] All ${sources.length} messages cached`);
      saveCache(translationsDir, lang, 'messages', cache, sources);
      continue;
    }

    provider = provider || resolveProvider({ provider: settings.provider, model: settings.model });
    logger.log(`[${lang}] Translating ${misses.length} message(s) (${provider.name}${provider.model ? `/${provider.model}` : ''})...`);

    const { result } = await translateStrings({
      strings: misses,
      language: lang,
      languageName: languageName(lang),
      brand,
      extraRules: limitsRules,
      send: provider.send,
    });

    misses.forEach((text, i) => {
      cache[hashKey(text)] = result[i];
    });

    // Warn on Chrome Web Store limit violations (keys sharing a message share a translation)
    for (const [key, entry] of Object.entries(enMessages)) {
      const limit = LOCALE_LIMITS[key];
      const translated = cache[hashKey(entry.message)];

      if (limit && translated && translated.length > limit) {
        logger.warn(`[${lang}] "${key}" translation is ${translated.length} chars (limit ${limit}) — shorten it in translations/${lang}/messages.json`);
      }
    }

    saveCache(translationsDir, lang, 'messages', cache, sources);
    logger.log(`[${lang}] Messages translation saved`);
  }

  // Complete
  return complete();
}

// Translate config/description.md per language — whole-document, cached as
// committed markdown with a source-hash marker (edit the source → retranslate).
async function translateDescription(complete) {
  // Only run in build mode
  if (!Manager.isBuildMode()) {
    logger.log('Skipping description translation (not in build mode)');
    return complete();
  }

  const settings = getSettings();
  if (!settings.enabled) {
    return complete();
  }

  if (!jetpack.exists(configDescriptionPath)) {
    logger.log('config/description.md not found, skipping');
    return complete();
  }

  const enDescription = jetpack.read(configDescriptionPath);
  if (!enDescription || !enDescription.trim()) {
    logger.warn('config/description.md is empty, skipping');
    return complete();
  }

  const sourceHash = hashKey(enDescription);
  const brand = Manager.getConfig()?.brand?.name;
  let provider = null;

  for (const lang of settings.languages) {
    const outPath = path.join(translationsDir, lang, 'description.md');
    const existing = jetpack.exists(outPath) ? jetpack.read(outPath) : null;

    if (existing && existing.match(DESCRIPTION_MARKER)?.[1] === sourceHash) {
      logger.log(`[${lang}] Description cached`);
      continue;
    }

    provider = provider || resolveProvider({ provider: settings.provider, model: settings.model });
    logger.log(`[${lang}] Translating description (${enDescription.length} chars)...`);

    const { result } = await translateStrings({
      strings: [enDescription],
      language: lang,
      languageName: languageName(lang),
      brand,
      extraRules: '- Preserve the markdown formatting (headers, bold, bullets) and keep all emojis exactly as they are.\n- Maintain the same tone — enthusiastic, conversational, and persuasive.',
      send: provider.send,
    });

    jetpack.write(outPath, `<!-- omega:source ${sourceHash} -->\n${result[0]}`);
    logger.log(`[${lang}] Description translation saved`);
  }

  // Complete
  return complete();
}

/**
 * Read a translated description (marker stripped) — used by the package task
 * for store assets.
 * @param {string} lang - language code
 * @param {string} [baseDir] - translations dir override (tests)
 * @returns {string|null}
 */
function readTranslatedDescription(lang, baseDir) {
  const file = path.join(baseDir || translationsDir, lang, 'description.md');

  if (!jetpack.exists(file)) {
    return null;
  }

  return jetpack.read(file).replace(DESCRIPTION_MARKER, '');
}

// Export task
module.exports = series(translateMessages, translateDescription, deployTranslations);
module.exports.readTranslatedDescription = readTranslatedDescription;
module.exports.composeMessages = composeMessages;
