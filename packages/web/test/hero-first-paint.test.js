/**
 * #763 (Ian's ruling 2026-09-02): the first-paint band animates again, started
 * inline at parse time.
 *
 * [#749] answered a 2,588ms mobile LCP by taking the hero copy OUT of the
 * reveal lane: the attributes came off the stack and one CSS rule rendered
 * every reveal inside a `data-omega-first-paint` band at its final state. It
 * bought ~2.0s, and it cost the above-the-fold fade, which is part of the
 * design.
 *
 * So the attributes come back and the meaning of the attribute changes: a
 * first-paint band's reveals START AT PARSE TIME instead of at observer time.
 * The head's inline starter (no module, no fetch) watches the document, sees
 * each band as the parser hands it over, waits one frame so the first frame is
 * opacity 0 and the transition really runs, mirrors the engine's stagger and
 * stamps `data-omega-inview`. The engine's `observeReveal` skips a stamped
 * element, so the later boot changes nothing inside the band.
 *
 * The rotator's first-child rule STAYS: its words share one grid cell, and it
 * is a different gate from the reveal lane.
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const expect = require('@omega.js/devkit/test/expect');
const JSON5 = require('json5');
const sass = require('sass');
const { Liquid } = require('liquidjs');

const { registerSectionTags } = require('../src/sections.js');
const { registerLiquid } = require('@omega.js/template-kit/register-liquid');
const { buildWith, miniData, PKG } = require('./lib/build.js');

const BASE_THEME = path.join(PKG, 'themes', 'base');
const HERO_META = path.join(BASE_THEME, '_sections', 'marketing', 'hero', 'section.json5');
const MOTION_SCSS = path.join(PKG, 'core', 'css', 'motion', '_index.scss');
const SITE = { site: { brand: { name: 'ACME' } } };

/**
 * The REAL base theme layer, the way sections-hero.test.js reads it: the
 * shipped section is what has to paint, so no fixture stands in for it.
 */
function makeEngine() {
  const warnings = [];
  const engine = new Liquid();
  registerSectionTags(engine, { baseDirs: [BASE_THEME], warn: (message) => warnings.push(message) });
  registerLiquid(engine, {
    site: SITE.site,
    getCollection: () => [],
    getCollectionNames: () => [],
    fileExists: () => false,
    markdown: (content) => content,
    icons: { fontAwesomeDirs: [], aliasFile: null, flagsDir: null, style: 'solid' },
    logos: { dir: '' },
  });
  return { engine, warnings };
}

// The shipped `demo:` roster IS the hero's variant list (#463), read from the
// section's own json5 so a variant added tomorrow is covered the day it lands.
// The bare defaults (frame and all) ride along as the first entry.
const heroVariants = () => {
  const meta = JSON5.parse(fs.readFileSync(HERO_META, 'utf8'));
  return meta.demo.map((variant) => ({ label: variant.label, args: variant.args || {} }));
};

// Compiled sass is flat: every innermost `selector { decls }` reads off one
// pass (first-paint.test.js uses the same shape).
const cssRules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1].trim().split(',').map((selector) => selector.replace(/\s+/g, ' ').trim()),
  decls: match[2].replace(/\s+/g, ' ').trim(),
}));

