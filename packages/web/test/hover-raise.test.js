/**
 * #686 (Ian 2026-08-29): classy hover never LIFTS. Buttons, cards, tiles —
 * nothing travels upward under the pointer. Every OTHER hover effect stays:
 * the highlight, the ring, the shadow, the press, the hero tilt.
 *
 * The raise itself is shared css (core's motion library, and the classy
 * partials newsflash/neobrutalism import as their floor), so this is an
 * OPT-OUT, not a deletion: the pin is written against the compiled bundle of
 * two theme chains, so classy landing flat while a sibling still lifts is one
 * assertion each.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { layeredFileImporter, sectionsImporter } = require('../src/assets.js');
const { PKG } = require('./lib/build.js');

const CLASSY = path.join(PKG, 'themes', 'classy');

/** A sheet that compiles on its own — the page lane compiles one per page. */
const compileSheet = (file) => sass.compile(file, { logger: { warn: () => {}, debug: () => {} } }).css;

/** The shipped bundle for a theme chain. */
function compileBundle(theme) {
  const layers = [path.join(PKG, 'themes', theme), path.join(PKG, 'themes', 'base'), path.join(PKG, 'core')];
  return sass.compile(path.join(PKG, 'core', 'css', 'main.scss'), {
    importers: [layeredFileImporter(layers), sectionsImporter([])],
    loadPaths: layers,
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
    logger: { warn: () => {}, debug: () => {} },
  }).css;
}

// Compiled sass is flat, so every innermost `selector { decls }` reads off one
// pass; selector lists split, whitespace collapsed to the compiled spelling.
const cssRules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1].trim().split(',').map((selector) => selector.replace(/\s+/g, ' ').trim()),
  decls: match[2],
}));

// The reduced-motion park is its own deal (#184) — a raise the park flattens
// still raises for everyone else, so it never counts as cancelled here.
const withoutReducedMotion = (css) => css.replace(/@media \(prefers-reduced-motion: reduce\) \{.*?\n\}/gs, '');

// What a selector's transform ACTUALLY resolves to: an opt-out cancels a raise
// by re-declaring it flat, so the winning rule paints. `html .x:hover` is the
// same target as `.x:hover`, one specificity step up — the step core css needs,
// since its legacy utilities land after every theme. Everything else settles on
// source order, which is how the theme outranks the sheets above it.
const hoverTransforms = (css) => {
  const painted = new Map();
  for (const rule of cssRules(withoutReducedMotion(css))) {
    const transform = rule.decls.match(/transform:([^;]*)/);
    if (!transform) continue;
    for (const selector of rule.selectors) {
      if (!/:hover|:focus-visible/.test(selector)) continue;
      const target = selector.replace(/^html /, '');
      const rank = target === selector ? 0 : 1;
      if (painted.get(target)?.rank > rank) continue;
      painted.set(target, { rank, transform: transform[1].trim() });
    }
  }
  return painted;
};

