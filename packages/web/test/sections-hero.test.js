/**
 * marketing/hero contract pins — the REAL base section through the real
 * engine: the two CTA buttons obey ONE enabled contract (#438), ported stat
 * `cards` render warn-free (#435), the `form` demo type renders its field
 * cluster on the framework's own showcase frame (#437), `demo.placement: side`
 * sets the demo beside the copy (#475), the buttons take the legacy
 * `icon`/`class` args (#476), the `video` demo type renders in both
 * placements (#486), and a demo that IS the hero visual — a side demo of any
 * type (#496), a video demo in any placement (#486) — suppresses the frame.
 *
 * The build-level pins read the SHOWCASE gallery's per-variant frame pages
 * (#463): the shipped `demo:` roster in the hero's own json5 is the authored
 * composition now, and each variant renders on its own /test/sections/…/frames/
 * page — the hero-demo-* default pages folded into it.
 *
 * Plus the three pre-ship pins on that demo work: a video is muted only when
 * its author (or autoplay) says so, the input lane's defaults stay off every
 * other demo type, and an authored `headline_accent` beats the default rotator.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const { Liquid } = require('liquidjs');

const { registerSectionTags } = require('../src/sections.js');
const { registerLiquid } = require('@omega.js/template-kit/register-liquid');
const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'sections-hero-test');

const BASE_THEME = path.join(PKG, 'themes', 'base');
const SITE = { site: { brand: { name: 'ACME' } } };

/**
 * Fresh engine over the REAL base theme layer with a captured warn sink —
 * the shipped section.json5 IS the schema under test, so no fixture stands in.
 * Icons are native markup (#619) — the section emits `<i class="fa-solid
 * fa-<name>">` and the build's inlining pass fills it later, so the class is
 * what the assertions read.
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

// ─── #438: one enabled contract for both CTA buttons ─────────────────────────

test('#438: primary_button.enabled false hides it; absent enabled keeps it visible', async () => {
  const { engine, warnings } = makeEngine();
  const hidden = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nprimary_button:\n  enabled: false\n  text: "Start writing free"\n{% endsection %}',
    SITE,
  );
  assert.ok(!hidden.includes('Start writing free'), 'enabled: false suppresses the primary CTA');

  const shown = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nprimary_button:\n  text: "Start writing free"\n{% endsection %}',
    SITE,
  );
  assert.ok(shown.includes('Start writing free'), 'absent enabled keeps the primary CTA (default-visible)');
  assert.deepEqual(warnings, []);
});

// ─── #435: ported stat cards ─────────────────────────────────────────────────

test('#435: hero cards render (count + content) and warn-free — ported stat cards survive', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ncards:\n'
    + '  - number: "99%"\n    label: Undetectable\n    icon: shield-check\n'
    + '  - number: "500K+"\n    label: Pieces created\n    icon: file-lines\n'
    + '  - number: "30+"\n    label: Languages\n'
    + '{% endsection %}',
    SITE,
  );
  assert.equal((html.match(/class="omega-hero__card"/g) || []).length, 3, 'one card per item');
  assert.ok(html.includes('99%') && html.includes('Undetectable'), 'number + label render');
  assert.ok(html.includes('500K+') && html.includes('Pieces created'), 'every item renders, not just the first');
  assert.ok(html.includes('30+') && html.includes('Languages'), 'an icon-less card renders too');
  assert.ok(html.includes('fa-shield-check'), 'optional icon rides the one fa-* mechanism');
  assert.deepEqual(warnings, [], 'cards is a declared arg — no unknown-arg warning');

  const without = await engine.parseAndRender('{% section "marketing/hero" %}', SITE);
  assert.ok(!without.includes('omega-hero__card'), 'no cards arg renders no card row (brand content, never a theme default)');
});

// ─── #437: the form demo type ────────────────────────────────────────────────

test('#437: demo type "form" renders the field cluster on the shipped showcase frame', async () => {
  const pages = await buildWith(miniData);
  const page = pages.get('/test/sections/marketing/hero/frames/form');
  assert.ok(page, 'the Form variant frame built');

  assert.ok(page.includes('Select industry'), 'select placeholder renders (the issue grep, now positive)');
  assert.ok(page.includes('<select') && page.includes('name="industry"'), 'select field rendered');
  assert.ok(page.includes('<textarea') && page.includes('name="message"'), 'textarea field rendered');
  assert.ok(page.includes('id="hero-demo-form"') && page.includes('data-form-state="initializing"'),
    'the FormManager contract markup rides the form lane');
  assert.ok(page.includes('data-redirect="/contact"'), 'the configurable action rides through');
  assert.ok(page.includes('We respond within 24 hours'), 'subtext still renders under the typed lane');

  // Accessibility: every control labeled, the submit button named.
  assert.ok(page.includes('for="hero-demo-industry"') && page.includes('id="hero-demo-industry"'),
    'select is labelled by a for/id pair');
  assert.ok(page.includes('for="hero-demo-message"') && page.includes('id="hero-demo-message"'),
    'textarea is labelled by a for/id pair');
  assert.ok(/<button type="submit"[^>]*>[\s\S]*?Get quote/.test(page), 'submit button carries its accessible name');
});

// ─── #475: demo.placement ────────────────────────────────────────────────────

test('#475: demo.placement side sets the demo BESIDE the copy', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  placement: side\n  options:\n'
    + '    placeholder: "Your work email"\n    button:\n      text: "Start free"\n'
    + '{% endsection %}',
    SITE,
  );

  assert.ok(html.includes('omega-hero--side'), 'the band carries the side modifier');
  assert.ok(html.includes('class="omega-hero__split"'), 'copy and demo share a split');
  assert.ok(html.includes('class="omega-hero__copy"'), 'the copy owns its column');

  const copyAt = html.indexOf('class="omega-hero__copy"');
  const demoAt = html.indexOf('class="omega-hero__demo"');
  assert.ok(copyAt > -1 && demoAt > copyAt, 'the copy column opens first, the demo column beside it');

  const copyColumn = html.slice(copyAt, demoAt);
  assert.ok(copyColumn.includes('omega-hero__ctas'), 'the CTAs stay with the copy');
  assert.ok(!copyColumn.includes('id="hero-demo-form"'), 'the demo is NOT under them');
  assert.ok(html.slice(demoAt).includes('id="hero-demo-form"'), 'the demo module renders in the demo column');
  assert.ok(html.includes('Your work email'), 'with the authored options');
  assert.ok(!html.includes('<div class="mt-4"'), 'and never also in the centred slot');
  assert.deepEqual(warnings, [], 'placement rides the declared demo object — no unknown-arg warning');
});

test('#475: the default placement keeps the demo centred under the CTAs', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  options:\n    placeholder: "Your work email"\n{% endsection %}',
    SITE,
  );

  assert.ok(!html.includes('omega-hero--side'), 'no modifier without the arg');
  assert.ok(!html.includes('omega-hero__split'), 'no split column');
  assert.ok(html.includes('<div class="mt-4"'), 'the centred demo slot is untouched');
  assert.ok(html.includes('id="hero-demo-form"'), 'and the demo still renders');
  assert.deepEqual(warnings, []);

  // side placement with no demo to place is not a layout: the copy stays whole.
  const empty = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ndemo:\n  placement: side\n{% endsection %}',
    SITE,
  );
  assert.ok(!empty.includes('omega-hero__split'), 'a disabled demo never splits the hero');
});

// ─── #476: button icon + class ───────────────────────────────────────────────

/** The one hero CTA anchor (open tag through close) carrying `text`. */
function ctaFor(html, text) {
  const anchors = html.match(/<a [^>]*class="btn [^"]*"[^>]*>[\s\S]*?<\/a>/g) || [];
  return anchors.find((anchor) => anchor.includes(text)) || null;
}

