/**
 * Corpus tier-2 override behavior — the §7 section-js lane's OVERRIDE half.
 * The base stats band ships no section.js, so this file existing at all is
 * what proves an override folder's js reaches the main bundle: the cell greps
 * the built bundle for the global it sets.
 * The §7 presence init calls this once per rendered instance.
 */
export default (el) => {
  window.__corpusOverride = 'section-js';
  el.setAttribute('data-corpus-override-booted', 'true');
};