const noPreferenceBlock = (css) => {
  const at = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  expect(at !== -1, 'the motion sheet still opens a no-preference block').toBeTruthy();
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

module.exports = defineCases({
  type: 'group',
  description: 'hero-first-paint',
  tests: [
    // ─── The band itself ─────────────────────────────────────────────────────────

    {
      name: '#763: every shipped hero variant renders its copy on the reveal lane, inside a first-paint band',
      run: async (ctx) => {
        const variants = heroVariants();
        ctx.expect(variants.length > 1, 'the hero ships a variant roster to check').toBeTruthy();

        for (const variant of variants) {
          const { engine, warnings } = makeEngine();
          const html = await engine.parseAndRender(
            '{% section "marketing/hero", data: variant %}',
            { ...SITE, variant: variant.args },
          );

          // It really rendered the copy stack, so an empty render cannot pass.
          ctx.expect(html.includes('omega-display--hero'), `${variant.label}: the headline renders`).toBeTruthy();
          ctx.expect(html.includes('omega-hero__ctas'), `${variant.label}: the CTA row renders`).toBeTruthy();

          ctx.expect(html, `${variant.label}: the headline fades in`).toMatch(/<h1 class="omega-display omega-display--hero" data-omega-reveal>/);
          ctx.expect(html, `${variant.label}: and so does the CTA row`).toMatch(/<div class="omega-hero__ctas" data-omega-reveal>/);
          // 40ms, not the 90 it opened at: the stagger sits ahead of the LCP
          // element's fade, so every step is on the score (#763 proof, 750 → 400ms
          // past first paint together with the shorter first-paint transition).
          ctx.expect(html, `${variant.label}: the copy stack staggers, 40ms a step`).toMatch(/<div class="container" data-omega-reveal-stagger="40">/);
          ctx.expect(html, `${variant.label}: the band declares itself a first-paint band, so the head's starter runs it at parse time`).toMatch(/<section class="omega-hero[^"]*"[^>]*\sdata-omega-first-paint\b/);
          ctx.expect(warnings, `${variant.label}: renders warn-free`).toEqual([]);
        }
      },
    },

    {
      name: '#763: the rest of the copy stack rides the lane too',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          [
            '{% section "marketing/hero" %}',
            'breadcrumb:',
            '  - label: "Home"',
            '    href: "/"',
            '  - label: "Pricing"',
            'badge:',
            '  text: "New in 2.0"',
            'headline: "One stack for"',
            'headline_accent: "everything"',
            'description: "The standfirst under the display headline."',
            'meta:',
            '  - "No credit card"',
            '{% endsection %}',
          ].join('\n'),
          SITE,
        );

        ctx.expect(html, 'the breadcrumb trail').toMatch(/<nav class="small text-muted mb-3" aria-label="Breadcrumb" data-omega-reveal>/);
        ctx.expect(html, 'the badge').toMatch(/<div data-omega-reveal>\s*<span class="omega-hero__badge">/);
        ctx.expect(html, 'the sub line (the measured LCP element)').toMatch(/<p class="omega-hero__sub" data-omega-reveal>/);
        ctx.expect(html, 'the meta row').toMatch(/<div class="omega-hero__meta" data-omega-reveal>/);
        ctx.expect(html, 'and the product frame, on the scale variant').toMatch(/<div class="omega-hero__frame omega-float" data-omega-reveal="scale"/);
        ctx.expect(warnings).toEqual([]);
      },
    },

    {
      name: '#763: the headline rotator renders inside the first-paint band',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero" %}\nheadline: "One stack for"\nrotating:\n  - "your website"\n  - "your backend"\n{% endsection %}',
          SITE,
        );

        // The shipped default: `rotating` authored, no headline_accent, so the
        // rotator IS half the h1 (and the playground homepage renders exactly this).
        ctx.expect(html, 'the rotator rides the headline').toMatch(/<h1[^>]*>[\s\S]*?data-omega-rotate="2600"[\s\S]*?<\/h1>/);
        ctx.expect(html.includes('<span>your website</span>'), 'and carries the authored words').toBeTruthy();

        const band = html.indexOf('data-omega-first-paint');
        const rotator = html.indexOf('data-omega-rotate');
        ctx.expect(band !== -1 && rotator > band, 'the rotator sits inside the first-paint band').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    {
      name: '#763: a below-the-fold band keeps the reveal lane exactly as it was',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/stats" %}\nitems:\n  - number: "99.98%"\n    label: "Uptime"\n{% endsection %}',
          SITE,
        );

        ctx.expect(html.includes('data-omega-reveal-stagger="80"'), 'the stats band still staggers its children').toBeTruthy();
        ctx.expect(html.includes('<div class="omega-stat" data-omega-reveal>'), 'and each stat still reveals on scroll-in').toBeTruthy();
        ctx.expect(!html.includes('data-omega-first-paint'), 'a scrolled-to band claims no first-paint gear').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    // ─── The sheet: one lane, and the rotator's own gate ─────────────────────────

    {
      name: '#763: the motion sheet holds ONE reveal lane — no first-paint force rule',
      run: (ctx) => {
        const css = sass.compile(MOTION_SCSS, { logger: { warn: () => {}, debug: () => {} } }).css;

        // #749's force rule is gone: a first-paint band's reveals take the SAME
        // opacity-0 start as every other reveal, and the head's starter resolves
        // them a frame after the parser hands the band over. A rule that renders
        // them final would skip the fade the ruling brought back.
        const scoped = cssRules(noPreferenceBlock(css)).filter((rule) => rule.selectors.some((selector) => (
          selector.includes('data-omega-first-paint') && selector.includes('data-omega-reveal')
        )));
        const forced = scoped.filter((rule) => /opacity|transform/.test(rule.decls));
        ctx.expect(forced.map((rule) => rule.selectors).flat(), 'no rule exempts a first-paint band from the reveal lane').toEqual([]);

        // What a first-paint band DOES get is its own timing: Chrome counts the
        // largest element painted when its fade ends, so the first viewport runs the
        // shorter token and everything below the fold keeps --omega-speed-slow.
        ctx.expect(scoped.map((rule) => rule.decls), 'the one first-paint rule re-times the fade and touches nothing else').toEqual(['transition-duration: var(--omega-speed-first-paint);']);

        // The rotator lane is the OTHER opacity-0 gate above the fold, it is not on
        // the starter's path (the engine owns the cycle), and it lives outside the
        // no-preference block (reduced motion must not hide the word either), so it
        // is read off the whole sheet.
        const rotator = cssRules(css).filter((entry) => entry.selectors.some((selector) => (
          selector.includes('data-omega-first-paint') && selector.includes('data-omega-rotate')
        )));
        ctx.expect(rotator.length, 'the rotator exemption stays, and is ONE rule').toBe(1);

        const [word] = rotator;
        ctx.expect(word.selectors.join(' | '), 'it paints the FIRST word, the one the engine opens on').toMatch(/> :first-child/);
        ctx.expect(word.decls, 'which is on screen with the document').toMatch(/opacity: 1/);
        ctx.expect(word.decls, 'at its final position').toMatch(/transform: none/);

        // It must stop applying the moment the engine takes the wheel: the rotator
        // stacks its words in one grid cell, so a first word pinned visible would
        // print UNDER word two. The engine opens on the first child
        // (packages/client/src/modules/motion.js, setupRotate), so there is no
        // double-visible frame at the handover either.
        ctx.expect(word.selectors.join(' | '), 'and it yields as soon as the engine stamps an active word').toMatch(/:not\(:has\(\[data-omega-active\]\)\)/);

        for (const selector of word.selectors) {
          ctx.expect(selector, `the rotator exemption rides the head stamp (${selector})`).toMatch(/^html\[data-omega-motion\]/);
        }
      },
    },

    // ─── The head: the starter that makes the band animate at parse time ─────────

    {
      name: '#763: the head carries the inline starter, and it fetches nothing',
      run: async (ctx) => {
        const pages = await buildWith(miniData, {}, 'hero-first-paint-head');
        const home = pages.get('/');
        ctx.expect(home, 'the fixture home page builds').toBeTruthy();

        const head = home.slice(0, home.indexOf('</head>'));
        const stamp = head.indexOf("setAttribute('data-omega-motion', 'true')");
        ctx.expect(stamp !== -1, 'the motion stamp is still inline in the head').toBeTruthy();

        // The starter is its own inline block, AFTER the stamp (it reads the same
        // lane the stamp switches on).
        const at = head.indexOf('data-omega-first-paint');
        ctx.expect(at > stamp, 'the starter sits after the motion stamp').toBeTruthy();

        const starter = head.slice(head.lastIndexOf('<script', at), head.indexOf('</script>', at));
        ctx.expect(!/\ssrc=/.test(starter), 'the starter is inline: it fetches no file').toBeTruthy();
        ctx.expect(!/\bimport\b/.test(starter), 'and imports no module — a network hop here is the thing it exists to avoid').toBeTruthy();
        ctx.expect(!/type="module"/.test(starter), 'a module would be deferred, which is exactly what it must not wait for').toBeTruthy();

        // What it does: watch the document, then stamp the engine's own attributes.
        ctx.expect(starter, 'it watches the document as it is parsed').toMatch(/MutationObserver/);
        ctx.expect(starter, 'it stamps the engine\'s inview attribute').toMatch(/data-omega-inview/);
        ctx.expect(starter, 'and mirrors the engine\'s stagger').toMatch(/data-omega-reveal-stagger/);
        ctx.expect(starter, 'and lets go once the document is parsed').toMatch(/DOMContentLoaded/);

        // The guard is PER ELEMENT. A band-level "already handled" flag looks right
        // and stamps NOTHING: the parser hands the band over at its open tag, with no
        // copy inside it yet, and every later batch then returns early — the copy
        // only gets stamped by the DOMContentLoaded pass, which waits for the
        // deferred bundles. That IS the wait #763 removes (proven in a browser).
        ctx.expect(starter, 'the collector selects UNSTAMPED reveals — the attribute itself is the guard').toMatch(/\[data-omega-reveal\]:not\(\[data-omega-inview\]\)/);
        ctx.expect(starter, 'it reads the nodes each batch actually added').toMatch(/addedNodes/);
        ctx.expect(!/new WeakSet|new Set\(\)[\s\S]*first-paint\]'\)\.forEach/.test(starter), 'nothing keys a "handled" flag on the band').toBeTruthy();

        // TWO frames: the first paints the collected copy at opacity 0 (the
        // transition's starting state), the second stamps it. With one frame the
        // stamp lands before that state is ever rendered and no fade runs at all.
        ctx.expect((starter.match(/requestAnimationFrame/g) || []).length, 'the stamp is two frames after collection, so the fade has a starting state').toBe(2);
      },
    },

    {
      name: '#763: the engine skips an element the starter already stamped',
      run: (ctx) => {
        const engine = fs.readFileSync(path.join(PKG, '..', 'client', 'src', 'modules', 'motion.js'), 'utf8');

        // observeReveal's early return IS the handover: whatever the head's starter
        // stamped is already at its final state, so the engine must not hand it to
        // the IntersectionObserver and replay the entrance on scroll.
        ctx.expect(engine, 'observeReveal returns early on a stamped element').toMatch(/observeReveal\s*=\s*\(el\)\s*=>\s*\{\s*if\s*\(el\.hasAttribute\('data-omega-inview'\)\)\s*\{\s*return;/);
      },
    },
  ],
});