test('#476: an authored class replaces the default and an authored icon renders', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\n'
    + 'primary_button:\n  text: "Get started free"\n  href: /dashboard\n  icon: rocket\n  class: btn-light\n'
    + 'secondary_button:\n  enabled: true\n  text: "Explore solutions"\n  href: /pricing\n  icon: book-open\n  class: btn-outline-light\n'
    + '{% endsection %}',
    SITE,
  );

  const primary = ctaFor(html, 'Get started free');
  assert.ok(primary, 'the primary CTA rendered');
  assert.ok(primary.includes('class="btn btn-light btn-lg"'), `the authored class replaces btn-adaptive: ${primary}`);
  assert.ok(!primary.includes('btn-adaptive'), 'the hardcoded default is gone, not appended to');
  assert.ok(primary.includes('fa-rocket'), 'the icon rides the one native-markup mechanism');
  assert.ok(!primary.includes('omega-nudge'), 'an authored icon takes the arrow nudge\'s place — one glyph per button');

  const secondary = ctaFor(html, 'Explore solutions');
  assert.ok(secondary, 'the secondary CTA rendered');
  assert.ok(secondary.includes('class="btn btn-outline-light btn-lg"'), `same contract on the outline button: ${secondary}`);
  assert.ok(!secondary.includes('btn-outline-adaptive'), 'its default is replaced too');
  assert.ok(secondary.includes('fa-book-open'), 'its icon renders');
  assert.deepEqual(warnings, [], 'icon/class ride the declared button objects — no unknown-arg warning');
});

