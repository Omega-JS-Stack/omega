/**
 * @omega.js/devkit/translate — the shared OMEGA translation system: language
 * SSOT, provider abstraction (claude via local Claude Code / chatgpt via
 * OpenAI), the batch translation engine, and the committed per-string cache.
 * Config contract (shared `translation` section of omega.json5):
 *   { enabled, default, languages, provider, model, exclude }
 */
const { LANGUAGE_NAMES, RTL_LANGUAGES, isRTL, languageName, assertKnownLanguages } = require('./languages.js');
const { PROVIDERS, DEFAULT_MODELS, resolveProvider } = require('./providers.js');
const { translateStrings, preserveWhitespace, CONTROL, BATCH_SIZE } = require('./engine.js');
const { hashKey, cachePath, loadCache, saveCache } = require('./cache.js');

/**
 * Read + validate the `translation` section of a resolved config.
 * @param {object} config - resolved omega.json5 config
 * @returns {{ enabled: boolean, default: string, languages: string[], provider: string, model: string|null, exclude: string[] }}
 *   enabled is false when the section is off or lists no languages
 */
function resolveTranslationSettings(config) {
  const section = config?.translation || {};
  const languages = section.languages || [];

  assertKnownLanguages(languages);

  return {
    enabled: section.enabled !== false && languages.length > 0,
    default: section.default || 'en',
    languages,
    provider: section.provider || 'claude',
    model: section.model || null,
    exclude: section.exclude || [],
  };
}

module.exports = {
  // languages
  LANGUAGE_NAMES, RTL_LANGUAGES, isRTL, languageName, assertKnownLanguages,
  // providers
  PROVIDERS, DEFAULT_MODELS, resolveProvider,
  // engine
  translateStrings, preserveWhitespace, CONTROL, BATCH_SIZE,
  // cache
  hashKey, cachePath, loadCache, saveCache,
  // config
  resolveTranslationSettings,
};
