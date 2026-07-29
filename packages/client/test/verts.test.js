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

    it('no provider + no fallback → collapse', async () => {
      const saved = getManager().config.advertising;
      getManager().config.advertising = { providers: {} };
      const $host = makeHost();
      let noFill = false;
      const result = await getManager().verts().render($host, { type: 'display', onNoFill: () => { noFill = true; } });
      assert.strictEqual(result, null);
      assert.strictEqual(noFill, true);
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

  describe('house unit — no-fill collapse', () => {
    it('collapses and emits onNoFill when no dimensions arrive within the fill timeout', async () => {
      const $host = makeHost();
      let noFill = false;
      const { unit } = getManager().verts().renderHouse($host, {
        source: 'https://verts.example.com',
        fillTimeout: 30,
        onNoFill: () => { noFill = true; },
      });

      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.strictEqual(noFill, true);
      assert.strictEqual($host.styles.display, 'none');
      assert.strictEqual(unit.destroyed, true);
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

    it('renderHouse with no resolvable source collapses immediately', () => {
      const saved = getManager().config.advertising;
      getManager().config.advertising = {};
      const $host = makeHost();
      let noFill = false;
      const result = getManager().verts().renderHouse($host, { onNoFill: () => { noFill = true; } });
      assert.strictEqual(result, null);
      assert.strictEqual(noFill, true);
      assert.strictEqual($host.styles.display, 'none');
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
        tags: ['dev', 'news'],
      });
    });

    it('parseElementOptions defaults a bare element to a display unit', () => {
      assert.deepStrictEqual(getManager().verts().parseElementOptions(makeAdElement()), {
        type: 'display',
        size: '',
        vertId: '',
        tags: [],
      });
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
      getManager().config.advertising = {}; // no source/fallback → immediate collapse, no timers
      const $a = makeAdElement({ 'data-omega-vert': 'house' });
      const $b = makeAdElement({ 'data-omega-vert': 'display' });
      const root = { querySelectorAll: () => [$a, $b] };

      const mounted = getManager().verts().bind(root);
      assert.deepStrictEqual(mounted, [$a, $b]);

      // Re-bind mounts nothing new
      assert.deepStrictEqual(getManager().verts().bind(root), []);

      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.strictEqual($a.styles.display, 'none', 'unconfigured ladder collapsed the host');
      getManager().config.advertising = saved;
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

      // The re-armed fill timer collapses an unanswered reload
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.strictEqual(unit.destroyed, true);
    });
  });
});