test('#476: no icon, no class — today\'s render, arrow nudge intact', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\n'
    + 'primary_button:\n  text: "Get started free"\n  href: /signup\n'
    + 'secondary_button:\n  enabled: true\n  text: "See pricing"\n  href: /pricing\n'
    + '{% endsection %}',
    SITE,
  );

  const primary = ctaFor(html, 'Get started free');
  assert.ok(primary.includes('class="btn btn-adaptive btn-lg omega-hover-nudge"'), `the shipped default class: ${primary}`);
  assert.ok(primary.includes('<span class="omega-nudge ms-2">'), 'the nudge span survives');
  assert.ok(primary.includes('fa-arrow-right'), 'with its arrow');

  const secondary = ctaFor(html, 'See pricing');
  assert.ok(secondary.includes('class="btn btn-outline-adaptive btn-lg omega-hover-nudge"'), `the outline default: ${secondary}`);
  assert.ok(secondary.includes('<span class="omega-nudge ms-2">'), 'and its nudge');
});

// ─── the headline's second line: authored accent over the default rotator ────

test('hero: an authored headline_accent wins over the default rotating words', async () => {
  const { engine, warnings } = makeEngine();
  const accented = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nheadline: "Ship your"\nheadline_accent: "next idea"\n{% endsection %}',
    SITE,
  );
  assert.ok(accented.includes('<em>next idea</em>'), `the authored accent renders: ${accented.slice(accented.indexOf('<h1'), accented.indexOf('</h1>'))}`);
  assert.ok(!accented.includes('omega-hero__rotator'), 'the theme\'s default rotator steps aside for it');
  assert.deepEqual(warnings, []);

  const untouched = await engine.parseAndRender('{% section "marketing/hero" %}', SITE);
  assert.ok(untouched.includes('omega-hero__rotator'), 'the default render is still the rotator');
  assert.ok(untouched.includes('<span>modern business</span>'), 'with its shipped words');

  const neither = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nheadline: "Ship your idea"\nrotating: []\n{% endsection %}',
    SITE,
  );
  assert.ok(!neither.includes('omega-hero__rotator'), 'an emptied rotator with no accent renders neither');
  assert.ok(!neither.includes('<em></em>'), 'and no empty accent in its place');
});

// ─── #486: the video demo type ───────────────────────────────────────────────

/** The one `<video>` open tag (attributes included) in a render. */
function videoTag(html) {
  const match = html.match(/<video[^>]*>/);
  return match ? match[0] : null;
}

test('#486: demo type "video" renders the lazy player under the CTAs', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
    + '    class: mw-lg\n    src: "https://cdn.example.com/demo.webm"\n'
    + '    autoplay: true\n    loop: true\n    muted: true\n    controls: false\n'
    + '    subtext: "No sound, autoplay on"\n{% endsection %}',
    SITE,
  );

  const video = videoTag(html);
  assert.ok(video, `the video lane renders a player: ${html.slice(0, 400)}`);
  assert.ok(html.includes('data-lazy="@src https://cdn.example.com/demo.webm"'),
    'the source rides the one lazy-media idiom (omega_video), never a bare src');
  assert.ok(html.includes('type="video/webm"'), 'with its mime type');
  assert.ok(html.includes('ratio ratio-16x9'), 'the player keeps its aspect box');
  assert.ok(html.includes('mw-lg'), 'the authored wrapper class rides through');
  assert.ok(video.includes('autoplay') && video.includes('loop') && video.includes('muted'),
    `the authored playback knobs land: ${video}`);
  assert.ok(video.includes('playsinline'), 'inline playback on mobile, never a takeover');
  assert.ok(!video.includes('controls'), 'controls: false is honored');
  assert.ok(html.includes('No sound, autoplay on'), 'subtext still renders under the typed lane');
  assert.deepEqual(warnings, [], 'the video lane rides the declared demo object — no unknown-arg warning');
});

