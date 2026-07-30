/**
 * The CSS fall-through guard (#98) — a build-time WARNING when a non-classy
 * theme skips the two blessed lanes of docs/shared/theming.md § "CSS
 * fall-through".
 *
 * Framework pages a theme doesn't cover (auth, account, legal) render the
 * shared `classy-*` vocabulary. A theme reaches it either through the
 * inheritance hatch (`@forward 'omega:theme';` — partial themes) or by
 * importing classy's token-pure floor partials (full sibling themes with
 * their own Bootstrap). A theme that does neither still builds — and those
 * pages render unstyled with zero signal. This check reads the COMPILED main
 * bundle, so it sees what is true rather than guessing from source.
 */

// Libraries
const path = require('node:path');
const Logger = require('@omega.js/devkit/logger');

// Variables
const logger = new Logger('theme-vocabulary');

// The sentinels: one selector per fall-through surface, each guaranteed by
// BOTH lanes (the hatch emits classy's whole chain; the ratified floor set
// names these exact partials). A theme that deliberately RE-styles the
// vocabulary defines the same selectors itself and passes — the check asks
// only "is the shared vocabulary painted at all".
const SENTINELS = [
  { selector: '.classy-auth', partial: 'pages/auth', surface: 'auth pages (sign-in, sign-up, reset)' },
  { selector: '.classy-statgrid', partial: 'app/panels', surface: 'account/app panels' },
  { selector: '.classy-footer', partial: 'layout/footer', surface: 'the shared site footer' },
];

// A theme that DEFINES Bootstrap's body-bg custom property ships its own
// Bootstrap (bootstrap/scss/_root.scss, or classy's bridge when the chain
// emitted) — so its lane is the floor, never the whole-chain hatch (two
// Bootstraps). Core css only ever READS --bs-* properties, never defines
// this one.
const OWN_BOOTSTRAP = '--bs-body-bg:';

/**
 * Warn once when the active theme paints none of the fall-through vocabulary.
 * @param {object} options
 * @param {string} options.css - the compiled MAIN css bundle
 * @param {string[]} options.themeRoots - resolveThemeLayers output (active theme first,
 *   classy last); a single root means classy is active and the check is moot
 * @param {function} [options.warn] - warning sink (default the devkit logger)
 * @returns {{ theme: string, lane: 'hatch'|'floor', missing: string[] }|null} null when silent
 */
function checkThemeVocabulary(options) {
  const { css, themeRoots } = options;
  if (!css || !themeRoots || themeRoots.length < 2) return null;

  const missing = SENTINELS.filter((sentinel) => !css.includes(sentinel.selector));
  if (missing.length === 0) return null;

  const theme = path.basename(themeRoots[0]);
  const lane = css.includes(OWN_BOOTSTRAP) ? 'floor' : 'hatch';
  const fix = lane === 'hatch'
    ? `add \`@forward 'omega:theme';\` as the FIRST line of themes/${theme}/_theme.scss`
    : `import classy's token-pure floor EARLY in themes/${theme}/_theme.scss: ${missing.map((sentinel) => `@import '../classy/css/${sentinel.partial}';`).join(' ')}`;

  const warn = options.warn || logger.warn.bind(logger);
  warn(
    `theme "${theme}" skips the CSS fall-through contract — framework pages (auth, account, legal) `
    + `will render UNSTYLED classy-* markup.\n`
    + `  missing from the compiled bundle: `
    + `${missing.map((sentinel) => `${sentinel.selector} (${sentinel.partial} → ${sentinel.surface})`).join(', ')}\n`
    + `  the missing piece: the ${lane === 'hatch' ? 'inheritance hatch (this theme ships no Bootstrap of its own)' : 'vocabulary floor (this theme ships its own Bootstrap)'}\n`
    + `  the fix: ${fix}\n`
    + `  contract: docs/shared/theming.md § "CSS fall-through — the two lanes"`,
  );

  return { theme, lane, missing: missing.map((sentinel) => sentinel.selector) };
}

module.exports = { checkThemeVocabulary };
