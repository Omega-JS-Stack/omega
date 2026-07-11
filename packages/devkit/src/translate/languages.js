/**
 * Language SSOT for the OMEGA translation system — the code → English-name
 * map every framework validates against, plus the RTL set. Brand configs pick
 * target codes in `translation.languages`; frameworks never carry their own
 * language lists.
 */

// Supported target languages (ISO 639-1 codes → English names). The names are
// sent to the AI provider so the model knows exactly which variant is meant.
const LANGUAGE_NAMES = {
  ar: 'Arabic',
  bn: 'Bengali',
  cs: 'Czech',
  da: 'Danish',
  de: 'German',
  el: 'Greek',
  es: 'Spanish',
  fa: 'Persian (Farsi)',
  fi: 'Finnish',
  fr: 'French',
  he: 'Hebrew',
  hi: 'Hindi',
  hu: 'Hungarian',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  ms: 'Malay',
  nl: 'Dutch',
  no: 'Norwegian',
  pl: 'Polish',
  pt: 'Portuguese',
  ro: 'Romanian',
  ru: 'Russian',
  sv: 'Swedish',
  th: 'Thai',
  tl: 'Tagalog/Filipino',
  tr: 'Turkish',
  uk: 'Ukrainian',
  ur: 'Urdu',
  vi: 'Vietnamese',
  zh: 'Chinese (Simplified)',
};

// Right-to-left languages (drives <html dir="rtl"> on translated pages)
const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ku', 'yi', 'ckb', 'dv'];

/**
 * Whether a language renders right-to-left.
 * @param {string} code - language code
 * @returns {boolean}
 */
function isRTL(code) {
  return RTL_LANGUAGES.includes(code);
}

/**
 * English name for a language code.
 * @param {string} code - language code
 * @returns {string} the name, or the code itself if unknown
 */
function languageName(code) {
  return LANGUAGE_NAMES[code] || code;
}

/**
 * Assert every code is a supported target language.
 * @param {string[]} codes - language codes from config
 * @throws {Error} naming the unknown codes and the supported set
 */
function assertKnownLanguages(codes) {
  const unknown = (codes || []).filter((code) => !LANGUAGE_NAMES[code]);

  if (unknown.length) {
    throw new Error(
      `Unknown translation language(s): ${unknown.join(', ')}. `
      + `Supported codes: ${Object.keys(LANGUAGE_NAMES).join(', ')}`
    );
  }
}

module.exports = { LANGUAGE_NAMES, RTL_LANGUAGES, isRTL, languageName, assertKnownLanguages };
