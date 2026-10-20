/**
 * language-flags.js — ISO 639-1 language code => ISO 3166 country code for flag icons.
 *
 * The one home of the map: edit it here. Web's alias writer gives every
 * supported language whose country has no file in the flag set the neutral
 * fallback glyph instead.
 */

const LANGUAGE_TO_COUNTRY = {
  "en": "us", // English -> United States (could also be 'gb' for Great Britain)
  "es": "es", // Spanish -> Spain
  "fr": "fr", // French -> France
  "de": "de", // German -> Germany
  "it": "it", // Italian -> Italy
  "pt": "pt", // Portuguese -> Portugal
  "ru": "ru", // Russian -> Russia
  "ja": "jp", // Japanese -> Japan
  "ko": "kr", // Korean -> South Korea
  "zh": "cn", // Chinese -> China
  "ar": "sa", // Arabic -> Saudi Arabia
  "hi": "in", // Hindi -> India
  "tr": "tr", // Turkish -> Turkey
  "pl": "pl", // Polish -> Poland
  "nl": "nl", // Dutch -> Netherlands
  "sv": "se", // Swedish -> Sweden
  "no": "no", // Norwegian -> Norway
  "da": "dk", // Danish -> Denmark
  "fi": "fi", // Finnish -> Finland
  "he": "il", // Hebrew -> Israel
  "fa": "ir", // Persian (Farsi) -> Iran
  "el": "gr", // Greek -> Greece
  "ms": "my", // Malay -> Malaysia
  "th": "th", // Thai -> Thailand
  "vi": "vn", // Vietnamese -> Vietnam
  "ur": "pk", // Urdu -> Pakistan
  "id": "id", // Indonesian -> Indonesia
  "bn": "bd", // Bengali -> Bangladesh
  "tl": "ph", // Tagalog/Filipino -> Philippines
  "uk": "ua", // Ukrainian -> Ukraine
  "cs": "cz", // Czech -> Czech Republic
  "hu": "hu", // Hungarian -> Hungary
  "ro": "ro", // Romanian -> Romania
  "bg": "bg", // Bulgarian -> Bulgaria
  "hr": "hr", // Croatian -> Croatia
  "sk": "sk", // Slovak -> Slovakia
  "sl": "si", // Slovenian -> Slovenia
  "et": "ee", // Estonian -> Estonia
  "lv": "lv", // Latvian -> Latvia
  "lt": "lt", // Lithuanian -> Lithuania
  "mt": "mt", // Maltese -> Malta
  "ga": "ie", // Irish -> Ireland
  "cy": "gb", // Welsh -> Great Britain
  "ca": "es", // Catalan -> Spain (could also be ad for Andorra)
  "eu": "es", // Basque -> Spain
  "gl": "es", // Galician -> Spain
};

module.exports = { LANGUAGE_TO_COUNTRY };
