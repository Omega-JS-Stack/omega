/**
 * Social shortlink pages (#429) — legacy UJM generated a redirect page per
 * social (`/spotify`, `/youtube`, `/discord`, …) from the brand's socials
 * block, and the omega footer links some of them site-wide, so every migrated
 * brand 404'd its own links until this lane existed. A brand never hand-writes
 * these pages: the `socials` config block IS the declaration.
 *
 *   socials: {
 *     twitter: 'somiibo',                                   // handle
 *     spotify: { handle: 'somiibo', redirect: 'https://…' } // handle + its own target
 *   }
 *
 * The string form is a handle, exactly as every other socials consumer reads
 * it (JSON-LD sameAs, the footer row, `omega_social`) — the profile URL
 * derives from template-kit's platform patterns, the ONE home of that
 * mapping. The object form adds the case that pattern cannot express: a
 * destination that is NOT the profile URL (kirue's Spotify ARTIST page, where
 * the handle still names the profile sameAs points at).
 *
 * The generated pages are SOURCE STRINGS registered as virtual templates on
 * the same lane as the framework's default pages (engine.js): they ride
 * `modules/utilities/redirect` (noindex + sitemap-excluded by the layout), and
 * a consumer page at the same permalink takes that URL over.
 */
const { SOCIAL_URLS } = require('@omega.js/template-kit/data/social-urls');

// A platform key is a URL segment — the shortlink is literally `/<key>`.
const KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

// The keys an entry's object form may carry. Anything else is a typo, and a
// typo'd redirect target silently ships the derived URL instead.
const ENTRY_KEYS = ['handle', 'redirect'];

// A YAML double-quoted scalar (the dynamic-pages spelling).
const yaml = (value) => JSON.stringify(String(value));

/**
 * The profile URL a handle derives on a platform — template-kit's pattern set,
 * the same one `omega_social` renders from. An unknown platform derives
 * nothing.
 * @param {string} key - platform key
 * @param {string} handle
 * @returns {string} the profile URL, or '' when it cannot be derived
 */
function profileUrl(key, handle) {
  const pattern = SOCIAL_URLS[key];
  if (!pattern || !handle) return '';

  return pattern.replace('%s', handle);
}

/**
 * Read and validate the `socials` config block. A malformed entry is an ERROR
 * (a shortlink that silently fails to generate is a 404 on a link the footer
 * prints on every page); an entry with NOTHING to point at — a blank
 * placeholder handle, or a platform with no known URL pattern and no explicit
 * redirect — declares no page, the same way the footer and sameAs already skip
 * it.
 * @param {object} [config] - the raw socials value
 * @returns {Array<{ key: string, handle: string, url: string, redirect: string }>}
 * @throws {Error} on a bad shape or an unusable platform key
 */
function readSocials(config) {
  if (config === undefined || config === null) return [];

  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(
      `socials must be a map of platform → handle — got ${Array.isArray(config) ? 'array' : typeof config}`,
    );
  }

  return Object.entries(config)
    .map(([key, value]) => readSocial(key, value))
    .filter((entry) => entry !== null);
}

/**
 * Read one socials entry.
 * @param {string} key - the platform key (the config key)
 * @param {string|object} value - a handle, or { handle, redirect }
 * @returns {object|null} the resolved entry, or null when it points nowhere
 */
function readSocial(key, value) {
  // An unset platform is how a legacy config spells "we don't have one".
  if (value === undefined || value === null || value === '') return null;

  const at = `socials.${KEY_PATTERN.test(key) ? key : JSON.stringify(key)}`;

  if (!KEY_PATTERN.test(key)) {
    throw new Error(
      `${at} is not a usable platform key — a key is lowercase, starts with a letter, and names the shortlink URL (/${key})`,
    );
  }

  if (typeof value === 'string') {
    const url = profileUrl(key, value);
    return url ? { key, handle: value, url, redirect: url } : null;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${at} must be a handle string or { handle, redirect } — got ${Array.isArray(value) ? 'array' : typeof value}`);
  }

  const unknown = Object.keys(value).find((entryKey) => !ENTRY_KEYS.includes(entryKey));
  if (unknown) {
    throw new Error(`${at} has an unknown key "${unknown}" — an entry carries handle and redirect`);
  }

  const handle = value.handle === undefined ? '' : value.handle;
  const redirect = value.redirect === undefined ? '' : value.redirect;

  if (typeof handle !== 'string') {
    throw new Error(`${at}.handle must be a string — got ${typeof handle}`);
  }
  if (typeof redirect !== 'string') {
    throw new Error(`${at}.redirect must be a URL string — got ${typeof redirect}`);
  }
  if (!handle && !redirect) {
    throw new Error(`${at} carries neither a handle nor a redirect — drop the entry, or say where /${key} goes`);
  }

  const url = profileUrl(key, handle);
  // The redirect target WINS: the profile URL is what sameAs reads, and the
  // two are only ever different because the brand said so.
  const destination = redirect || url;

  return destination ? { key, handle, url, redirect: destination } : null;
}

/**
 * The generated page of one socials entry: a redirect shortlink at /<key>.
 * @param {Array<object>} entries - readSocials output
 * @returns {Array<{ virtual: string, label: string, url: string, raw: string }>}
 */
function socialPages(entries) {
  return entries.map((entry) => ({
    virtual: `omega-socials/${entry.key}.html`,
    label: `socials.${entry.key}`,
    url: `/${entry.key}`,
    raw: [
      '---',
      'layout: modules/utilities/redirect',
      `permalink: /${entry.key}`,
      '',
      `# Social shortlink generated by @omega.js/web from socials.${entry.key} (#429).`,
      'redirect:',
      `  url: ${yaml(entry.redirect)}`,
      '---',
      '',
    ].join('\n'),
  }));
}

module.exports = { readSocials, socialPages };