test('#486 pre-ship: a non-autoplay video is muted only when the author says so', async () => {
  const { engine } = makeEngine();

  const off = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
    + '    src: "https://cdn.example.com/demo.mp4"\n    muted: false\n{% endsection %}',
    SITE,
  );
  const offTag = videoTag(off);
  assert.ok(offTag, 'the player renders');
  assert.ok(!offTag.includes('muted'), `authored muted: false carries no muted attribute: ${offTag}`);

  const plain = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
    + '    src: "https://cdn.example.com/demo.mp4"\n{% endsection %}',
    SITE,
  );
  const plainTag = videoTag(plain);
  assert.ok(!plainTag.includes('muted'), `an unauthored click-to-play video keeps its sound: ${plainTag}`);

  const on = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
    + '    src: "https://cdn.example.com/demo.mp4"\n    muted: true\n{% endsection %}',
    SITE,
  );
  assert.ok(videoTag(on).includes('muted'), 'an authored muted: true still lands');

  // Autoplay overrules the author: a hero never makes sound nobody asked for.
  const forced = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
    + '    src: "https://cdn.example.com/demo.mp4"\n    autoplay: true\n    muted: false\n{% endsection %}',
    SITE,
  );
  const forcedTag = videoTag(forced);
  assert.ok(forcedTag.includes('autoplay') && forcedTag.includes('muted'),
    `autoplay forces muted over an authored false: ${forcedTag}`);
});

test('#486 pre-ship: the input lane\'s copy and wrapper never leak onto another demo type', async () => {
  const { engine } = makeEngine();

  const video = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
    + '    src: "https://cdn.example.com/demo.mp4"\n{% endsection %}',
    SITE,
  );
  // The subtext paragraph is the demo module's own line (the hero's `meta` row
  // shares the class and carries the same words as a default bullet).
  assert.ok(!video.includes('omega-hero__meta justify-content-center'),
    'no subtext under a plain video — the email-capture copy is the input lane\'s, and brand content is never a theme\'s voice');
  assert.ok(!video.includes('mw-md'), 'and the input card\'s narrow wrapper never squeezes the player');

  // The input lane's own render is untouched: its width default lives inline.
  const input = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  options:\n'
    + '    placeholder: "Your work email"\n{% endsection %}',
    SITE,
  );
  assert.ok(input.includes('<div class="card mw-md mx-auto">'),
    `the input card keeps its default width: ${input.slice(input.indexOf('<div class="card'), input.indexOf('<div class="card') + 80)}`);
});

test('#486: an unauthored video plays nothing on its own — controls, no autoplay', async () => {
  const { engine } = makeEngine();
  const plain = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
    + '    src: "https://cdn.example.com/demo.mp4"\n{% endsection %}',
    SITE,
  );
  const plainTag = videoTag(plain);
  assert.ok(plainTag, 'the player renders');
  assert.ok(plainTag.includes('controls'), 'the visitor drives it: controls are the default');
  assert.ok(!plainTag.includes('autoplay'), 'no motion nobody asked for');

  // Autoplay is muted, always: an authored autoplay never brings sound with it.
  const noisy = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
    + '    src: "https://cdn.example.com/demo.mp4"\n    autoplay: true\n{% endsection %}',
    SITE,
  );
  const noisyTag = videoTag(noisy);
  assert.ok(noisyTag.includes('autoplay') && noisyTag.includes('muted'),
    `autoplay forces muted: ${noisyTag}`);
});

test('#486: the video demo renders in the side placement too, inside the demo column', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  placement: side\n  options:\n'
    + '    src: "https://cdn.example.com/demo.webm"\n    autoplay: true\n    loop: true\n    controls: false\n'
    + '{% endsection %}',
    SITE,
  );

  assert.ok(html.includes('omega-hero--side'), 'the band carries the side modifier');
  const demoAt = html.indexOf('class="omega-hero__demo"');
  assert.ok(demoAt > -1, 'the demo column opens');
  assert.ok(html.slice(demoAt).includes('<video'), 'the player renders in the demo column, not an empty box');
  assert.ok(html.slice(demoAt).includes('data-lazy="@src https://cdn.example.com/demo.webm"'), 'with its source');
  assert.deepEqual(warnings, []);
});

// ─── #496: the side demo IS the hero visual ──────────────────────────────────

test('#496: demo.placement side renders no centred visual, even an authored one', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nframe:\n  enabled: true\n  title: "ACME · Overview"\n'
    + 'demo:\n  enabled: true\n  type: video\n  placement: side\n  options:\n'
    + '    src: "https://cdn.example.com/demo.webm"\n{% endsection %}',
    SITE,
  );

  assert.ok(html.includes('omega-hero__split'), 'the side split renders');
  assert.ok(html.includes('<video'), 'the side demo IS the hero visual');
  assert.ok(!html.includes('omega-hero__frame'), 'and the centred frame is gone, even authored on');
  assert.ok(!html.includes('omega-mock'), 'the dashboard mock goes with it');
  assert.deepEqual(warnings, []);
});

