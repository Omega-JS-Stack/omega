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
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
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

// ─── #476: button icon + class ───────────────────────────────────────────────

/** The one hero CTA anchor (open tag through close) carrying `text`. */
function ctaFor(html, text) {
  const anchors = html.match(/<a [^>]*class="btn [^"]*"[^>]*>[\s\S]*?<\/a>/g) || [];
  return anchors.find((anchor) => anchor.includes(text)) || null;
}

// ─── #486: the video demo type ───────────────────────────────────────────────

/** The one `<video>` open tag (attributes included) in a render. */
function videoTag(html) {
  const match = html.match(/<video[^>]*>/);
  return match ? match[0] : null;
}

// ─── #513: the breadcrumb trail ──────────────────────────────────────────────

/** The one breadcrumb nav (open tag through close) in a render. */
function breadcrumbNav(html) {
  const match = html.match(/<nav [^>]*aria-label="Breadcrumb"[^>]*>[\s\S]*?<\/nav>/);
  return match ? match[0] : null;
}

module.exports = defineCases({
  type: 'group',
  description: 'sections-hero',
  tests: [
    // ─── #438: one enabled contract for both CTA buttons ─────────────────────────

    {
      name: '#438: primary_button.enabled false hides it; absent enabled keeps it visible',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const hidden = await engine.parseAndRender(
          '{% section "marketing/hero" %}\nprimary_button:\n  enabled: false\n  text: "Start writing free"\n{% endsection %}',
          SITE,
        );
        ctx.expect(!hidden.includes('Start writing free'), 'enabled: false suppresses the primary CTA').toBeTruthy();

        const shown = await engine.parseAndRender(
          '{% section "marketing/hero" %}\nprimary_button:\n  text: "Start writing free"\n{% endsection %}',
          SITE,
        );
        ctx.expect(shown.includes('Start writing free'), 'absent enabled keeps the primary CTA (default-visible)').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    // ─── #435: ported stat cards ─────────────────────────────────────────────────

    {
      name: '#435: hero cards render (count + content) and warn-free — ported stat cards survive',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ncards:\n'
          + '  - number: "99%"\n    label: Undetectable\n    icon: fa-solid fa-shield-check\n'
          + '  - number: "500K+"\n    label: Pieces created\n    icon: fa-solid fa-file-lines\n'
          + '  - number: "30+"\n    label: Languages\n'
          + '{% endsection %}',
          SITE,
        );
        ctx.expect((html.match(/class="omega-hero__card"/g) || []).length, 'one card per item').toBe(3);
        ctx.expect(html.includes('99%') && html.includes('Undetectable'), 'number + label render').toBeTruthy();
        ctx.expect(html.includes('500K+') && html.includes('Pieces created'), 'every item renders, not just the first').toBeTruthy();
        ctx.expect(html.includes('30+') && html.includes('Languages'), 'an icon-less card renders too').toBeTruthy();
        ctx.expect(html.includes('fa-shield-check'), 'optional icon rides the one fa-* mechanism').toBeTruthy();
        ctx.expect(warnings, 'cards is a declared arg — no unknown-arg warning').toEqual([]);

        const without = await engine.parseAndRender('{% section "marketing/hero" %}', SITE);
        ctx.expect(!without.includes('omega-hero__card'), 'no cards arg renders no card row (brand content, never a theme default)').toBeTruthy();
      },
    },

    // ─── #437: the form demo type ────────────────────────────────────────────────

    {
      name: '#437: demo type "form" renders the field cluster on the shipped showcase frame',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const page = pages.get('/test/sections/marketing/hero/frames/form');
        ctx.expect(page, 'the Form variant frame built').toBeTruthy();

        ctx.expect(page.includes('Select industry'), 'select placeholder renders (the issue grep, now positive)').toBeTruthy();
        ctx.expect(page.includes('<select') && page.includes('name="industry"'), 'select field rendered').toBeTruthy();
        ctx.expect(page.includes('<textarea') && page.includes('name="message"'), 'textarea field rendered').toBeTruthy();
        ctx.expect(page.includes('id="hero-demo-form"') && page.includes('data-form-state="initializing"'), 'the FormManager contract markup rides the form lane').toBeTruthy();
        ctx.expect(page.includes('data-redirect="/contact"'), 'the configurable action rides through').toBeTruthy();
        ctx.expect(page.includes('We respond within 24 hours'), 'subtext still renders under the typed lane').toBeTruthy();

        // Accessibility: every control labeled, the submit button named.
        ctx.expect(page.includes('for="hero-demo-industry"') && page.includes('id="hero-demo-industry"'), 'select is labelled by a for/id pair').toBeTruthy();
        ctx.expect(page.includes('for="hero-demo-message"') && page.includes('id="hero-demo-message"'), 'textarea is labelled by a for/id pair').toBeTruthy();
        ctx.expect(/<button type="submit"[^>]*>[\s\S]*?Get quote/.test(page), 'submit button carries its accessible name').toBeTruthy();
      },
    },

    // ─── #475: demo.placement ────────────────────────────────────────────────────

    {
      name: '#475: demo.placement side sets the demo BESIDE the copy',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  placement: side\n  options:\n'
          + '    placeholder: "Your work email"\n    button:\n      text: "Start free"\n'
          + '{% endsection %}',
          SITE,
        );

        ctx.expect(html.includes('omega-hero--side'), 'the band carries the side modifier').toBeTruthy();
        ctx.expect(html.includes('class="omega-hero__split"'), 'copy and demo share a split').toBeTruthy();
        ctx.expect(html.includes('class="omega-hero__copy"'), 'the copy owns its column').toBeTruthy();

        const copyAt = html.indexOf('class="omega-hero__copy"');
        const demoAt = html.indexOf('class="omega-hero__demo"');
        ctx.expect(copyAt > -1 && demoAt > copyAt, 'the copy column opens first, the demo column beside it').toBeTruthy();

        const copyColumn = html.slice(copyAt, demoAt);
        ctx.expect(copyColumn.includes('omega-hero__ctas'), 'the CTAs stay with the copy').toBeTruthy();
        ctx.expect(!copyColumn.includes('id="hero-demo-form"'), 'the demo is NOT under them').toBeTruthy();
        ctx.expect(html.slice(demoAt).includes('id="hero-demo-form"'), 'the demo module renders in the demo column').toBeTruthy();
        ctx.expect(html.includes('Your work email'), 'with the authored options').toBeTruthy();
        ctx.expect(!html.includes('<div class="mt-4"'), 'and never also in the centred slot').toBeTruthy();
        ctx.expect(warnings, 'placement rides the declared demo object — no unknown-arg warning').toEqual([]);
      },
    },

    {
      name: '#475: the default placement keeps the demo centred under the CTAs',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  options:\n    placeholder: "Your work email"\n{% endsection %}',
          SITE,
        );

        ctx.expect(!html.includes('omega-hero--side'), 'no modifier without the arg').toBeTruthy();
        ctx.expect(!html.includes('omega-hero__split'), 'no split column').toBeTruthy();
        ctx.expect(html.includes('<div class="mt-4"'), 'the centred demo slot is untouched').toBeTruthy();
        ctx.expect(html.includes('id="hero-demo-form"'), 'and the demo still renders').toBeTruthy();
        ctx.expect(warnings).toEqual([]);

        // side placement with no demo to place is not a layout: the copy stays whole.
        const empty = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ndemo:\n  placement: side\n{% endsection %}',
          SITE,
        );
        ctx.expect(!empty.includes('omega-hero__split'), 'a disabled demo never splits the hero').toBeTruthy();
      },
    },

    {
      name: '#476: an authored class replaces the default and an authored icon renders',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero" %}\n'
          + 'primary_button:\n  text: "Get started free"\n  href: /dashboard\n  icon: fa-solid fa-rocket\n  class: btn-light\n'
          + 'secondary_button:\n  enabled: true\n  text: "Explore solutions"\n  href: /pricing\n  icon: fa-solid fa-book-open\n  class: btn-outline-light\n'
          + '{% endsection %}',
          SITE,
        );

        const primary = ctaFor(html, 'Get started free');
        ctx.expect(primary, 'the primary CTA rendered').toBeTruthy();
        ctx.expect(primary.includes('class="btn btn-light btn-lg"'), `the authored class replaces btn-adaptive: ${primary}`).toBeTruthy();
        ctx.expect(!primary.includes('btn-adaptive'), 'the hardcoded default is gone, not appended to').toBeTruthy();
        ctx.expect(primary.includes('fa-rocket'), 'the icon rides the one native-markup mechanism').toBeTruthy();
        ctx.expect(!primary.includes('omega-nudge'), 'an authored icon takes the arrow nudge\'s place — one glyph per button').toBeTruthy();

        const secondary = ctaFor(html, 'Explore solutions');
        ctx.expect(secondary, 'the secondary CTA rendered').toBeTruthy();
        ctx.expect(secondary.includes('class="btn btn-outline-light btn-lg"'), `same contract on the outline button: ${secondary}`).toBeTruthy();
        ctx.expect(!secondary.includes('btn-outline-adaptive'), 'its default is replaced too').toBeTruthy();
        ctx.expect(secondary.includes('fa-book-open'), 'its icon renders').toBeTruthy();
        ctx.expect(warnings, 'icon/class ride the declared button objects — no unknown-arg warning').toEqual([]);
      },
    },

    {
      name: '#476: no icon, no class — today\'s render, arrow nudge intact',
      run: async (ctx) => {
        const { engine } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero" %}\n'
          + 'primary_button:\n  text: "Get started free"\n  href: /signup\n'
          + 'secondary_button:\n  enabled: true\n  text: "See pricing"\n  href: /pricing\n'
          + '{% endsection %}',
          SITE,
        );

        const primary = ctaFor(html, 'Get started free');
        ctx.expect(primary.includes('class="btn btn-adaptive btn-lg omega-hover-nudge"'), `the shipped default class: ${primary}`).toBeTruthy();
        ctx.expect(primary.includes('<span class="omega-nudge ms-2">'), 'the nudge span survives').toBeTruthy();
        ctx.expect(primary.includes('fa-arrow-right'), 'with its arrow').toBeTruthy();

        const secondary = ctaFor(html, 'See pricing');
        ctx.expect(secondary.includes('class="btn btn-outline-adaptive btn-lg omega-hover-nudge"'), `the outline default: ${secondary}`).toBeTruthy();
        ctx.expect(secondary.includes('<span class="omega-nudge ms-2">'), 'and its nudge').toBeTruthy();
      },
    },

    // ─── the headline's second line: authored accent over the default rotator ────

    {
      name: 'hero: an authored headline_accent wins over the default rotating words',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const accented = await engine.parseAndRender(
          '{% section "marketing/hero" %}\nheadline: "Ship your"\nheadline_accent: "next idea"\n{% endsection %}',
          SITE,
        );
        ctx.expect(accented.includes('<em>next idea</em>'), `the authored accent renders: ${accented.slice(accented.indexOf('<h1'), accented.indexOf('</h1>'))}`).toBeTruthy();
        ctx.expect(!accented.includes('omega-hero__rotator'), 'the theme\'s default rotator steps aside for it').toBeTruthy();
        ctx.expect(warnings).toEqual([]);

        const untouched = await engine.parseAndRender('{% section "marketing/hero" %}', SITE);
        ctx.expect(untouched.includes('omega-hero__rotator'), 'the default render is still the rotator').toBeTruthy();
        ctx.expect(untouched.includes('<span>modern business</span>'), 'with its shipped words').toBeTruthy();

        const neither = await engine.parseAndRender(
          '{% section "marketing/hero" %}\nheadline: "Ship your idea"\nrotating: []\n{% endsection %}',
          SITE,
        );
        ctx.expect(!neither.includes('omega-hero__rotator'), 'an emptied rotator with no accent renders neither').toBeTruthy();
        ctx.expect(!neither.includes('<em></em>'), 'and no empty accent in its place').toBeTruthy();
      },
    },

    {
      name: '#486: demo type "video" renders the lazy player under the CTAs',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
          + '    class: mw-lg\n    src: "https://cdn.example.com/demo.webm"\n'
          + '    autoplay: true\n    loop: true\n    muted: true\n    controls: false\n'
          + '    subtext: "No sound, autoplay on"\n{% endsection %}',
          SITE,
        );

        const video = videoTag(html);
        ctx.expect(video, `the video lane renders a player: ${html.slice(0, 400)}`).toBeTruthy();
        ctx.expect(html.includes('data-lazy="@src https://cdn.example.com/demo.webm"'), 'the source rides the one lazy-media idiom (omega_video), never a bare src').toBeTruthy();
        ctx.expect(html.includes('type="video/webm"'), 'with its mime type').toBeTruthy();
        ctx.expect(html.includes('ratio ratio-16x9'), 'the player keeps its aspect box').toBeTruthy();
        ctx.expect(html.includes('mw-lg'), 'the authored wrapper class rides through').toBeTruthy();
        ctx.expect(video.includes('autoplay') && video.includes('loop') && video.includes('muted'), `the authored playback knobs land: ${video}`).toBeTruthy();
        ctx.expect(video.includes('playsinline'), 'inline playback on mobile, never a takeover').toBeTruthy();
        ctx.expect(!video.includes('controls'), 'controls: false is honored').toBeTruthy();
        ctx.expect(html.includes('No sound, autoplay on'), 'subtext still renders under the typed lane').toBeTruthy();
        ctx.expect(warnings, 'the video lane rides the declared demo object — no unknown-arg warning').toEqual([]);
      },
    },

    {
      name: '#486 pre-ship: a non-autoplay video is muted only when the author says so',
      run: async (ctx) => {
        const { engine } = makeEngine();

        const off = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
          + '    src: "https://cdn.example.com/demo.mp4"\n    muted: false\n{% endsection %}',
          SITE,
        );
        const offTag = videoTag(off);
        ctx.expect(offTag, 'the player renders').toBeTruthy();
        ctx.expect(!offTag.includes('muted'), `authored muted: false carries no muted attribute: ${offTag}`).toBeTruthy();

        const plain = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
          + '    src: "https://cdn.example.com/demo.mp4"\n{% endsection %}',
          SITE,
        );
        const plainTag = videoTag(plain);
        ctx.expect(!plainTag.includes('muted'), `an unauthored click-to-play video keeps its sound: ${plainTag}`).toBeTruthy();

        const on = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
          + '    src: "https://cdn.example.com/demo.mp4"\n    muted: true\n{% endsection %}',
          SITE,
        );
        ctx.expect(videoTag(on).includes('muted'), 'an authored muted: true still lands').toBeTruthy();

        // Autoplay overrules the author: a hero never makes sound nobody asked for.
        const forced = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
          + '    src: "https://cdn.example.com/demo.mp4"\n    autoplay: true\n    muted: false\n{% endsection %}',
          SITE,
        );
        const forcedTag = videoTag(forced);
        ctx.expect(forcedTag.includes('autoplay') && forcedTag.includes('muted'), `autoplay forces muted over an authored false: ${forcedTag}`).toBeTruthy();
      },
    },

    {
      name: '#486 pre-ship: the input lane\'s copy and wrapper never leak onto another demo type',
      run: async (ctx) => {
        const { engine } = makeEngine();

        const video = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
          + '    src: "https://cdn.example.com/demo.mp4"\n{% endsection %}',
          SITE,
        );
        // The subtext paragraph is the demo module's own line (the hero's `meta` row
        // shares the class and carries the same words as a default bullet).
        ctx.expect(!video.includes('omega-hero__meta justify-content-center'), 'no subtext under a plain video — the email-capture copy is the input lane\'s, and brand content is never a theme\'s voice').toBeTruthy();
        ctx.expect(!video.includes('mw-md'), 'and the input card\'s narrow wrapper never squeezes the player').toBeTruthy();

        // The input lane's own render is untouched: its width default lives inline.
        const input = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  options:\n'
          + '    placeholder: "Your work email"\n{% endsection %}',
          SITE,
        );
        ctx.expect(input.includes('<div class="card mw-md mx-auto">'), `the input card keeps its default width: ${input.slice(input.indexOf('<div class="card'), input.indexOf('<div class="card') + 80)}`).toBeTruthy();
      },
    },

    {
      name: '#486: an unauthored video plays nothing on its own — controls, no autoplay',
      run: async (ctx) => {
        const { engine } = makeEngine();
        const plain = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
          + '    src: "https://cdn.example.com/demo.mp4"\n{% endsection %}',
          SITE,
        );
        const plainTag = videoTag(plain);
        ctx.expect(plainTag, 'the player renders').toBeTruthy();
        ctx.expect(plainTag.includes('controls'), 'the visitor drives it: controls are the default').toBeTruthy();
        ctx.expect(!plainTag.includes('autoplay'), 'no motion nobody asked for').toBeTruthy();

        // Autoplay is muted, always: an authored autoplay never brings sound with it.
        const noisy = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  options:\n'
          + '    src: "https://cdn.example.com/demo.mp4"\n    autoplay: true\n{% endsection %}',
          SITE,
        );
        const noisyTag = videoTag(noisy);
        ctx.expect(noisyTag.includes('autoplay') && noisyTag.includes('muted'), `autoplay forces muted: ${noisyTag}`).toBeTruthy();
      },
    },

    {
      name: '#486: the video demo renders in the side placement too, inside the demo column',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  type: video\n  placement: side\n  options:\n'
          + '    src: "https://cdn.example.com/demo.webm"\n    autoplay: true\n    loop: true\n    controls: false\n'
          + '{% endsection %}',
          SITE,
        );

        ctx.expect(html.includes('omega-hero--side'), 'the band carries the side modifier').toBeTruthy();
        const demoAt = html.indexOf('class="omega-hero__demo"');
        ctx.expect(demoAt > -1, 'the demo column opens').toBeTruthy();
        ctx.expect(html.slice(demoAt).includes('<video'), 'the player renders in the demo column, not an empty box').toBeTruthy();
        ctx.expect(html.slice(demoAt).includes('data-lazy="@src https://cdn.example.com/demo.webm"'), 'with its source').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    // ─── #496: the side demo IS the hero visual ──────────────────────────────────

    {
      name: '#496: demo.placement side renders no centred visual, even an authored one',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero" %}\nframe:\n  enabled: true\n  title: "ACME · Overview"\n'
          + 'demo:\n  enabled: true\n  type: video\n  placement: side\n  options:\n'
          + '    src: "https://cdn.example.com/demo.webm"\n{% endsection %}',
          SITE,
        );

        ctx.expect(html.includes('omega-hero__split'), 'the side split renders').toBeTruthy();
        ctx.expect(html.includes('<video'), 'the side demo IS the hero visual').toBeTruthy();
        ctx.expect(!html.includes('omega-hero__frame'), 'and the centred frame is gone, even authored on').toBeTruthy();
        ctx.expect(!html.includes('omega-mock'), 'the dashboard mock goes with it').toBeTruthy();
        ctx.expect(warnings).toEqual([]);
      },
    },

    {
      name: '#486: a CENTRED video demo suppresses the product frame too — a video IS the hero visual',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero" %}\nframe:\n  enabled: true\n  title: "ACME · Overview"\n'
          + 'demo:\n  enabled: true\n  type: video\n  placement: bottom\n  options:\n'
          + '    src: "https://cdn.example.com/demo.webm"\n    autoplay: true\n    loop: true\n    muted: true\n    controls: false\n'
          + '{% endsection %}',
          SITE,
        );

        ctx.expect(html.includes('<video'), 'the centred video renders').toBeTruthy();
        ctx.expect(!html.includes('omega-hero--side'), 'centred, not side — the placement the veto is about').toBeTruthy();
        ctx.expect(!html.includes('omega-hero__frame'), 'and the floating product frame never stacks under it, authored on or not').toBeTruthy();
        ctx.expect(!html.includes('omega-mock'), 'the dashboard mock goes with it').toBeTruthy();
        ctx.expect(warnings).toEqual([]);

        // Companion: this is the VIDEO rule, not a demo rule — every other typed
        // lane keeps the centred visual it has always had.
        const input = await engine.parseAndRender(
          '{% section "marketing/hero" %}\nframe:\n  enabled: true\n'
          + 'demo:\n  enabled: true\n  options:\n    placeholder: "Your work email"\n{% endsection %}',
          SITE,
        );
        ctx.expect(input.includes('id="hero-demo-form"'), 'the input demo renders').toBeTruthy();
        ctx.expect(input.includes('omega-hero__frame'), 'and keeps its product frame').toBeTruthy();
        ctx.expect(input.includes('omega-mock__topbar'), 'mock and all').toBeTruthy();
      },
    },

    {
      name: '#496: the default placement keeps the centred frame',
      run: async (ctx) => {
        const { engine } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero" %}\ndemo:\n  enabled: true\n  options:\n    placeholder: "Your work email"\n{% endsection %}',
          SITE,
        );
        ctx.expect(html.includes('omega-hero__frame'), 'the shipped centred visual is untouched').toBeTruthy();
        ctx.expect(html.includes('omega-mock__topbar'), 'with its dashboard mock').toBeTruthy();
      },
    },

    {
      name: '#486 + #496: the shipped gallery frames — the video IS the visual, centred and beside',
      run: async (ctx) => {
        const pages = await buildWith(miniData);

        const centred = pages.get('/test/sections/marketing/hero/frames/video');
        ctx.expect(centred, 'the Video variant frame built').toBeTruthy();
        ctx.expect(centred.includes('<video'), 'the authored video type renders').toBeTruthy();
        ctx.expect(centred.includes('sample-demo-1.webm'), 'with the source the variant asks for').toBeTruthy();
        ctx.expect(centred.includes('<em>action</em>'), 'and its authored accent is live text, not dead words under the default rotator').toBeTruthy();
        ctx.expect(!centred.includes('omega-hero__frame'), '#486: nothing stacks a product frame under a centred video').toBeTruthy();

        const side = pages.get('/test/sections/marketing/hero/frames/side-placement');
        ctx.expect(side, 'the Side placement variant frame built').toBeTruthy();
        ctx.expect(side.includes('omega-hero--side'), 'the side hero renders').toBeTruthy();
        const demoAt = side.indexOf('class="omega-hero__demo"');
        ctx.expect(demoAt > -1, 'the demo column opens').toBeTruthy();
        ctx.expect(side.slice(demoAt).includes('<video'), 'the side hero\'s visual is the video demo').toBeTruthy();
        ctx.expect(!side.includes('omega-hero__frame'), '#496: and no centred visual beside it').toBeTruthy();
      },
    },

    {
      name: '#476: the shipped gallery frame\'s legacy button args finally render',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const page = pages.get('/test/sections/marketing/hero/frames/input-capture');
        ctx.expect(page, 'the Input capture variant frame built').toBeTruthy();

        // Only the primary renders here: the section's secondary_button default is
        // enabled: false and the variant never turns it on (#438's contract).
        const primary = ctaFor(page, 'Get started free');
        ctx.expect(primary, 'the variant\'s primary CTA rendered').toBeTruthy();
        ctx.expect(primary.includes('class="btn btn-light btn-lg"'), `its authored class lands: ${primary}`).toBeTruthy();
        ctx.expect(primary.includes('fa-rocket'), 'with the rocket the variant asks for').toBeTruthy();
        ctx.expect(!primary.includes('omega-nudge'), 'and no arrow beside it').toBeTruthy();
        ctx.expect(!page.includes('Explore solutions'), 'the authored secondary stays off — enabled is its own contract').toBeTruthy();
      },
    },

    // ─── #500: the headline's level is an arg ────────────────────────────────────

    {
      name: '#500: heading_level renders the headline at the authored level, same classes',
      run: async (ctx) => {
        const { engine, warnings } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero" %}\nheadline: "See it running"\nheadline_accent: "below"\nheading_level: 2\n{% endsection %}',
          SITE,
        );

        ctx.expect(html.includes('<h2 class="omega-display omega-display--hero"'), `the band's headline is an h2, wearing the hero display classes: ${html.slice(html.indexOf('<h2'), html.indexOf('<h2') + 120)}`).toBeTruthy();
        ctx.expect(html.includes('</h2>'), 'and it closes at the same level').toBeTruthy();
        ctx.expect(!html.includes('<h1'), 'no h1 anywhere in the band').toBeTruthy();
        ctx.expect(html.includes('See it running') && html.includes('<em>below</em>'), 'the copy is untouched').toBeTruthy();
        ctx.expect(warnings, 'heading_level is a declared arg — no unknown-arg warning').toEqual([]);
      },
    },

    {
      name: '#500: the default is h1 — an unauthored hero is unchanged',
      run: async (ctx) => {
        const { engine } = makeEngine();
        const html = await engine.parseAndRender('{% section "marketing/hero" %}', SITE);

        ctx.expect(html.includes('<h1 class="omega-display omega-display--hero"'), 'the shipped hero still opens the page').toBeTruthy();
        ctx.expect(!html.includes('<h2 class="omega-display omega-display--hero"'), 'and never demotes itself').toBeTruthy();
      },
    },

    {
      name: '#500: the two-instance composition (#496) ships exactly ONE h1',
      run: async (ctx) => {
        const { engine } = makeEngine();
        const html = await engine.parseAndRender(
          '{% section "marketing/hero" %}\nheadline: "One stack for"\nheadline_accent: "every surface"\n'
          + 'demo:\n  enabled: true\n  type: video\n  placement: side\n  options:\n    src: "https://cdn.example.com/demo.webm"\n'
          + '{% endsection %}\n'
          + '{% section "marketing/hero" %}\nheading_level: 2\nheadline: "The dashboard,"\nheadline_accent: "below the fold"\n'
          + 'badge:\n  text: ""\nprimary_button:\n  enabled: false\nmeta: []\n{% endsection %}',
          SITE,
        );

        ctx.expect((html.match(/<h1[\s>]/g) || []).length, 'the page opens on one h1, not two').toBe(1);
        ctx.expect((html.match(/<h2[\s>]/g) || []).length, 'the below-fold band takes h2').toBe(1);
        ctx.expect(html.includes('One stack for') && html.includes('The dashboard,'), 'both bands render').toBeTruthy();
      },
    },

    {
      name: '#513: the breadcrumb arg renders a labeled trail, current page unlinked',
      run: async (ctx) => {
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
        ctx.expect(nav, `the trail renders in a labeled nav: ${html.slice(0, 400)}`).toBeTruthy();
        ctx.expect(nav.includes('href="/"') && nav.includes('>Home<'), 'the first crumb links').toBeTruthy();
        ctx.expect(nav.includes('href="/industries"') && nav.includes('>Industries<'), 'so does the middle one').toBeTruthy();
        ctx.expect(nav.includes('HVAC'), 'the current page is in the trail').toBeTruthy();
        ctx.expect(!nav.includes('href="/industries/hvac"'), 'but it is NOT a link — it is the page you are on').toBeTruthy();
        ctx.expect(nav.includes('aria-current="page"'), 'and it says so').toBeTruthy();

        // Above the headline cluster, not below it.
        ctx.expect(html.indexOf('aria-label="Breadcrumb"') < html.indexOf('omega-display--hero'), 'the trail sits above the headline cluster').toBeTruthy();
        ctx.expect(warnings, 'breadcrumb is a declared arg — no unknown-arg warning').toEqual([]);
      },
    },

    {
      name: '#513: no breadcrumb arg renders nothing — zero change to existing pages',
      run: async (ctx) => {
        const { engine } = makeEngine();
        const html = await engine.parseAndRender('{% section "marketing/hero" %}', SITE);

        ctx.expect(breadcrumbNav(html), 'no nav').toBe(null);
        ctx.expect(!html.includes('Breadcrumb'), 'and no trace of the mechanism').toBeTruthy();

        const emptied = await engine.parseAndRender(
          '{% section "marketing/hero" %}\nbreadcrumb: []\n{% endsection %}',
          SITE,
        );
        ctx.expect(breadcrumbNav(emptied), 'an emptied trail renders nothing either').toBe(null);
      },
    },

    {
      name: '#513: the shipped gallery frame renders the trail',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const page = pages.get('/test/sections/marketing/hero/frames/breadcrumb');
        ctx.expect(page, 'the Breadcrumb variant frame built').toBeTruthy();
        ctx.expect(page.includes('aria-label="Breadcrumb"'), 'with its labeled nav').toBeTruthy();
        ctx.expect(page.includes('aria-current="page"'), 'and the current page unlinked').toBeTruthy();
      },
    },
  ],
});
