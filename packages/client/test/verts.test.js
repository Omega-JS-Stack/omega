const { describe, it, before } = require('node:test');
const { getManager, TEST_CONFIG, assert } = require('./helpers.js');

// Config with an in-house source + company layer for source resolution
const ADS_CONFIG = {
  ...TEST_CONFIG,
  company: { url: 'https://parentco.example.com' },
  advertising: {
    providers: {
      inhouse: { source: 'https://verts.example.com/' },
    },
    fallback: 'inhouse',
    tags: ['music', 'audio-tools'],
  },
};

// A minimal host element the module can mount into (the shared setup's
// createElement mock supplies the iframe side)
function makeHost() {
  const styles = {};
  return {
    children: [],
    styles,
    appendChild(child) { this.children.push(child); },
    querySelector: () => null,
    style: {
      setProperty: (key, value) => { styles[key] = value; },
      removeProperty: (key) => { delete styles[key]; },
    },
  };
}

let vertsModule;

describe('Verts Module', () => {

  before(async () => {
    vertsModule = await import('../src/modules/verts.js');
    await getManager().initialize(ADS_CONFIG);
  });

  describe('module surface', () => {
    it('should hang off the singleton as verts()', () => {
      const verts = getManager().verts();
      assert(typeof verts.render === 'function');
      assert(typeof verts.renderHouse === 'function');
      assert(typeof verts.resolveSource === 'function');
    });
  });

  describe('size + clamp helpers', () => {
    it('resolveSizePx resolves presets from the one table', () => {
      assert.strictEqual(vertsModule.resolveSizePx('banner'), 150);
      assert.strictEqual(vertsModule.resolveSizePx('leaderboard'), 90);
      assert.strictEqual(vertsModule.resolveSizePx('rectangle'), 250);
      assert.strictEqual(vertsModule.resolveSizePx('large-rectangle'), 600);
      assert.strictEqual(vertsModule.resolveSizePx('skyscraper'), 600);
    });

    it('resolveSizePx accepts raw px and rejects junk', () => {
      assert.strictEqual(vertsModule.resolveSizePx('300'), 300);
      assert.strictEqual(vertsModule.resolveSizePx(''), null);
      assert.strictEqual(vertsModule.resolveSizePx('huge'), null);
      assert.strictEqual(vertsModule.resolveSizePx('-5'), null);
    });

    it('clampHeight clamps to the unit max and the global ceiling', () => {
      assert.strictEqual(vertsModule.clampHeight(120, 250), 120);
      assert.strictEqual(vertsModule.clampHeight(9000, 250), 250);
      assert.strictEqual(vertsModule.clampHeight(99999, null), 1200);
      assert.strictEqual(vertsModule.clampHeight('nope', 250), null);
      assert.strictEqual(vertsModule.clampHeight(0, 250), null);
    });
  });

  describe('source resolution', () => {
    it('full URL passes through with trailing slashes stripped', () => {
      assert.strictEqual(getManager().verts().resolveSource(), 'https://verts.example.com');
      assert.strictEqual(getManager().verts().resolveSource('https://other.example.com///'), 'https://other.example.com');
    });

    it("'self' resolves through the brand api-URL derivation", () => {
      const url = getManager().verts().resolveSource('self');
      assert.strictEqual(url, getManager().getApiUrl());
      assert(url.includes('api.'));
    });

    it("'company' resolves the config company layer's url through the api derivation", () => {
      assert.strictEqual(getManager().verts().resolveSource('company'), 'https://api.parentco.example.com');
    });

    it("'company' without config.company.url resolves null", async () => {
      const saved = getManager().config.company;
      getManager().config.company = undefined;
      assert.strictEqual(getManager().verts().resolveSource('company'), null);
      getManager().config.company = saved;
    });

    it('unconfigured/unknown sources resolve null', () => {
      const saved = getManager().config.advertising;
      getManager().config.advertising = undefined;
      assert.strictEqual(getManager().verts().resolveSource(), null);
      getManager().config.advertising = saved;
      assert.strictEqual(getManager().verts().resolveSource('sideways'), null);
    });
  });

  describe('the ladder (render)', () => {
    it("type 'house' mounts the fallback lane directly", async () => {
      const $host = makeHost();
      const result = await getManager().verts().render($host, { type: 'house', fillTimeout: 60000 });
      assert.strictEqual(result.lane, 'house');
      result.unit.destroy();
    });

    it('no provider configured + fallback: inhouse → the house lane fills in', async () => {
      const $host = makeHost();
      const result = await getManager().verts().render($host, { type: 'display', fillTimeout: 60000 });
      assert.strictEqual(result.lane, 'house');
      result.unit.destroy();
    });

    it('no provider + no fallback → the terminal promo lane', async () => {
      const saved = getManager().config.advertising;
      getManager().config.advertising = { providers: {} };
      const $host = makeHost();
      const order = [];
      const result = await getManager().verts().render($host, {
        type: 'display',
        onNoFill: () => { order.push('no-fill'); },
        onPromo: () => { order.push('promo'); },
      });
      assert.strictEqual(result.lane, 'promo');
      assert.deepStrictEqual(order, ['no-fill', 'promo'], 'no-fill still reports first, nothing was sold');
      result.unit.destroy();
      getManager().config.advertising = saved;
    });

    it('unknown types skip the provider lane and ride the ladder', async () => {
      const $host = makeHost();
      const result = await getManager().verts().render($host, { type: 'sideways', fillTimeout: 60000 });
      assert.strictEqual(result.lane, 'house');
      result.unit.destroy();
    });
  });

  describe('house unit — message validation', () => {
    function mountUnit(options = {}) {
      const $host = makeHost();
      const result = getManager().verts().renderHouse($host, {
        source: 'https://verts.example.com',
        size: 'rectangle',
        fillTimeout: 60000,
        ...options,
      });
      return { $host, unit: result.unit };
    }

    it('mounts a sandboxed iframe pointed at /omega/verts/serve', () => {
      const { $host, unit } = mountUnit({ vertId: 'vert123', tags: ['dev'] });
      assert.strictEqual($host.children.length, 1);
      assert(unit.$iframe.src.startsWith('https://verts.example.com/omega/verts/serve?'));
      assert(unit.$iframe.src.includes('tags=dev'));
      assert(unit.$iframe.src.includes('vertId=vert123'));
      assert(unit.$iframe.src.includes('height=250'));
      assert.strictEqual($host.styles['max-height'], '250px');
      unit.destroy();
    });

    it('the serve URL carries the host width so the document can stack or tighten', () => {
      const $host = makeHost();
      $host.clientWidth = 344;
      const result = getManager().verts().renderHouse($host, {
        source: 'https://verts.example.com',
        size: 'rectangle',
        fillTimeout: 60000,
      });
      assert(result.unit.$iframe.src.includes('width=344'));
      result.unit.destroy();
    });

    it('tags default to advertising.tags when not overridden', () => {
      const { unit } = mountUnit();
      assert(unit.$iframe.src.includes(encodeURIComponent('music,audio-tools')));
      unit.destroy();
    });

    it('ignores messages from the wrong origin', () => {
      const { unit } = mountUnit();
      unit.handleMessage({
        origin: 'https://evil.example.com',
        data: { type: 'omega-vert:set-dimensions', height: 300 },
      });
      assert.strictEqual(unit.filled, false);
      assert.strictEqual(unit.$iframe.style.height, undefined);
      unit.destroy();
    });

    it('accepts dimensions from the source origin and clamps to the size preset', () => {
      const { unit } = mountUnit();
      unit.handleMessage({
        origin: 'https://verts.example.com',
        data: { type: 'omega-vert:set-dimensions', height: 9000 },
      });
      assert.strictEqual(unit.filled, true);
      assert.strictEqual(unit.$iframe.style.height, '250px');
      unit.destroy();
    });

    it('ignores unusable heights and unknown message types', () => {
      const { unit } = mountUnit();
      unit.handleMessage({ origin: 'https://verts.example.com', data: { type: 'omega-vert:set-dimensions', height: 'NaN' } });
      unit.handleMessage({ origin: 'https://verts.example.com', data: { type: 'omega-vert:self-destruct' } });
      assert.strictEqual(unit.filled, false);
      unit.destroy();
    });

    it('forwards click messages to the onClick callback', () => {
      let clicked = null;
      const { unit } = mountUnit({ onClick: (detail) => { clicked = detail; } });
      unit.handleMessage({ origin: 'https://verts.example.com', data: { type: 'omega-vert:click', id: 'vert123' } });
      assert.deepStrictEqual(clicked, { id: 'vert123' });
      unit.destroy();
    });
  });

  describe('house unit — no fill', () => {
    it('emits onNoFill and hands the host to the promo when no dimensions arrive within the fill timeout', async () => {
      const $host = makeHost();
      let noFill = false;
      const { unit } = getManager().verts().renderHouse($host, {
        source: 'https://verts.example.com',
        size: 'rectangle',
        fillTimeout: 30,
        onNoFill: () => { noFill = true; },
      });

      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.strictEqual(noFill, true);
      assert.strictEqual(unit.destroyed, true);
      assert.strictEqual($host.styles.display, undefined, 'the host stays visible');
      const $promo = $host.children[$host.children.length - 1];
      assert.strictEqual($promo.className, 'omega-vert-promo');
      assert.strictEqual($promo.tag, 'iframe');
      assert.strictEqual($promo.style.height, '250px', 'the promo fills the reserved size');
    });

    it('a filled unit never no-fill collapses', async () => {
      const $host = makeHost();
      let noFill = false;
      const { unit } = getManager().verts().renderHouse($host, {
        source: 'https://verts.example.com',
        fillTimeout: 30,
        onNoFill: () => { noFill = true; },
      });
      unit.handleMessage({ origin: 'https://verts.example.com', data: { type: 'omega-vert:set-dimensions', height: 100 } });

      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.strictEqual(noFill, false);
      assert.strictEqual(unit.destroyed, false);
      unit.destroy();
    });

    it('renderHouse with no resolvable source goes straight to the promo', () => {
      const saved = getManager().config.advertising;
      getManager().config.advertising = {};
      const $host = makeHost();
      let noFill = false;
      const result = getManager().verts().renderHouse($host, { onNoFill: () => { noFill = true; } });
      assert.strictEqual(result.lane, 'promo');
      assert.strictEqual(noFill, true);
      assert.strictEqual($host.children[0].className, 'omega-vert-promo');
      getManager().config.advertising = saved;
    });
  });

  describe('element binding (data-omega-vert)', () => {
    function makeAdElement(attributes = {}) {
      const $el = makeHost();
      $el.getAttribute = (name) => attributes[name] ?? null;
      return $el;
    }

    it('parseElementOptions reads the data-omega-vert vocabulary', () => {
      const $el = makeAdElement({
        'data-omega-vert': 'house',
        'data-omega-vert-size': 'banner',
        'data-omega-vert-id': 'promo1',
        'data-omega-vert-tags': ' dev, news ,',
      });
      assert.deepStrictEqual(getManager().verts().parseElementOptions($el), {
        type: 'house',
        size: 'banner',
        vertId: 'promo1',
        theme: '',
        tags: ['dev', 'news'],
      });
    });

    it('parseElementOptions defaults a bare element to a display unit', () => {
      assert.deepStrictEqual(getManager().verts().parseElementOptions(makeAdElement()), {
        type: 'display',
        size: '',
        vertId: '',
        theme: '',
        tags: [],
      });
    });

    it('a unit follows the PAGE theme, and a host pin beats it', () => {
      const verts = getManager().verts();
      document.documentElement.setAttribute('data-bs-theme', 'dark');

      assert.strictEqual(verts.pageTheme(), 'dark');
      assert.strictEqual(verts.parseElementOptions(makeAdElement()).theme, 'dark', 'the page theme reaches the frame');
      assert.strictEqual(
        verts.parseElementOptions(makeAdElement({ 'data-omega-vert-theme': 'light' })).theme,
        'light',
        'a host that pins its own theme keeps it',
      );

      document.documentElement.removeAttribute('data-bs-theme');
      assert.strictEqual(verts.pageTheme(), '', 'nothing stamped leaves the frame on the OS branch');
    });

    it('the page theme rides BOTH lanes: the house serve URL and the promo document', async () => {
      document.documentElement.setAttribute('data-bs-theme', 'dark');

      const $house = makeAdElement({ 'data-omega-vert': 'house' });
      const house = await getManager().verts().mount($house, { fillTimeout: 60000 });
      assert.strictEqual(house.lane, 'house');
      assert(house.unit.$iframe.src.includes('theme=dark'), 'the serve URL carries the page theme');
      house.unit.destroy();

      const saved = getManager().config.advertising;
      getManager().config.advertising = {}; // no source → the terminal promo lane
      const $promo = makeAdElement({ 'data-omega-vert': 'display' });
      const promo = await getManager().verts().mount($promo, {});
      assert.strictEqual(promo.lane, 'promo');
      assert(promo.unit.$iframe.srcdoc.includes('<html lang="en" data-theme="dark">'), 'the promo document is stamped dark');

      getManager().config.advertising = saved;
      promo.unit.destroy();
      document.documentElement.removeAttribute('data-bs-theme');
    });

    it('a page theme FLIP re-stamps live promo frames, and leaves a pinned host alone', async () => {
      // node has no DOM observer — this stub is the browser's callback wiring
      const observers = [];
      const savedObserver = global.MutationObserver;
      global.MutationObserver = class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(target, options) { this.target = target; this.options = options; }
        disconnect() {}
      };
      const saved = getManager().config.advertising;
      getManager().config.advertising = {}; // no source → the terminal promo lane

      document.documentElement.setAttribute('data-bs-theme', 'light');
      const $free = makeAdElement({ 'data-omega-vert': 'display' });
      const $pinned = makeAdElement({ 'data-omega-vert': 'display', 'data-omega-vert-theme': 'light' });
      const free = await getManager().verts().mount($free, {});
      const pinned = await getManager().verts().mount($pinned, {});
      assert(free.unit.$iframe.srcdoc.includes('data-theme="light"'));

      // the user flips the page to dark
      document.documentElement.setAttribute('data-bs-theme', 'dark');
      observers.forEach((observer) => observer.callback([]));

      assert(free.unit.$iframe.srcdoc.includes('<html lang="en" data-theme="dark">'), 'the live frame re-stamps, no network');
      assert(pinned.unit.$iframe.srcdoc.includes('<html lang="en" data-theme="light">'), 'the pinned frame is untouched');
      assert.strictEqual(observers[0].options.attributeFilter[0], 'data-bs-theme', 'one attribute is watched');

      free.unit.destroy();
      pinned.unit.destroy();
      getManager().config.advertising = saved;
      document.documentElement.removeAttribute('data-bs-theme');
      global.MutationObserver = savedObserver;
    });

    it('mount arms immediately without IntersectionObserver, attributes drive the ladder, and it is idempotent', async () => {
      const $el = makeAdElement({
        'data-omega-vert': 'house',
        'data-omega-vert-size': 'banner',
        'data-omega-vert-tags': 'dev',
      });
      const result = await getManager().verts().mount($el, { fillTimeout: 60000 });
      assert.strictEqual(result.lane, 'house');
      assert(result.unit.$iframe.src.includes('tags=dev'), 'attribute tags ride the serve URL');
      assert(result.unit.$iframe.src.includes('height=150'), 'attribute size resolves the preset');

      // Second mount is a no-op — the element never double-mounts
      assert.strictEqual(await getManager().verts().mount($el, { fillTimeout: 60000 }), null);
      assert.strictEqual($el.children.length, 1);
      result.unit.destroy();
    });

    it('mount options win over element attributes', async () => {
      const $el = makeAdElement({ 'data-omega-vert': 'house', 'data-omega-vert-id': 'attr-ad' });
      const result = await getManager().verts().mount($el, { vertId: 'opt-ad', fillTimeout: 60000 });
      assert(result.unit.$iframe.src.includes('vertId=opt-ad'), 'passed option beats the attribute');
      result.unit.destroy();
    });

    it('bind scans [data-omega-vert] under a root and mounts each once', async () => {
      const saved = getManager().config.advertising;
      getManager().config.advertising = {}; // no source/fallback → straight to the promo, no timers
      const $a = makeAdElement({ 'data-omega-vert': 'house' });
      const $b = makeAdElement({ 'data-omega-vert': 'display' });
      const root = { querySelectorAll: () => [$a, $b] };

      const mounted = getManager().verts().bind(root);
      assert.deepStrictEqual(mounted, [$a, $b]);

      // Re-bind mounts nothing new
      assert.deepStrictEqual(getManager().verts().bind(root), []);

      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.strictEqual($a.children[0].className, 'omega-vert-promo', 'the exhausted ladder rendered the promo');
      getManager().config.advertising = saved;
    });

    it('an armed-but-not-intersecting unit runs NOTHING until it nears the viewport', async () => {
      const saved = getManager().config.advertising;
      getManager().config.advertising = {}; // exhausted ladder → promo the moment it runs

      let observed = null;
      let callback = null;
      global.IntersectionObserver = class {
        constructor(cb) { callback = cb; }
        observe($el) { observed = $el; }
        disconnect() { this.disconnected = true; }
      };

      try {
        const $el = makeAdElement({ 'data-omega-vert': 'house' });
        assert.strictEqual(getManager().verts().mount($el), null, 'lazy mounts return nothing yet');
        assert.strictEqual(observed, $el, 'the host is observed, not rendered');
        assert.strictEqual($el.children.length, 0, 'no lane ran, not even the promo');

        // Out of view → still nothing
        callback([{ isIntersecting: false }]);
        assert.strictEqual($el.children.length, 0);

        // Near the viewport → the ladder runs and ends at the promo
        callback([{ isIntersecting: true }]);
        await new Promise((resolve) => setTimeout(resolve, 5));
        assert.strictEqual($el.children[0].className, 'omega-vert-promo');
      } finally {
        delete global.IntersectionObserver;
        getManager().config.advertising = saved;
      }
    });
  });

  describe('the terminal promo lane', () => {
    // The promo frame is sandboxed without allow-same-origin, so real
    // messages arrive with origin 'null' and are identified by contentWindow
    function speak(unit, data, source) {
      unit.handleMessage({ origin: 'null', source: source || unit.$iframe.contentWindow, data });
    }

    function mountPromo(options = {}) {
      const $host = makeHost();
      const result = getManager().verts().renderPromo($host, options);
      result.unit.$iframe.contentWindow = { name: 'promo-frame' };
      return { $host, unit: result.unit, result };
    }

    it('a narrow tall host reaches the document as width, so the promo stacks', () => {
      const $host = makeHost();
      $host.clientWidth = 200;
      const result = getManager().verts().renderPromo($host, { size: 'skyscraper' });

      assert(result.unit.$iframe.srcdoc.includes('flex-direction: column;'), 'the skyscraper promo stacks');
      result.unit.destroy();
    });

    it('renders a real sandboxed iframe carrying the promo document, no network', () => {
      const { $host, unit, result } = mountPromo({ size: 'leaderboard' });

      assert.strictEqual(result.lane, 'promo');
      const $promo = $host.children[0];
      assert.strictEqual($promo, unit.$iframe);
      assert.strictEqual($promo.tag, 'iframe');
      assert.strictEqual($promo.className, 'omega-vert-promo');
      assert.strictEqual($promo.getAttribute('src'), null, 'never a network src');
      assert.strictEqual($promo.getAttribute('title'), 'Sponsored');
      assert.strictEqual($promo.getAttribute('frameborder'), '0');
      assert.strictEqual($promo.getAttribute('scrolling'), 'no');
      assert.strictEqual($promo.getAttribute('allowtransparency'), 'true');
      assert.strictEqual($promo.getAttribute('sandbox'), vertsModule.PROMO_SANDBOX);
      assert(!vertsModule.PROMO_SANDBOX.includes('allow-same-origin'), 'a srcdoc frame never gets this origin');
      assert(vertsModule.IFRAME_SANDBOX.includes('allow-same-origin'), 'the house lane keeps its set');
      assert.strictEqual($promo.style.height, '90px', 'fills the reserved size');
      assert.strictEqual($host.styles['max-height'], '90px', 'the host is capped like a real unit');
      unit.destroy();
    });

    it('the srcdoc document is complete, local, and speaks the unit vocabulary', () => {
      const { unit } = mountPromo({ size: 'rectangle' });
      const doc = unit.$iframe.srcdoc;
      // The destination is the UTM-tagged promo url, escaped for the attribute
      const href = vertsModule.promoHref('rectangle').replace(/&/g, '&amp;');

      assert(doc.startsWith('<!DOCTYPE html>'), 'a complete document');
      assert(doc.includes('Built with OMEGA'));
      assert(doc.includes('omegajs.dev'));
      assert(doc.includes('<svg'), 'the mark is inline svg');
      assert(doc.includes(`href="${href}"`));
      assert(doc.includes('target="_blank"'));
      assert(doc.includes('rel="noopener noreferrer sponsored"'), 'the served unit link contract');
      assert(doc.includes(vertsModule.MESSAGE_DIMENSIONS), 'reports its height');
      assert(doc.includes(vertsModule.MESSAGE_CLICK), 'forwards clicks');
      assert(doc.includes('window.parent.postMessage'));
      assert(doc.includes(JSON.stringify(global.window.location.origin)), 'messages are aimed at the host origin');

      // The promo link is the ONLY url in the document: nothing loads
      const urls = doc.match(/(?:src|href)="(https?:[^"]*)"/g) || [];
      assert.deepStrictEqual(urls, [`href="${href}"`], 'no external asset, no request');
      unit.destroy();
    });

    it('sizes the frame from an identified dimension message, clamped to the preset', () => {
      const { unit } = mountPromo({ size: 'rectangle' });

      // A report below the preset resizes the frame — proves the handler acts
      // (the mount already set 250px, so the clamp assertion alone could pass
      // against a handler that does nothing)
      speak(unit, { type: vertsModule.MESSAGE_DIMENSIONS, id: vertsModule.PROMO_ID, height: 120 });
      assert.strictEqual(unit.$iframe.style.height, '120px', 'an in-range report resizes');

      speak(unit, { type: vertsModule.MESSAGE_DIMENSIONS, id: vertsModule.PROMO_ID, height: 9000 });
      assert.strictEqual(unit.$iframe.style.height, '250px', 'an oversized report clamps to the preset');
      unit.destroy();
    });

    it('ignores dimension messages from any window that is not its own frame', () => {
      const { unit } = mountPromo({ size: 'rectangle' });

      speak(unit, { type: vertsModule.MESSAGE_DIMENSIONS, height: 120 }, { name: 'other-frame' });
      unit.handleMessage({ origin: 'null', data: { type: vertsModule.MESSAGE_DIMENSIONS, height: 120 } });
      assert.strictEqual(unit.$iframe.style.height, '250px', 'the mount height stands');
      unit.destroy();
    });

    it('forwards the frame click to the host like a served unit does', () => {
      const $host = makeHost();
      let clicked = null;
      const result = getManager().verts().renderPromo($host, {
        size: 'rectangle',
        onClick: (detail) => { clicked = detail; },
      });
      result.unit.$iframe.contentWindow = { name: 'promo-frame' };

      speak(result.unit, { type: vertsModule.MESSAGE_CLICK, id: vertsModule.PROMO_ID });
      assert.deepStrictEqual(clicked, { id: vertsModule.PROMO_ID });

      // A destroyed unit is inert
      clicked = null;
      result.unit.destroy();
      speak(result.unit, { type: vertsModule.MESSAGE_CLICK, id: vertsModule.PROMO_ID });
      assert.strictEqual(clicked, null);
    });

    it('a short slot drops the pitch line so the copy never overflows', () => {
      const short = vertsModule.buildPromo(90).srcdoc;
      const tall = vertsModule.buildPromo(250).srcdoc;
      assert(!short.includes('full-stack JavaScript framework'));
      assert(short.includes('Built with OMEGA'));
      assert(short.includes('omegajs.dev'));
      assert(tall.includes('full-stack JavaScript framework'));
    });

    it('carries the resolved theme across the frame boundary, literals either way', () => {
      const dark = vertsModule.buildPromo(250, 'dark').srcdoc;
      const unthemed = vertsModule.buildPromo(250).srcdoc;

      assert(dark.includes('<html lang="en" data-theme="dark">'));
      assert(unthemed.includes('<html lang="en">'), 'no theme follows the OS');
      assert(unthemed.includes('prefers-color-scheme: dark'));
      assert(!dark.includes('var(--omega-surface'), 'page tokens do not cross the boundary');
      assert(dark.includes('#16181d'), 'literal colours only');
    });

    it('an unsized unit gets the minimum promo height', () => {
      const { unit, $host } = mountPromo({});
      assert.strictEqual(unit.$iframe.style.height, '90px');
      assert.strictEqual($host.styles['max-height'], undefined, 'an unsized host stays uncapped');
      unit.destroy();
    });

    it('the promo document IS the shared renderer, fed the house promo data', async () => {
      const { renderVertDocument, OMEGA_ACCENT } = await import('../src/modules/vert-document.js');

      const promo = vertsModule.buildPromoDocument(250, 'dark', 'https://host.example');
      const direct = renderVertDocument({
        id: vertsModule.PROMO_ID,
        href: vertsModule.promoHref(),
        title: 'Built with OMEGA',
        description: 'The full-stack JavaScript framework for web, backend, desktop, and extensions.',
        button: 'Visit omegajs.dev',
        imageMarkup: promo.match(/<svg[\s\S]*?<\/svg>/)[0],
        theme: 'dark',
        height: 250,
        accent: OMEGA_ACCENT,
        targetOrigin: 'https://host.example',
      });

      assert.strictEqual(promo, direct, 'the promo takes the same pipeline a served vert takes');
    });

    it('wears the media-row look: thumb, copy, hairline, label + cta, content-sized', () => {
      const doc = vertsModule.buildPromo(250).srcdoc;

      assert(doc.includes('class="omega-vert-row"'), 'the media row');
      assert(doc.includes('class="omega-vert-thumb"'), 'thumbnail slot');
      assert(doc.includes('class="omega-vert-rule"'), 'the hairline');
      assert(doc.includes('class="omega-vert-foot"'), 'the bottom row');
      assert(doc.includes('<span class="omega-vert-label">Sponsored</span>'), 'the muted sponsored label');
      assert(doc.includes('<span class="omega-vert-button">Visit omegajs.dev</span>'), 'the accent cta button');
      assert(doc.includes('#4f46e5'), 'the promo passes the omega indigo accent');
      assert(!/height: \d+px/.test(doc.replace(/height: 32px|height: 56px|height: 1px/g, '')), 'content-sized: no reserved height is baked into the card');
    });

    it('un-hides a host a failed lane left behind and recaps it to its own size', () => {
      const $host = makeHost();
      $host.style.setProperty('display', 'none');
      $host.style.setProperty('max-height', '600px');

      const result = getManager().verts().renderPromo($host, { size: 'rectangle' });
      assert.strictEqual($host.styles.display, undefined);
      assert.strictEqual($host.styles['max-height'], '250px');
      result.unit.destroy();
    });
  });

  describe('house unit — host-owned lifecycle', () => {
    it('isStale reflects staleAfter against the last (re)load', () => {
      const $host = makeHost();
      const { unit } = getManager().verts().renderHouse($host, {
        source: 'https://verts.example.com',
        fillTimeout: 60000,
        staleAfter: 1000 * 60 * 10,
      });

      const now = Date.now();
      unit.lastLoadedAt = now - 1000 * 60 * 11;
      assert.strictEqual(unit.isStale(now), true);
      unit.lastLoadedAt = now - 1000 * 60 * 9;
      assert.strictEqual(unit.isStale(now), false);
      unit.destroy();
    });

    it('recover reloads only a stale, filled unit', () => {
      const $host = makeHost();
      const { unit } = getManager().verts().renderHouse($host, {
        source: 'https://verts.example.com',
        fillTimeout: 60000,
      });
      let reloads = 0;
      unit.reload = () => { reloads += 1; };

      // Not filled yet → no recovery reload
      unit.lastLoadedAt = 0;
      unit.recover();
      assert.strictEqual(reloads, 0);

      // Filled + stale → reload
      unit.filled = true;
      unit.recover();
      assert.strictEqual(reloads, 1);

      // Filled + fresh → no reload
      unit.lastLoadedAt = Date.now();
      unit.recover();
      assert.strictEqual(reloads, 1);
      unit.destroy();
    });

    it('rotation reloads on the configured interval and stops on destroy', async () => {
      const $host = makeHost();
      const { unit } = getManager().verts().renderHouse($host, {
        source: 'https://verts.example.com',
        fillTimeout: 60000,
        rotateInterval: 25,
      });
      let reloads = 0;
      unit.reload = () => { reloads += 1; };

      await new Promise((resolve) => setTimeout(resolve, 90));
      assert(reloads >= 2, `rotation ticked (${reloads})`);

      unit.destroy();
      const after = reloads;
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.strictEqual(reloads, after, 'destroy stops rotation');
    });

    it('reload re-arms the fill timer with a fresh cache-busted URL', async () => {
      const $host = makeHost();
      const { unit } = getManager().verts().renderHouse($host, {
        source: 'https://verts.example.com',
        fillTimeout: 60000,
      });
      unit.filled = true;
      const firstSrc = unit.$iframe.src;

      await new Promise((resolve) => setTimeout(resolve, 5));
      unit.fillTimeout = 30;
      unit.reload('stale');
      assert.strictEqual(unit.filled, false, 'reload resets fill state');
      assert.notStrictEqual(unit.$iframe.src, firstSrc, 'fresh serve URL');

      // The re-armed fill timer tears down an unanswered reload
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.strictEqual(unit.destroyed, true);
    });
  });

  // #44 — auto-UTM on the destination + host-side click analytics (no forward page)
  describe('click tracking + utm', () => {
    // The real analytics instance, wrapped: every call is recorded AND passed
    // through to the module's own event() (no stand-in implementation).
    function recordAnalytics(run) {
      const analytics = getManager().analytics();
      const original = analytics.event;
      const calls = [];

      analytics.event = function (name, params) {
        calls.push({ name, params });
        return original.call(this, name, params);
      };

      try {
        run();
      } finally {
        analytics.event = original;
      }

      return calls;
    }

    function promoHrefOf(html) {
      const match = html.match(/<a class="omega-vert" id="omega-vert" href="([^"]*)"/);
      return new URL(match[1].replace(/&amp;/g, '&'));
    }

    it('tags the promo destination with the vert utm set, slot as utm_content', () => {
      const href = promoHrefOf(vertsModule.buildPromo(90, '', 'leaderboard').srcdoc);

      assert.strictEqual(href.origin + href.pathname, 'https://omegajs.dev/');
      assert.strictEqual(href.searchParams.get('utm_source'), 'localhost', 'the host page hostname');
      assert.strictEqual(href.searchParams.get('utm_medium'), 'omega-vert');
      assert.strictEqual(href.searchParams.get('utm_campaign'), 'omega-promo');
      assert.strictEqual(href.searchParams.get('utm_content'), 'leaderboard');
      assert.strictEqual([...href.searchParams.keys()].length, 4, 'only the utm set rides along');
    });

    it('an unsized promo slot carries no utm_content', () => {
      const href = promoHrefOf(vertsModule.buildPromo(250).srcdoc);

      assert.strictEqual(href.searchParams.get('utm_content'), null);
      assert.strictEqual(href.searchParams.get('utm_medium'), 'omega-vert');
    });

    it('the promo click message fires the host-side analytics event', () => {
      const $host = makeHost();
      const result = getManager().verts().renderPromo($host, { size: 'rectangle' });
      result.unit.$iframe.contentWindow = { name: 'promo-frame' };

      const calls = recordAnalytics(() => {
        result.unit.handleMessage({
          origin: 'null',
          source: result.unit.$iframe.contentWindow,
          data: { type: vertsModule.MESSAGE_CLICK, id: vertsModule.PROMO_ID },
        });
      });

      assert.strictEqual(calls.length, 1, 'exactly one event per click');
      assert.strictEqual(calls[0].name, 'vert_click');
      assert.deepStrictEqual(calls[0].params, {
        vert_id: vertsModule.PROMO_ID,
        vert_lane: 'promo',
        vert_campaign: 'omega-promo',
        vert_slot: 'rectangle',
        vert_source: 'localhost',
      });

      result.unit.destroy();
    });

    it('the house click message fires the host-side analytics event', () => {
      const $host = makeHost();
      const { unit } = getManager().verts().renderHouse($host, {
        source: 'https://verts.example.com',
        size: 'banner',
        fillTimeout: 60000,
      });

      const calls = recordAnalytics(() => {
        unit.handleMessage({ origin: 'https://verts.example.com', data: { type: vertsModule.MESSAGE_CLICK, id: 'vert123' } });
      });

      assert.strictEqual(calls.length, 1, 'exactly one event per click');
      assert.strictEqual(calls[0].name, 'vert_click');
      assert.deepStrictEqual(calls[0].params, {
        vert_id: 'vert123',
        vert_lane: 'house',
        vert_campaign: 'vert123',
        vert_slot: 'banner',
        vert_source: 'localhost',
      });

      unit.destroy();
    });

    it('a message that is not a click fires nothing', () => {
      const $host = makeHost();
      const { unit } = getManager().verts().renderHouse($host, {
        source: 'https://verts.example.com',
        size: 'banner',
        fillTimeout: 60000,
      });

      const calls = recordAnalytics(() => {
        unit.handleMessage({ origin: 'https://verts.example.com', data: { type: vertsModule.MESSAGE_DIMENSIONS, height: 120 } });
        unit.handleMessage({ origin: 'https://evil.example', data: { type: vertsModule.MESSAGE_CLICK, id: 'vert123' } });
      });

      assert.strictEqual(calls.length, 0);
      unit.destroy();
    });
  });

  // #150 — the slot read must resolve the schema's *Slot keys
  // (advertising.providers.adsense.displaySlot etc.), not a slots.* subobject
  describe('adsense slot wiring', () => {
    it('_buildIns wires data-ad-slot from each schema *Slot key', () => {
      const verts = getManager().verts();
      const adsense = {
        client: 'ca-pub-test',
        displaySlot: '1111111111',
        inArticleSlot: '2222222222',
        inFeedSlot: '3333333333',
        multiplexSlot: '4444444444',
      };
      const expected = {
        display: '1111111111',
        'in-article': '2222222222',
        'in-feed': '3333333333',
        multiplex: '4444444444',
      };
      for (const [type, slot] of Object.entries(expected)) {
        const format = vertsModule.ADSENSE_FORMATS[type];
        const $ins = verts._buildIns(adsense, type, format, {});
        assert.strictEqual($ins.getAttribute('data-ad-slot'), slot, `${type} slot`);
      }
    });

    it('_buildIns omits data-ad-slot when the slot is not configured', () => {
      const format = vertsModule.ADSENSE_FORMATS.display;
      const $ins = getManager().verts()._buildIns({ client: 'ca-pub-test' }, 'display', format, {});
      assert.strictEqual($ins.getAttribute('data-ad-slot'), null);
    });
  });
});