test('#486: a CENTRED video demo suppresses the product frame too — a video IS the hero visual', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nframe:\n  enabled: true\n  title: "ACME · Overview"\n'
    + 'demo:\n  enabled: true\n  type: video\n  placement: bottom\n  options:\n'
    + '    src: "https://cdn.example.com/demo.webm"\n    autoplay: true\n    loop: true\n    muted: true\n    controls: false\n'
    + '{% endsection %}',
    SITE,
  );

  assert.ok(html.includes('<video'), 'the centred video renders');
  assert.ok(!html.includes('omega-hero--side'), 'centred, not side — the placement the veto is about');
  assert.ok(!html.includes('omega-hero__frame'), 'and the floating product frame never stacks under it, authored on or not');
  assert.ok(!html.includes('omega-mock'), 'the dashboard mock goes with it');
  assert.deepEqual(warnings, []);

  // Companion: this is the VIDEO rule, not a demo rule — every other typed
  // lane keeps the centred visual it has always had.
  const input = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nframe:\n  enabled: true\n'
    + 'demo:\n  enabled: true\n  options:\n    placeholder: "Your work email"\n{% endsection %}',
    SITE,
  );
  assert.ok(input.includes('id="hero-demo-form"'), 'the input demo renders');
  assert.ok(input.includes('omega-hero__frame'), 'and keeps its product frame');
  assert.ok(input.includes('omega-mock__topbar'), 'mock and all');
});

test('#496: the default placement keeps the centred frame', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  options:\n    placeholder: "Your work email"\n{% endsection %}',
    SITE,
  );
  assert.ok(html.includes('omega-hero__frame'), 'the shipped centred visual is untouched');
  assert.ok(html.includes('omega-mock__topbar'), 'with its dashboard mock');
});

test('#486 + #496: the shipped gallery frames — the video IS the visual, centred and beside', async () => {
  const pages = await buildWith(miniData);

  const centred = pages.get('/test/sections/marketing/hero/frames/video');
  assert.ok(centred, 'the Video variant frame built');
  assert.ok(centred.includes('<video'), 'the authored video type renders');
  assert.ok(centred.includes('sample-demo-1.webm'), 'with the source the variant asks for');
  assert.ok(centred.includes('<em>action</em>'), 'and its authored accent is live text, not dead words under the default rotator');
  assert.ok(!centred.includes('omega-hero__frame'), '#486: nothing stacks a product frame under a centred video');

  const side = pages.get('/test/sections/marketing/hero/frames/side-placement');
  assert.ok(side, 'the Side placement variant frame built');
  assert.ok(side.includes('omega-hero--side'), 'the side hero renders');
  const demoAt = side.indexOf('class="omega-hero__demo"');
  assert.ok(demoAt > -1, 'the demo column opens');
  assert.ok(side.slice(demoAt).includes('<video'), 'the side hero\'s visual is the video demo');
  assert.ok(!side.includes('omega-hero__frame'), '#496: and no centred visual beside it');
});

test('#476: the shipped gallery frame\'s legacy button args finally render', async () => {
  const pages = await buildWith(miniData);
  const page = pages.get('/test/sections/marketing/hero/frames/input-capture');
  assert.ok(page, 'the Input capture variant frame built');

  // Only the primary renders here: the section's secondary_button default is
  // enabled: false and the variant never turns it on (#438's contract).
  const primary = ctaFor(page, 'Get started free');
  assert.ok(primary, 'the variant\'s primary CTA rendered');
  assert.ok(primary.includes('class="btn btn-light btn-lg"'), `its authored class lands: ${primary}`);
  assert.ok(primary.includes('fa-rocket'), 'with the rocket the variant asks for');
  assert.ok(!primary.includes('omega-nudge'), 'and no arrow beside it');
  assert.ok(!page.includes('Explore solutions'), 'the authored secondary stays off — enabled is its own contract');
});

// ─── #500: the headline's level is an arg ────────────────────────────────────

