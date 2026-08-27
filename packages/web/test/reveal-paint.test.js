/**
 * #585: the above-the-fold reveal never waits for the client bundle.
 *
 * `head.html` stamps `html[data-omega-motion]` before first paint and the
 * motion sheet hides every `[data-omega-reveal]` under it — so on a cold
 * cache the hero stayed blank for the whole JS download. Two lanes fix it,
 * both pure CSS:
 *   - the LEAD band (the page's first section, under the `<main>` hook)
 *     animates in from paint, staggered by CSS delays, JS or no JS;
 *   - every other reveal auto-resolves after the wait unless the engine
 *     stamps `html[data-omega-motion-ready]` first and claims the lane.
 * Reduced motion and no-JS keep rendering final states.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'reveal-paint-test');

const MOTION_SCSS = path.join(PKG, 'core', 'css', 'motion', '_index.scss');
const MOTION_JS = path.join(PKG, 'core', 'js', 'core', 'motion.js');
const BASE_LAYOUT = path.join(PKG, 'themes', 'base', '_layouts', 'frontend', 'core', 'base.html');

const motionCss = () => sass.compile(MOTION_SCSS, { logger: { warn: () => {}, debug: () => {} } }).css;

// Compiled sass is flat: every innermost `selector { decls }` reads off one
// pass, selector lists split and whitespace collapsed (animations.test.js
// uses the same shape).
const cssRules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1].trim().split(',').map((selector) => selector.replace(/\s+/g, ' ').trim()),
  decls: match[2].replace(/\s+/g, ' ').trim(),
}));

// The one media block the reveal contract lives in — everything outside it
// would hide content from a visitor who asked for reduced motion.
const noPreferenceBlock = (css) => {
  const at = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  assert.ok(at !== -1, 'the motion sheet still opens a no-preference block');
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(at, i + 1);
    }
  }
  throw new Error('unterminated no-preference block');
};

// The tag of the element that opens `main`, and the first <section> inside it.
const mainTag = (html) => html.match(/<main[^>]*>/)[0];
const leadSection = (html) => {
  const at = html.indexOf(mainTag(html));
  const open = html.indexOf('<section', at);
  return html.slice(open, html.indexOf('</section>', open));
};

test('#585: the lead band reveals from paint — the rule has no JS gate in its path', async () => {
  const pages = await buildWith(miniData);
  const demo = pages.get('/sections-demo');

  // The hook rides the ONE wrapper that knows what "first on the page" means.
  assert.match(mainTag(demo), /data-omega-reveal-lead/, 'the <main> wrapper carries the lead hook');

  // …and the hero IS the first band under it, headline reveal and all.
  const lead = leadSection(demo);
  assert.match(lead, /omega-hero/, 'the hero is the page\'s first section');
  assert.match(lead, /<h1[^>]*data-omega-reveal/, 'the headline still reveals in');

  const rules = cssRules(noPreferenceBlock(motionCss()));
  const paint = rules.filter((rule) => rule.selectors.some((selector) => (
    selector.includes('[data-omega-reveal-lead]') && /animation:/.test(rule.decls)
  )));
  assert.ok(paint.length, 'the lead band carries a paint-time entrance animation');

  for (const rule of paint) {
    for (const selector of rule.selectors) {
      assert.ok(
        !selector.includes('data-omega-motion-ready'),
        `the lead entrance never waits on the engine's stamp (${selector})`,
      );
    }
  }

  // The stagger is CSS, because the engine's stagger pass is not there yet.
  const staggered = rules.filter((rule) => rule.selectors.some((selector) => (
    selector.includes('[data-omega-reveal-lead]') && selector.includes(':nth-child(')
  )));
  assert.ok(staggered.length >= 3, 'paint-time stagger comes from CSS delays');
});

test('#585: a reveal below the fold auto-resolves when the bundle never arrives', async () => {
  const pages = await buildWith(miniData);
  const demo = pages.get('/sections-demo');

  // The bands under the lead are the JS-driven lane — and the safety net's.
  const below = demo.slice(demo.indexOf(leadSection(demo)) + leadSection(demo).length);
  assert.match(below, /data-omega-reveal/, 'there are reveals below the lead band');

  const rules = cssRules(noPreferenceBlock(motionCss()));
  const net = rules.filter((rule) => rule.selectors.some((selector) => (
    selector.includes(':not([data-omega-motion-ready])')
  )));
  assert.ok(net.length, 'an un-booted page carries the auto-resolve net');
  assert.ok(
    net.some((rule) => /animation:[^;]*var\(--omega-reveal-wait, 1000ms\)/.test(rule.decls)),
    'the net resolves after the reveal wait (≈1s), not on a JS event',
  );

  // …and the engine is what calls it off, so a fast boot keeps scroll reveals.
  const js = fs.readFileSync(MOTION_JS, 'utf8');
  assert.match(js, /data-omega-motion-ready/, 'the engine boot stamps the ready flag');
  const wait = js.match(/REVEAL_WAIT\s*=\s*(\d+)/);
  assert.ok(wait, 'the boot names the wait it is racing');
  assert.equal(wait[1], '1000', 'the JS wait and the CSS --omega-reveal-wait default are one number');
});

test('#585: the library\'s own ambient float keeps its animation', () => {
  // The hero's decorative frame is BOTH a reveal target and an .omega-float,
  // and one `animation` shorthand replaces another — so the entrance lanes
  // that landed with #585 would have stopped it floating for good.
  const hero = fs.readFileSync(
    path.join(PKG, 'themes', 'base', '_sections', 'marketing', 'hero', 'section.html'), 'utf8',
  );
  assert.match(hero, /omega-float[^>]*data-omega-reveal/, 'the pairing this reconciles is still authored');

  for (const rule of cssRules(noPreferenceBlock(motionCss()))) {
    if (!/animation:/.test(rule.decls)) continue;
    for (const selector of rule.selectors) {
      assert.ok(
        selector.includes(':not(.omega-float)'),
        `a reveal lane never takes \`animation\` off a floating element (${selector})`,
      );
    }
  }
});

test('#585: reduced motion and no-JS still render final states', async () => {
  const css = motionCss();
  const inside = noPreferenceBlock(css);
  const outside = css.replace(inside, '');

  for (const rule of cssRules(outside)) {
    for (const selector of rule.selectors) {
      assert.ok(
        !selector.includes('[data-omega-reveal]'),
        `no reveal rule escapes the no-preference block (${selector})`,
      );
    }
  }

  // The no-JS twin: every reveal lane still hangs off the head stamp.
  for (const rule of cssRules(inside)) {
    for (const selector of rule.selectors) {
      if (!selector.includes('data-omega-reveal')) continue;
      assert.ok(
        selector.includes('html[data-omega-motion]'),
        `a reveal hides only under the head stamp (${selector})`,
      );
    }
  }

  // And the hook is an attribute on the shell, never a hidden state of its own.
  const layout = fs.readFileSync(BASE_LAYOUT, 'utf8');
  assert.match(layout, /<main[^>]*data-omega-reveal-lead/, 'the shell hook is plain markup');
});

/**
 * #585 follow-up (Ian's ruling 2026-08-25, after his Slow 3G pass): the text
 * IS there at first paint — but the entrance itself was rough, because it
 * starts while the browser is still fetching fonts and scripts. Two changes,
 * lead lane only:
 *   - a short START DELAY (~120ms) before the stagger, still far ahead of any
 *     bundle, so the first frame lands after the worst of the load burst;
 *   - `will-change` on the two properties it animates, so the compositor layer
 *     exists BEFORE the delay elapses instead of being built mid-animation —
 *     dropped once the entrance settles, since a hint that outlives its
 *     animation costs memory for nothing.
 * The safety net, reduced motion, no-JS and below-fold reveals are untouched.
 */
