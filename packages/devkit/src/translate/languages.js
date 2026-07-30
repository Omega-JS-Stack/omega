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

// Open Graph locales (`language_TERRITORY` — the og:locale convention) for the
// supported set plus the common source languages. One territory per language:
// the most widely used one, matching Facebook's locale list (Norwegian is
// `nb_NO` there, Portuguese `pt_PT`).
const LANGUAGE_LOCALES = {
  ar: 'ar_AR',
  bn: 'bn_IN',
  cs: 'cs_CZ',
  da: 'da_DK',
  de: 'de_DE',
  el: 'el_GR',
  en: 'en_US',
  es: 'es_ES',
  fa: 'fa_IR',
  fi: 'fi_FI',
  fr: 'fr_FR',
  he: 'he_IL',
  hi: 'hi_IN',
  hu: 'hu_HU',
  id: 'id_ID',
  it: 'it_IT',
  ja: 'ja_JP',
  ko: 'ko_KR',
  ms: 'ms_MY',
  nl: 'nl_NL',
  no: 'nb_NO',
  pl: 'pl_PL',
  pt: 'pt_PT',
  ro: 'ro_RO',
  ru: 'ru_RU',
  sv: 'sv_SE',
  th: 'th_TH',
  tl: 'tl_PH',
  tr: 'tr_TR',
  uk: 'uk_UA',
  ur: 'ur_PK',
  vi: 'vi_VN',
  zh: 'zh_CN',
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
 * Open Graph locale for a language code — `es` → `es_ES`. Target codes are
 * validated by assertKnownLanguages, but the SOURCE language is free-form
 * config, so an unmapped code falls back to the code itself (a bare code is
 * what og:locale carried before this map existed).
 * @param {string} code - language code
 * @returns {string} the language_TERRITORY locale, or the code if unmapped
 */
function ogLocale(code) {
  return LANGUAGE_LOCALES[code] || code;
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

module.exports = { LANGUAGE_NAMES, LANGUAGE_LOCALES, RTL_LANGUAGES, isRTL, languageName, ogLocale, assertKnownLanguages };