test('#500: heading_level renders the headline at the authored level, same classes', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nheadline: "See it running"\nheadline_accent: "below"\nheading_level: 2\n{% endsection %}',
    SITE,
  );

  assert.ok(html.includes('<h2 class="omega-display omega-display--hero"'),
    `the band's headline is an h2, wearing the hero display classes: ${html.slice(html.indexOf('<h2'), html.indexOf('<h2') + 120)}`);
  assert.ok(html.includes('</h2>'), 'and it closes at the same level');
  assert.ok(!html.includes('<h1'), 'no h1 anywhere in the band');
  assert.ok(html.includes('See it running') && html.includes('<em>below</em>'), 'the copy is untouched');
  assert.deepEqual(warnings, [], 'heading_level is a declared arg — no unknown-arg warning');
});

test('#500: the default is h1 — an unauthored hero is unchanged', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender('{% section "marketing/hero" %}', SITE);

  assert.ok(html.includes('<h1 class="omega-display omega-display--hero"'), 'the shipped hero still opens the page');
  assert.ok(!html.includes('<h2 class="omega-display omega-display--hero"'), 'and never demotes itself');
});

test('#500: the two-instance composition (#496) ships exactly ONE h1', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nheadline: "One stack for"\nheadline_accent: "every surface"\n'
    + 'demo:\n  enabled: true\n  type: video\n  placement: side\n  options:\n    src: "https://cdn.example.com/demo.webm"\n'
    + '{% endsection %}\n'
    + '{% section "marketing/hero" %}\nheading_level: 2\nheadline: "The dashboard,"\nheadline_accent: "below the fold"\n'
    + 'badge:\n  text: ""\nprimary_button:\n  enabled: false\nmeta: []\n{% endsection %}',
    SITE,
  );

  assert.strictEqual((html.match(/<h1[\s>]/g) || []).length, 1, 'the page opens on one h1, not two');
  assert.strictEqual((html.match(/<h2[\s>]/g) || []).length, 1, 'the below-fold band takes h2');
  assert.ok(html.includes('One stack for') && html.includes('The dashboard,'), 'both bands render');
});

// ─── #513: the breadcrumb trail ──────────────────────────────────────────────

/** The one breadcrumb nav (open tag through close) in a render. */
function breadcrumbNav(html) {
  const match = html.match(/<nav [^>]*aria-label="Breadcrumb"[^>]*>[\s\S]*?<\/nav>/);
  return match ? match[0] : null;
}

test('#513: the breadcrumb arg renders a labeled trail, current page unlinked', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nbreadcrumb:\n'
    + '  - label: Home\n    href: /\n'
    + '  - label: Industries\n    href: /industries\n'
    + '  - label: HVAC\n    href: /industries/hvac\n'
    + 'headline: "HVAC teams ship with"\nheadline_accent: "ACME"\n{% endsection %}',
    SITE,
  );

  const nav = breadcrumbNav(html);
  assert.ok(nav, `the trail renders in a labeled nav: ${html.slice(0, 400)}`);
  assert.ok(nav.includes('href="/"') && nav.includes('>Home<'), 'the first crumb links');
  assert.ok(nav.includes('href="/industries"') && nav.includes('>Industries<'), 'so does the middle one');
  assert.ok(nav.includes('HVAC'), 'the current page is in the trail');
  assert.ok(!nav.includes('href="/industries/hvac"'), 'but it is NOT a link — it is the page you are on');
  assert.ok(nav.includes('aria-current="page"'), 'and it says so');

  // Above the headline cluster, not below it.
  assert.ok(html.indexOf('aria-label="Breadcrumb"') < html.indexOf('omega-display--hero'),
    'the trail sits above the headline cluster');
  assert.deepEqual(warnings, [], 'breadcrumb is a declared arg — no unknown-arg warning');
});

test('#513: no breadcrumb arg renders nothing — zero change to existing pages', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender('{% section "marketing/hero" %}', SITE);

  assert.strictEqual(breadcrumbNav(html), null, 'no nav');
  assert.ok(!html.includes('Breadcrumb'), 'and no trace of the mechanism');

  const emptied = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nbreadcrumb: []\n{% endsection %}',
    SITE,
  );
  assert.strictEqual(breadcrumbNav(emptied), null, 'an emptied trail renders nothing either');
});

test('#513: the shipped gallery frame renders the trail', async () => {
  const pages = await buildWith(miniData);
  const page = pages.get('/test/sections/marketing/hero/frames/breadcrumb');
  assert.ok(page, 'the Breadcrumb variant frame built');
  assert.ok(page.includes('aria-label="Breadcrumb"'), 'with its labeled nav');
  assert.ok(page.includes('aria-current="page"'), 'and the current page unlinked');
});