// Every selector that RAISES under the pointer or the keyboard: a negative
// translateY left standing. A bare `:focus` is Bootstrap's floating label — a
// form mechanic, not a hover affordance.
const hoverRaises = (css) => [...hoverTransforms(css)]
  .filter(([, painted]) => /translateY\(-/.test(painted.transform))
  .map(([selector]) => selector)
  .sort();

/** The declarations every rule in the bundle writes for one exact selector. */
const declsFor = (css, selector) => cssRules(css)
  .filter((rule) => rule.selectors.includes(selector))
  .map((rule) => rule.decls.replace(/\s+/g, ' ').trim());

test('#686: nothing in the classy bundle raises on hover', () => {
  const css = compileBundle('classy');

  assert.deepEqual(
    hoverRaises(css),
    [],
    'the whole raise family lands flat in classy — buttons, tiles, cards, the store badge, the hero frame, the legacy utilities',
  );
});

test('#686: the raise is classy\'s alone to drop — a sibling theme still lifts', () => {
  const raises = hoverRaises(compileBundle('newsflash'));

  for (const selector of [
    // The core motion idiom, untouched for every other skin.
    '.omega-hover-lift:hover',
    '.omega-hover-raise:hover',
    '.omega-interactive--lift:hover',
    '.omega-interactive--lift:focus-visible',
    // The classy partials newsflash imports as its floor: the raise stays in
    // the file, which is why classy opts out instead of deleting it.
    '.omega-person:hover',
    '.omega-hero__frame:hover .omega-hero__frame-inner',
  ]) {
    assert.ok(raises.includes(selector), `${selector} still raises outside classy`);
  }
});

test('#686: only the raise goes — highlight, ring, shadow and press all stay', () => {
  const css = compileBundle('classy');

  // The core idiom keeps everything but the travel.
  assert.ok(
    declsFor(css, '.omega-hover-raise:hover').some((decls) => decls.includes('box-shadow: var(--omega-shadow-2)')),
    'the raise utility still deepens its shadow',
  );
  assert.ok(
    declsFor(css, '.omega-interactive:focus-visible').some((decls) => decls.includes('outline: 2px solid var(--omega-accent-ring)')),
    'the keyboard ring is untouched',
  );
  assert.ok(
    declsFor(css, '.omega-interactive:hover').some((decls) => decls.includes('background-color: var(--omega-surface-2)')),
    'the surface still warms under the pointer',
  );

  // Classy's own surfaces keep their line/shadow highlights.
  assert.ok(
    declsFor(css, '.omega-tile:hover').some((decls) => decls.includes('border-color: var(--omega-line-strong)')),
    'a tile still firms its hairline',
  );
  assert.ok(
    declsFor(css, '.omega-dl-store__badge:hover').some((decls) => decls.includes('box-shadow: var(--omega-shadow-2)')),
    'a store badge still lifts its shadow without lifting itself',
  );
  // The press is not a raise: a button still sinks under the click.
  assert.ok(
    declsFor(css, '.btn:active').some((decls) => decls.includes('transform: scale(0.985)')),
    'the press feedback survives the un-lift',
  );

  // The hero frame keeps its tilt; only the 3px of travel went.
  const frame = declsFor(css, '.omega-hero__frame:hover .omega-hero__frame-inner');
  assert.ok(frame.includes('transform: rotateX(1.1deg);'), 'the frame still tips toward the pointer');

  // Reduced motion still parks what it always parked — and a media query adds
  // no specificity, so re-declaring the tilt means re-declaring its park.
  assert.equal(frame.at(-1), 'transform: none;', 'reduced motion still stills the frame');
  const reduced = css.slice(css.indexOf('prefers-reduced-motion: reduce'));
  assert.match(reduced, /\.omega-interactive/, 'the reduced-motion park is intact');
});

test('#686: the classy PAGE sheets land flat too — they load after core\'s own', () => {
  // Page css is its own lane (core → base → theme, per page), so the two
  // classy page sheets that raised are pinned where they compile.
  const timeline = compileSheet(path.join(CLASSY, 'css', 'pages', 'updates', 'index.scss'));
  assert.deepEqual(hoverRaises(timeline), [], 'a release entry answers the pointer without moving');
  assert.ok(
    declsFor(timeline, '.omega-timeline__body:hover').some((decls) => decls.includes('box-shadow: var(--omega-shadow-2)')),
    'and it still answers — line and shadow',
  );

  // core/css/pages/feedback/index.scss raises the rating button 4px and loads
  // FIRST on that page, so classy's sheet has to say flat out loud.
  const feedback = compileSheet(path.join(CLASSY, 'css', 'pages', 'feedback', 'index.scss'));
  assert.ok(
    declsFor(feedback, '.feedback-rating-btn:hover').some((decls) => decls.includes('transform: none')),
    'classy cancels core\'s raise rather than leaving it to win',
  );
  assert.ok(
    declsFor(feedback, '.feedback-rating-btn:hover').some((decls) => decls.includes('border-color: var(--omega-line-strong)')),
    'the line still firms under the pointer',
  );
});