test('#585: the lead band waits a beat before it animates, and stages its own layer', () => {
  const rules = cssRules(noPreferenceBlock(motionCss()));
  const lead = rules.filter((rule) => rule.selectors.some((selector) => (
    selector.includes('[data-omega-reveal-lead]') && /animation:/.test(rule.decls)
  )));
  assert.ok(lead.length, 'the lead band still carries its paint-time entrance');

  for (const rule of lead) {
    // The delay is a lead-in PLUS the stagger step, not one or the other: the
    // first element waits too, or the band starts ragged.
    assert.match(
      rule.decls,
      /calc\(var\(--omega-reveal-lead-delay, 120ms\) \+ var\(--omega-reveal-step, 90ms\) \* var\(--omega-reveal-lead-index\)\)/,
      'the entrance delay is the lead-in plus this element\'s stagger step',
    );
    assert.match(rule.decls, /will-change: opacity, transform/, 'and the layer is staged before the delay elapses');
  }

  // The hint is the LEAD lane's alone — the net is a fallback that usually
  // never runs, and hinting every reveal on the page is what will-change abuse
  // looks like.
  const net = rules.filter((rule) => rule.selectors.some((selector) => selector.includes(':not([data-omega-motion-ready])')));
  assert.ok(net.length, 'the safety net is still there');
  for (const rule of net) {
    assert.ok(!/will-change/.test(rule.decls), 'the net stages nothing — it is the lane that usually never plays');
  }
});

