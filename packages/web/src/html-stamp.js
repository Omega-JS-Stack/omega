/**
 * The ONE reader of an `<html>` stamp (P1). The build stamps its post-build
 * facts on the root element (the #355 mount point, the #858 page translate
 * switch) and a pass over dist/ reads them back. Production HTML goes through
 * the minifier on its way there, which drops the attribute QUOTES
 * (`data-omega-path-prefix=/app`), so a reader that only accepts a quoted
 * value answers nothing on every production page. One tolerant reader, so two
 * stamps can never disagree about that.
 */

/**
 * The value of a stamp attribute on the `<html>` element.
 * @param {string} html - a built page
 * @param {string} attribute - the stamp's attribute name
 * @returns {string|null} the raw value, or null when the page carries no stamp
 */
function readHtmlStamp(html, attribute) {
  const pattern = new RegExp(`<html\\b[^>]*\\b${attribute}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = pattern.exec(String(html == null ? '' : html));
  if (!match) return null;

  return match[1] ?? match[2] ?? match[3];
}

module.exports = { readHtmlStamp };
