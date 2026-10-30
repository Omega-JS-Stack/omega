/**
 * The ONE slugifier of the stack: a title in, a URL slug out. @omega.js/web's
 * post editor fills its slug field with it, and @omega.js/template-kit's
 * `omega_slugify` filter answers with it, so a slug typed in the browser and a
 * slug a build renders can never disagree.
 */

/**
 * Lowercase the input, delete apostrophes rather than split on them (so
 * "Beginner's Guides" is `beginners-guides`), turn every run of anything but
 * `a-z0-9` into one `-`, and trim `-` off both ends. Both apostrophes, straight
 * and typographic: the markdown typographer smartens the straight one, and one
 * term must never answer to two slugs.
 *
 * @param {*} input - The text to slug (stringified)
 * @returns {string} The slug
 */
export function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
