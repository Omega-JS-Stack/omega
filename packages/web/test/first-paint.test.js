/**
 * #585 (Ian's ruling 2026-08-26): the reveal starter runs from its own tiny
 * first-paint script, not from the main bundle.
 *
 * The bug was never the animation — it was WHERE the starter lived. The reveal
 * engine booted from `core/js/main.js`, behind firebase/auth/analytics init, so
 * the hero's entrance waited on the whole bundle and a cold cache showed blank
 * text for seconds. The fix keeps the ORIGINAL engine and the ORIGINAL CSS
 * transition and moves the starter to a script that loads before the bundle and
 * runs at DOMContentLoaded — independent of images, fonts, and firebase.
 *
 * An earlier round answered this with a SECOND CSS lane (paint-time keyframes,
 * a lead-in hold, an nth-child cap, a 1s net, will-change staging). Its
 * different rhythm is the "different, worse animation" the ruling rejected, so
 * these cases also pin that lane STAYS deleted.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { after, test } = require('node:test');
const sass = require('sass');

const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');
const { buildAssets } = require('../src/assets.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'first-paint-test');

const MOTION_SCSS = path.join(PKG, 'core', 'css', 'motion', '_index.scss');
const MOTION_JS = path.join(PKG, 'core', 'js', 'core', 'motion.js');
const FIRST_PAINT_JS = path.join(PKG, 'core', 'js', 'first-paint.js');

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

test('#585: the reveal starter loads BEFORE the main bundle', async () => {
  const pages = await buildWith(miniData);
  const demo = pages.get('/sections-demo');

  // Both bundles ship, and the tiny one is ahead of the big one in document
  // order — which for two `type="module"` tags IS execution order.
  const firstPaint = demo.indexOf('/assets/js/first-paint-TEST.js');
  const main = demo.indexOf('/assets/js/main-TEST.js');

  assert.ok(firstPaint !== -1, 'the page loads the first-paint script');
  assert.ok(main !== -1, 'the page still loads the main bundle');
  assert.ok(firstPaint < main, 'the first-paint script comes before the main bundle');

  // …and document order only IS execution order while NEITHER tag is async:
  // one `async` and the browser runs whichever bundle lands first, which on a
  // warm cache is the big one — the exact race this design exists to lose.
  const scriptTag = (at) => demo.slice(demo.lastIndexOf('<script', at), demo.indexOf('>', at) + 1);
  assert.doesNotMatch(scriptTag(firstPaint), /\basync\b/, 'the first-paint script is never async');
  assert.doesNotMatch(scriptTag(main), /\basync\b/, 'and neither is the main bundle');

  // It is a module (deferred → runs once the DOM is parsed, before the foot's
  // module), never a blocking classic script in the head.
  assert.match(scriptTag(firstPaint), /type="module"/, 'the first-paint script is a deferred module');
});

test('#585: the first-paint script boots the engine without the client singleton', () => {
  const js = fs.readFileSync(FIRST_PAINT_JS, 'utf8');

  // The ORIGINAL engine, started the ORIGINAL way.
  assert.match(js, /createMotion/, 'it creates the shared motion engine');
  assert.match(js, /\.start\(\)/, 'it starts that engine');

  // The whole point: nothing on this path pulls firebase/auth/analytics in.
  // `@omega.js/client` (the singleton) drags the runtime; the motion MODULE
  // subpath is standalone.
  const imports = [...js.matchAll(/^import[^;]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.ok(imports.length, 'the first-paint script declares its imports');
  for (const specifier of imports) {
    assert.ok(
      specifier !== '@omega.js/client',
      `the first-paint script never imports the client singleton (${specifier})`,
    );
  }
});

test('#585: the reveal is the original transition, with no JS-bundle gate in its path', () => {
  const rules = cssRules(noPreferenceBlock(motionCss()));

  // The original contract: hidden under the head stamp, transitioned back by
  // the engine's data-omega-inview stamp.
  const hidden = rules.find((rule) => rule.selectors.includes('html[data-omega-motion] [data-omega-reveal]'));
  assert.ok(hidden, 'reveals still start hidden under the head stamp');
  assert.match(hidden.decls, /transition:/, 'the entrance is a transition, as it always was');

  const inview = rules.find((rule) => (
    rule.selectors.some((selector) => selector.includes('[data-omega-reveal][data-omega-inview]'))
  ));
  assert.ok(inview, 'the engine\'s inview stamp still resolves it');
  assert.match(inview.decls, /opacity: 1/, 'inview lands on the final state');

  // The rejected second lane stays gone: no keyframe entrance, no 1s net, no
  // will-change staging, no ready-stamp gate anywhere in the reveal contract.
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      if (!selector.includes('data-omega-reveal')) continue;
      assert.ok(
        !/animation:/.test(rule.decls),
        `no reveal rule carries a keyframe lane (${selector})`,
      );
      assert.ok(
        !/will-change/.test(rule.decls),
        `no reveal rule stages a compositor layer (${selector})`,
      );
      assert.ok(
        !selector.includes('data-omega-motion-ready'),
        `no reveal rule waits on an engine stamp (${selector})`,
      );
      assert.ok(
        !selector.includes('data-omega-reveal-lead'),
        `the lead-band hook is gone (${selector})`,
      );
    }
  }

  const css = motionCss();
  assert.ok(!css.includes('omega-reveal-in'), 'the paint-time keyframe is deleted');
  assert.ok(!css.includes('--omega-reveal-wait'), 'the 1s safety net is deleted');

  // The build-time mirror that only fed the deleted lane goes with it.
  assert.ok(
    !fs.existsSync(path.join(PKG, 'src', 'reveal-stagger.js')),
    'the stagger mirror that only served the paint-time lane is deleted',
  );

  // The main bundle no longer owns the starter — that is the whole fix.
  const motionJs = fs.readFileSync(MOTION_JS, 'utf8');
  assert.ok(!/data-omega-motion-ready/.test(motionJs), 'the boot module stamps no ready flag');
  assert.ok(!/REVEAL_WAIT/.test(motionJs), 'the boot module races no safety net');
});

// The built graph, not just the source: #182's pid-namespaced out dir, since a
// second suite run must not wipe this one's assets mid-flight.
const ASSET_OUT = path.join(PKG, '.omega', `first-paint-assets-out-${process.pid}`);
after(() => fs.rmSync(ASSET_OUT, { recursive: true, force: true }));

test('#585: the shipped first-paint bundle carries the engine and NO firebase', async () => {
  const ROOT = path.resolve(PKG, '..', '..');
  const themeRoots = [path.join(PKG, 'themes', 'classy'), path.join(PKG, 'themes', 'base')];
  const manifest = await buildAssets({
    layers: [path.join(__dirname, 'fixtures', 'site-assets'), ...themeRoots, path.join(PKG, 'core')],
    themeRoots,
    sectionRoots: [path.join(__dirname, 'fixtures', 'site-assets'), ...themeRoots],
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    outDir: ASSET_OUT,
    clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
  });

  assert.ok(manifest.js.firstPaint, 'the pipeline emits a first-paint bundle into the manifest');

  // Walk the entry's whole chunk graph — code splitting means the entry file
  // alone proves nothing about what the browser actually fetches.
  const seen = new Set();
  const walk = (fromDir, rel) => {
    const abs = path.join(fromDir, rel);
    if (seen.has(abs)) return;
    seen.add(abs);
    const src = fs.readFileSync(abs, 'utf8');
    for (const match of src.matchAll(/from\s*"([^"]+)"/g)) {
      if (match[1].startsWith('.')) walk(path.dirname(abs), match[1]);
    }
  };
  walk(ASSET_OUT, manifest.js.firstPaint.replace(/^\//, ''));

  const sources = [...seen].map((file) => fs.readFileSync(file, 'utf8'));
  const bytes = sources.reduce((sum, src) => sum + src.length, 0);

  // It really is the reveal engine…
  assert.ok(
    sources.some((src) => src.includes('data-omega-reveal')),
    'the first-paint graph contains the motion engine',
  );

  // …and the whole point: the firebase/auth runtime is NOT on this path. If it
  // ever is, the hero is back to waiting for the app to boot.
  for (const src of sources) {
    assert.ok(!/initializeApp/.test(src), 'the first-paint graph never pulls the firebase runtime');
  }

  // A budget, not a limit for its own sake: this is the seam that must stay
  // small enough to be worth loading before everything else.
  assert.ok(bytes < 60000, `the first-paint graph stays tiny (${bytes} bytes across ${seen.size} files)`);
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

  // The no-JS twin: every reveal lane still hangs off the head stamp, which an
  // inline script sets — no script, no stamp, nothing hidden.
  for (const rule of cssRules(inside)) {
    for (const selector of rule.selectors) {
      if (!selector.includes('data-omega-reveal')) continue;
      assert.ok(
        selector.includes('html[data-omega-motion]'),
        `a reveal hides only under the head stamp (${selector})`,
      );
    }
  }

  const pages = await buildWith(miniData);
  assert.match(
    pages.get('/sections-demo'),
    /document\.documentElement\.setAttribute\('data-omega-motion', 'true'\)/,
    'the stamp is still inline in the head, ahead of any bundle',
  );
});
