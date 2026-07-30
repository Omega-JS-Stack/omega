/**
 * Language Switcher Module
 * Renders the footer's language menu from the page's OWN hreflang alternates.
 *
 * Those `<link rel="alternate" hreflang>` tags are the single source of truth:
 * the translate pass stitches them after a page's copies are written, so they
 * name only the languages actually produced (src/translate/index.js — "hreflang
 * never lies"). Reading them here means the menu can never offer a copy that
 * was skipped, and a page with no copies (an excluded route, a cold-cache miss)
 * shows no control at all — fewer than two languages is not a choice.
 *
 * Labels come from Intl.DisplayNames in each language's own locale, so a row
 * names itself the way its readers do ("Español", not "Spanish"). The
 * build-time native-name map (@omega.js/devkit/translate) never reaches the
 * browser bundle, and shipping a copy of it to every page would cost more than
 * the platform already gives for free; an engine or code with no display name
 * falls back to the upper-cased code.
 *
 * Flags (#129) come from the SAME core set the retired footer dropdown drew
 * (core/icons/flags), reached at its emitted path: src/language-flags.js writes
 * language-named copies into the `lang/` namespace beside the country-named set
 * (their own space — `ar` is Arabic AND Argentina), so a row needs only its own
 * code and this module carries no language→country map. A language the set has
 * no flag for 404s, and the failed <img> removes itself — a missing flag is a
 * content problem, never a broken-image glyph (docs/shared/icons.md).
 */
// Relative, not the __main_assets__ alias: the alias only resolves inside the
// esbuild pass, and this module's logic is unit-tested by loading the file
// directly (test/language-switcher.test.js) — same reason modules/redirect.js
// imports the logger relatively.
import { createLogger } from '../libs/logger.js';

const logger = createLogger('language-switcher');

// The footer's mount (classy _includes/frontend/sections/footer.html — the base
// layer every theme inherits) and the <ul> this module fills.
const MOUNT_SELECTOR = '[data-omega-language-switcher]';
const LIST_SELECTOR = '[data-omega-language-list]';
const ALTERNATE_SELECTOR = 'link[rel="alternate"][hreflang]';

// The emitted icon set (emitIcons ships core/icons/* to assets/fa/*), served
// from the site's own origin exactly like the runtime Font Awesome transport
const FLAG_SELECTOR = 'img[data-omega-language-flag]';
const FLAG_BASE = '/assets/fa/flags/lang/';

/**
 * Name one language in its own tongue.
 * @param {string} code - an hreflang code
 * @returns {string} the native language name, or the upper-cased code
 */
export function languageLabel(code) {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);

    // DisplayNames falls back to the code itself for anything it does not know
    if (name && name.toLowerCase() !== code.toLowerCase()) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  } catch (error) {
    // A malformed code throws RangeError — expected external input (the tag is
    // whatever the page's config produced), so the code still labels the row
  }

  return code.toUpperCase();
}

/**
 * Turn the page's alternate tags into switcher rows.
 * @param {Iterable<Element>} links - the alternate link tags
 * @param {string} currentLang - document.documentElement.lang
 * @returns {Array<{code: string, href: string, label: string, current: boolean}>}
 */
export function languageEntries(links, currentLang) {
  const current = (currentLang || '').trim().toLowerCase();
  const seen = new Set();
  const entries = [];

  for (const link of links) {
    const code = (link.getAttribute('hreflang') || '').trim();
    const href = (link.getAttribute('href') || '').trim();
    const key = code.toLowerCase();

    // x-default is a fallback annotation, not a language a reader can pick
    if (!code || !href || key === 'x-default' || seen.has(key)) continue;

    seen.add(key);
    entries.push({ code: key, href, label: languageLabel(code), current: key === current });
  }

  return entries;
}

/** Escape a value for an attribute or text node. */
function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render the dropup rows. Bootstrap's dropdown is delegated, so filling the
 * menu after boot needs no re-init; `.active` is the theme's own item state
 * (themes/classy/css/components/_dropdowns.scss).
 * @param {Array<object>} entries - rows from languageEntries()
 * @returns {string} the <li> markup
 */
export function switcherHtml(entries) {
  return entries.map(({ code, href, label, current }) => {
    const classes = `dropdown-item${current ? ' active' : ''}`;
    const marker = current ? ' aria-current="true"' : '';
    // alt is empty on purpose: the label beside it already names the language
    const flag = `<img class="uj-language-flag" data-omega-language-flag src="${FLAG_BASE}${escapeHtml(code)}.svg" alt="" loading="lazy">`;

    return `<li><a lang="${escapeHtml(code)}" dir="auto" hreflang="${escapeHtml(code)}" class="${classes}" href="${escapeHtml(href)}"${marker}>${flag}${escapeHtml(label)}</a></li>`;
  }).join('');
}

/**
 * Drop the flags the emitted set has no file for. The switcher renders before
 * any fetch resolves, so the miss can only be known here.
 * @param {Element} list - the filled <ul>
 * @returns {number} the number of flags wired
 */
export function wireFlagFallback(list) {
  const flags = list.querySelectorAll(FLAG_SELECTOR);

  for (const flag of flags) {
    flag.addEventListener('error', () => flag.remove(), { once: true });
  }

  return flags.length;
}

/**
 * Fill and reveal the switcher for one document.
 * @param {Document} doc - the document to read and mount into
 * @returns {number} the number of languages offered (0 = nothing rendered)
 */
export function mountLanguageSwitcher(doc) {
  const mount = doc.querySelector(MOUNT_SELECTOR);

  // Most surfaces carry no footer switcher (admin, app shells, emails)
  if (!mount) return 0;

  const entries = languageEntries(doc.querySelectorAll(ALTERNATE_SELECTOR), doc.documentElement.lang);
  if (entries.length < 2) return 0;

  const list = mount.querySelector(LIST_SELECTOR);
  if (!list) {
    logger.error(`Switcher mount carries no ${LIST_SELECTOR} — the footer markup and this module disagree`);
    return 0;
  }

  list.innerHTML = switcherHtml(entries);
  wireFlagFallback(list);
  mount.hidden = false;

  return entries.length;
}

// Module
export default () => {
  mountLanguageSwitcher(document);
};