test('#585: the staging hint comes off once the entrance settles', () => {
  const js = fs.readFileSync(MOTION_JS, 'utf8');

  assert.match(js, /data-omega-reveal-lead/, 'the boot module knows the lead band');
  assert.match(js, /omega-reveal-in/, 'and which animation it is waiting on — not every animation on the element');
  assert.match(js, /willChange = 'auto'/, 'the hint is dropped, never left behind');
  assert.match(js, /\.finished/, '…on the animation\'s own completion, so a fast boot cannot cut the entrance short');

  // The lane stays JS-OPTIONAL: nothing here gates the animation itself.
  const css = noPreferenceBlock(motionCss());
  for (const rule of cssRules(css)) {
    if (!/will-change/.test(rule.decls)) continue;
    for (const selector of rule.selectors) {
      assert.ok(
        !selector.includes('data-omega-motion-ready'),
        `the staged lane never waits on the engine's stamp (${selector})`,
      );
    }
  }
});

/**
 * #585 F5 (the blind-verifier walk, 2026-08-25): the paint-time lane read
 * `--omega-reveal-step` and NOTHING set it, so every lead band staggered at the
 * 90ms fallback while its author had written 40, 50, 60, 70, 80 or 120 on the
 * `data-omega-reveal-stagger` attribute beside it. The JS engine honours that
 * attribute (it writes `--omega-reveal-delay` per element); the CSS lane, which
 * exists precisely because the engine is not there yet, ignored it.
 *
 * The authored number stays in ONE place — the attribute — and the build
 * mirrors it into the custom property on the same element, so the two lanes can
 * never name different rhythms.
 */
test('#585 F5: the paint-time lane staggers at the AUTHORED step, not the fallback', async () => {
  const pages = await buildWith(miniData);

  // EVERY rendered band that authors a stagger, across the whole build — the
  // 62 authored attributes in the shipped sections run 40ms to 120ms, and the
  // lane was serving all of them the same 90ms.
  const staggered = [];
  for (const html of pages.values()) {
    staggered.push(...html.matchAll(/<[^>]*\bdata-omega-reveal-stagger="(\d+)"[^>]*>/g));
  }
  assert.ok(staggered.length >= 2, 'the build renders bands that author a stagger');

  for (const [tag, step] of staggered) {
    assert.match(
      tag,
      new RegExp(`--omega-reveal-step:\\s*${step}ms`),
      `the authored ${step}ms reaches the CSS lane on the same element (${tag.slice(0, 120)})`,
    );
  }

  // …and the numbers really do differ, or this pin would pass on the fallback.
  const steps = new Set(staggered.map(([, step]) => step));
  assert.ok(steps.size > 1, `the fixture exercises more than one rhythm (${[...steps].join(', ')})`);

  // The property is INHERITED down to the reveal targets — the lead rule sets
  // the index per child and multiplies by this step.
  const rules = cssRules(noPreferenceBlock(motionCss()));
  const lead = rules.filter((rule) => rule.selectors.some((selector) => (
    selector.includes('[data-omega-reveal-lead]') && /animation:/.test(rule.decls)
  )));
  assert.ok(lead.every((rule) => /var\(--omega-reveal-step, 90ms\)/.test(rule.decls)),
    'the lane still reads the property, with the fallback for a band that authors none');
});
