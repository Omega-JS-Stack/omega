const defineCases = require('@omega.js/devkit/test/define-cases');
const { getOmega, TEST_CONFIG, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

// Config with an in-house source + the RESOLVED company section (#677: the
// brand types `company: { id }` and the loader fills the rest)
const ADS_CONFIG = {
  ...TEST_CONFIG,
  company: { id: 'parentco', name: 'ParentCo', url: 'https://parentco.example.com', images: {} },
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
    replaceChildren(...nodes) { this.children = nodes; },
    querySelector: () => null,
    style: {
      setProperty: (key, value) => { styles[key] = value; },
      removeProperty: (key) => { delete styles[key]; },
    },
  };
}

let vertsModule;

module.exports = defineCases({
  type: 'group',
  description: 'verts',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    ...(() => {
      const cases = [];
      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (async () => {
        vertsModule = await import('../src/modules/verts.js');
        await getOmega().initialize(ADS_CONFIG);
      })()));

      cases.push(
        {
          name: 'Verts Module > module surface > should hang off the instance as verts',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const verts = getOmega().verts;
            ctx.expect(typeof verts.render === 'function').toBeTruthy();
            ctx.expect(typeof verts.renderHouse === 'function').toBeTruthy();
            ctx.expect(typeof verts.resolveSource === 'function').toBeTruthy();
          },
        },
      );

      cases.push(
        {
          name: 'Verts Module > size + clamp helpers > resolveSizePx resolves presets from the one table',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(vertsModule.resolveSizePx('banner')).toBe(150);
            ctx.expect(vertsModule.resolveSizePx('leaderboard')).toBe(90);
            ctx.expect(vertsModule.resolveSizePx('rectangle')).toBe(250);
            ctx.expect(vertsModule.resolveSizePx('large-rectangle')).toBe(600);
            ctx.expect(vertsModule.resolveSizePx('skyscraper')).toBe(600);
          },
        },
        {
          name: 'Verts Module > size + clamp helpers > resolveSizePx accepts raw px and rejects junk',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(vertsModule.resolveSizePx('300')).toBe(300);
            ctx.expect(vertsModule.resolveSizePx('')).toBe(null);
            ctx.expect(vertsModule.resolveSizePx('huge')).toBe(null);
            ctx.expect(vertsModule.resolveSizePx('-5')).toBe(null);
          },
        },
        {
          name: 'Verts Module > size + clamp helpers > clampHeight clamps to the unit max and the global ceiling',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(vertsModule.clampHeight(120, 250)).toBe(120);
            ctx.expect(vertsModule.clampHeight(9000, 250)).toBe(250);
            ctx.expect(vertsModule.clampHeight(99999, null)).toBe(1200);
            ctx.expect(vertsModule.clampHeight('nope', 250)).toBe(null);
            ctx.expect(vertsModule.clampHeight(0, 250)).toBe(null);
          },
        },
      );

      cases.push(
        {
          name: 'Verts Module > source resolution > full URL passes through with trailing slashes stripped',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(getOmega().verts.resolveSource()).toBe('https://verts.example.com');
            ctx.expect(getOmega().verts.resolveSource('https://other.example.com///')).toBe('https://other.example.com');
          },
        },
        {
          name: 'Verts Module > source resolution > \'self\' resolves through the brand api-URL derivation',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const url = getOmega().verts.resolveSource('self');
            ctx.expect(url).toBe(getOmega().getApiUrl());
            ctx.expect(url.includes('api.')).toBeTruthy();
          },
        },
        {
          name: 'Verts Module > source resolution > \'company\' resolves the RESOLVED company url through the api derivation',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(getOmega().verts.resolveSource('company')).toBe('https://api.parentco.example.com');
          },
        },
        {
          name: 'Verts Module > source resolution > \'company\' with no resolved company url resolves null',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const saved = getOmega().config.company;
            getOmega().config.company = undefined;
            ctx.expect(getOmega().verts.resolveSource('company')).toBe(null);
            getOmega().config.company = saved;
          },
        },
        {
          name: 'Verts Module > source resolution > unconfigured/unknown sources resolve null',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const saved = getOmega().config.advertising;
            getOmega().config.advertising = undefined;
            ctx.expect(getOmega().verts.resolveSource()).toBe(null);
            getOmega().config.advertising = saved;
            ctx.expect(getOmega().verts.resolveSource('sideways')).toBe(null);
          },
        },
      );

      cases.push(
        {
          name: 'Verts Module > the ladder (render) > type \'house\' mounts the fallback lane directly',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const $host = makeHost();
            const result = await getOmega().verts.render($host, { type: 'house', fillTimeout: 60000 });
            ctx.expect(result.lane).toBe('house');
            result.unit.destroy();
          },
        },
        {
          name: 'Verts Module > the ladder (render) > no provider configured + fallback: inhouse → the house lane fills in',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const $host = makeHost();
            const result = await getOmega().verts.render($host, { type: 'display', fillTimeout: 60000 });
            ctx.expect(result.lane).toBe('house');
            result.unit.destroy();
          },
        },
        {
          name: 'Verts Module > the ladder (render) > no provider + no fallback → the terminal promo lane',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const saved = getOmega().config.advertising;
            getOmega().config.advertising = { providers: {} };
            const $host = makeHost();
            const order = [];
            const result = await getOmega().verts.render($host, {
              type: 'display',
              onNoFill: () => { order.push('no-fill'); },
              onPromo: () => { order.push('promo'); },
            });
            ctx.expect(result.lane).toBe('promo');
            ctx.expect(order, 'no-fill still reports first, nothing was sold').toEqual(['no-fill', 'promo']);
            result.unit.destroy();
            getOmega().config.advertising = saved;
          },
        },
        // #527 — the adsense block has ONE switch, the client id: a configured
        // client means this surface renders units off it, full stop. The split
        // gates (`units`, a provider-level `enabled`) are gone, so a config still
        // carrying them is an undeclared key that changes nothing — the lane runs.
        {
          name: 'Verts Module > the ladder (render) > a configured client id runs the provider lane — no second gate switches it off',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const verts = getOmega().verts;
            const saved = getOmega().config.advertising;
            const savedScript = verts._adsenseScript;
            getOmega().config.advertising = {
              providers: {
                adsense: { client: 'ca-pub-1234567890', displaySlot: '1111111111', units: false, enabled: false },
                inhouse: { source: 'https://verts.example.com/' },
              },
              fallback: 'inhouse',
            };
            // The one thing a unit test cannot do for real: fetch Google's tag.
            verts._adsenseScript = Promise.resolve({ script: {}, cached: true });

            const $host = makeHost();
            const result = await verts.render($host, { type: 'display', fillTimeout: 10 });

            ctx.expect($host.children.some(($child) => String($child.className || '').includes('adsbygoogle')), 'the ad unit is built for every site that names a client id').toBe(true);
            // Nothing fills a mock <ins>, so the ladder still falls through — the
            // proof here is that it went THROUGH the provider lane to get there.
            ctx.expect(result.lane).toBe('house');

            result.unit.destroy();
            verts._adsenseScript = savedScript;
            getOmega().config.advertising = saved;
          },
        },
        {
          name: 'Verts Module > the ladder (render) > unknown types skip the provider lane and ride the ladder',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const $host = makeHost();
            const result = await getOmega().verts.render($host, { type: 'sideways', fillTimeout: 60000 });
            ctx.expect(result.lane).toBe('house');
            result.unit.destroy();
          },
        },
      );

      cases.push(
        ...(() => {
          const cases = [];
          function mountUnit(options = {}) {
            const $host = makeHost();
            const result = getOmega().verts.renderHouse($host, {
              source: 'https://verts.example.com',
              size: 'rectangle',
              fillTimeout: 60000,
              ...options,
            });
            return { $host, unit: result.unit };
          }

          cases.push({
            name: 'Verts Module > house unit — message validation > mounts a sandboxed iframe pointed at /omega/verts/serve',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const { $host, unit } = mountUnit({ vertId: 'vert123', tags: ['dev'] });
              ctx.expect($host.children.length).toBe(1);
              ctx.expect(unit.$iframe.src.startsWith('https://verts.example.com/omega/verts/serve?')).toBeTruthy();
              ctx.expect(unit.$iframe.src.includes('tags=dev')).toBeTruthy();
              ctx.expect(unit.$iframe.src.includes('vertId=vert123')).toBeTruthy();
              ctx.expect(unit.$iframe.src.includes('height=250')).toBeTruthy();
              ctx.expect($host.styles['max-height']).toBe('250px');
              unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > house unit — message validation > the serve URL carries the host width so the document can stack or tighten',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const $host = makeHost();
              $host.clientWidth = 344;
              const result = getOmega().verts.renderHouse($host, {
                source: 'https://verts.example.com',
                size: 'rectangle',
                fillTimeout: 60000,
              });
              ctx.expect(result.unit.$iframe.src.includes('width=344')).toBeTruthy();
              result.unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > house unit — message validation > tags default to advertising.tags when not overridden',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const { unit } = mountUnit();
              ctx.expect(unit.$iframe.src.includes(encodeURIComponent('music,audio-tools'))).toBeTruthy();
              unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > house unit — message validation > ignores messages from the wrong origin',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const { unit } = mountUnit();
              unit.handleMessage({
                origin: 'https://evil.example.com',
                data: { type: 'omega-vert:set-dimensions', height: 300 },
              });
              ctx.expect(unit.filled).toBe(false);
              ctx.expect(unit.$iframe.style.height).toBe(undefined);
              unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > house unit — message validation > accepts dimensions from the source origin and clamps to the size preset',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const { unit } = mountUnit();
              unit.handleMessage({
                origin: 'https://verts.example.com',
                data: { type: 'omega-vert:set-dimensions', height: 9000 },
              });
              ctx.expect(unit.filled).toBe(true);
              ctx.expect(unit.$iframe.style.height).toBe('250px');
              unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > house unit — message validation > ignores unusable heights and unknown message types',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const { unit } = mountUnit();
              unit.handleMessage({ origin: 'https://verts.example.com', data: { type: 'omega-vert:set-dimensions', height: 'NaN' } });
              unit.handleMessage({ origin: 'https://verts.example.com', data: { type: 'omega-vert:self-destruct' } });
              ctx.expect(unit.filled).toBe(false);
              unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > house unit — message validation > forwards click messages to the onClick callback',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              let clicked = null;
              const { unit } = mountUnit({ onClick: (detail) => { clicked = detail; } });
              unit.handleMessage({ origin: 'https://verts.example.com', data: { type: 'omega-vert:click', id: 'vert123' } });
              ctx.expect(clicked).toEqual({ id: 'vert123' });
              unit.destroy();
            },
          });
          return cases;
        })(),
      );

      cases.push(
        {
          name: 'Verts Module > house unit — no fill > emits onNoFill and hands the host to the promo when no dimensions arrive within the fill timeout',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const $host = makeHost();
            let noFill = false;
            const { unit } = getOmega().verts.renderHouse($host, {
              source: 'https://verts.example.com',
              size: 'rectangle',
              fillTimeout: 30,
              onNoFill: () => { noFill = true; },
            });

            await new Promise((resolve) => setTimeout(resolve, 80));
            ctx.expect(noFill).toBe(true);
            ctx.expect(unit.destroyed).toBe(true);
            ctx.expect($host.styles.display, 'the host stays visible').toBe(undefined);
            const $promo = $host.children[$host.children.length - 1];
            ctx.expect($promo.className).toBe('omega-vert-promo');
            ctx.expect($promo.tag).toBe('iframe');
            ctx.expect($promo.style.height, 'the promo fills the reserved size').toBe('250px');
          },
        },
        {
          name: 'Verts Module > house unit — no fill > a filled unit never no-fill collapses',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const $host = makeHost();
            let noFill = false;
            const { unit } = getOmega().verts.renderHouse($host, {
              source: 'https://verts.example.com',
              fillTimeout: 30,
              onNoFill: () => { noFill = true; },
            });
            unit.handleMessage({ origin: 'https://verts.example.com', data: { type: 'omega-vert:set-dimensions', height: 100 } });

            await new Promise((resolve) => setTimeout(resolve, 80));
            ctx.expect(noFill).toBe(false);
            ctx.expect(unit.destroyed).toBe(false);
            unit.destroy();
          },
        },
        {
          name: 'Verts Module > house unit — no fill > renderHouse with no resolvable source goes straight to the promo',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const saved = getOmega().config.advertising;
            getOmega().config.advertising = {};
            const $host = makeHost();
            let noFill = false;
            const result = getOmega().verts.renderHouse($host, { onNoFill: () => { noFill = true; } });
            ctx.expect(result.lane).toBe('promo');
            ctx.expect(noFill).toBe(true);
            ctx.expect($host.children[0].className).toBe('omega-vert-promo');
            getOmega().config.advertising = saved;
          },
        },
      );

      cases.push(
        ...(() => {
          const cases = [];
          function makeAdElement(attributes = {}) {
            const $el = makeHost();
            $el.getAttribute = (name) => attributes[name] ?? null;
            return $el;
          }

          cases.push({
            name: 'Verts Module > element binding (data-omega-vert) > parseElementOptions reads the data-omega-vert vocabulary',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const $el = makeAdElement({
                'data-omega-vert': 'house',
                'data-omega-vert-size': 'banner',
                'data-omega-vert-id': 'promo1',
                'data-omega-vert-tags': ' dev, news ,',
              });
              ctx.expect(getOmega().verts.parseElementOptions($el)).toEqual({
                type: 'house',
                size: 'banner',
                vertId: 'promo1',
                theme: '',
                tags: ['dev', 'news'],
              });
            },
          });

          cases.push({
            name: 'Verts Module > element binding (data-omega-vert) > parseElementOptions defaults a bare element to a display unit',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              ctx.expect(getOmega().verts.parseElementOptions(makeAdElement())).toEqual({
                type: 'display',
                size: '',
                vertId: '',
                theme: '',
                tags: [],
              });
            },
          });

          cases.push({
            name: 'Verts Module > element binding (data-omega-vert) > a unit follows the PAGE theme, and a host pin beats it',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const verts = getOmega().verts;
              document.documentElement.setAttribute('data-bs-theme', 'dark');

              ctx.expect(verts.pageTheme()).toBe('dark');
              ctx.expect(verts.parseElementOptions(makeAdElement()).theme, 'the page theme reaches the frame').toBe('dark');
              ctx.expect(verts.parseElementOptions(makeAdElement({ 'data-omega-vert-theme': 'light' })).theme, 'a host that pins its own theme keeps it').toBe('light');

              document.documentElement.removeAttribute('data-bs-theme');
              ctx.expect(verts.pageTheme(), 'nothing stamped leaves the frame on the OS branch').toBe('');
            },
          });

          cases.push({
            name: 'Verts Module > element binding (data-omega-vert) > the page theme rides BOTH lanes: the house serve URL and the promo document',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              document.documentElement.setAttribute('data-bs-theme', 'dark');

              const $house = makeAdElement({ 'data-omega-vert': 'house' });
              const house = await getOmega().verts.mount($house, { fillTimeout: 60000 });
              ctx.expect(house.lane).toBe('house');
              ctx.expect(house.unit.$iframe.src.includes('theme=dark'), 'the serve URL carries the page theme').toBeTruthy();
              house.unit.destroy();

              const saved = getOmega().config.advertising;
              getOmega().config.advertising = {}; // no source → the terminal promo lane
              const $promo = makeAdElement({ 'data-omega-vert': 'display' });
              const promo = await getOmega().verts.mount($promo, {});
              ctx.expect(promo.lane).toBe('promo');
              ctx.expect(promo.unit.$iframe.srcdoc.includes('<html lang="en" data-theme="dark">'), 'the promo document is stamped dark').toBeTruthy();

              getOmega().config.advertising = saved;
              promo.unit.destroy();
              document.documentElement.removeAttribute('data-bs-theme');
            },
          });

          cases.push({
            name: 'Verts Module > element binding (data-omega-vert) > a page theme FLIP re-stamps live promo frames, and leaves a pinned host alone',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              // node has no DOM observer — this stub is the browser's callback wiring
              const observers = [];
              const savedObserver = global.MutationObserver;
              global.MutationObserver = class {
                constructor(callback) { this.callback = callback; observers.push(this); }
                observe(target, options) { this.target = target; this.options = options; }
                disconnect() {}
              };
              const saved = getOmega().config.advertising;
              getOmega().config.advertising = {}; // no source → the terminal promo lane

              document.documentElement.setAttribute('data-bs-theme', 'light');
              const $free = makeAdElement({ 'data-omega-vert': 'display' });
              const $pinned = makeAdElement({ 'data-omega-vert': 'display', 'data-omega-vert-theme': 'light' });
              const free = await getOmega().verts.mount($free, {});
              const pinned = await getOmega().verts.mount($pinned, {});
              ctx.expect(free.unit.$iframe.srcdoc.includes('data-theme="light"')).toBeTruthy();

              // the user flips the page to dark
              document.documentElement.setAttribute('data-bs-theme', 'dark');
              observers.forEach((observer) => observer.callback([]));

              ctx.expect(free.unit.$iframe.srcdoc.includes('<html lang="en" data-theme="dark">'), 'the live frame re-stamps, no network').toBeTruthy();
              ctx.expect(pinned.unit.$iframe.srcdoc.includes('<html lang="en" data-theme="light">'), 'the pinned frame is untouched').toBeTruthy();
              ctx.expect(observers[0].options.attributeFilter[0], 'one attribute is watched').toBe('data-bs-theme');

              free.unit.destroy();
              pinned.unit.destroy();
              getOmega().config.advertising = saved;
              document.documentElement.removeAttribute('data-bs-theme');
              global.MutationObserver = savedObserver;
            },
          });

          cases.push({
            name: 'Verts Module > element binding (data-omega-vert) > mount arms immediately without IntersectionObserver, attributes drive the ladder, and it is idempotent',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const $el = makeAdElement({
                'data-omega-vert': 'house',
                'data-omega-vert-size': 'banner',
                'data-omega-vert-tags': 'dev',
              });
              const result = await getOmega().verts.mount($el, { fillTimeout: 60000 });
              ctx.expect(result.lane).toBe('house');
              ctx.expect(result.unit.$iframe.src.includes('tags=dev'), 'attribute tags ride the serve URL').toBeTruthy();
              ctx.expect(result.unit.$iframe.src.includes('height=150'), 'attribute size resolves the preset').toBeTruthy();

              // Second mount is a no-op — the element never double-mounts
              ctx.expect(await getOmega().verts.mount($el, { fillTimeout: 60000 })).toBe(null);
              ctx.expect($el.children.length).toBe(1);
              result.unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > element binding (data-omega-vert) > mount options win over element attributes',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const $el = makeAdElement({ 'data-omega-vert': 'house', 'data-omega-vert-id': 'attr-ad' });
              const result = await getOmega().verts.mount($el, { vertId: 'opt-ad', fillTimeout: 60000 });
              ctx.expect(result.unit.$iframe.src.includes('vertId=opt-ad'), 'passed option beats the attribute').toBeTruthy();
              result.unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > element binding (data-omega-vert) > bind scans [data-omega-vert] under a root and mounts each once',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const saved = getOmega().config.advertising;
              getOmega().config.advertising = {}; // no source/fallback → straight to the promo, no timers
              const $a = makeAdElement({ 'data-omega-vert': 'house' });
              const $b = makeAdElement({ 'data-omega-vert': 'display' });
              const root = { querySelectorAll: () => [$a, $b] };

              const mounted = getOmega().verts.bind(root);
              ctx.expect(mounted).toEqual([$a, $b]);

              // Re-bind mounts nothing new
              ctx.expect(getOmega().verts.bind(root)).toEqual([]);

              await new Promise((resolve) => setTimeout(resolve, 5));
              ctx.expect($a.children[0].className, 'the exhausted ladder rendered the promo').toBe('omega-vert-promo');
              getOmega().config.advertising = saved;
            },
          });

          cases.push({
            name: 'Verts Module > element binding (data-omega-vert) > an armed-but-not-intersecting unit runs NOTHING until it nears the viewport',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const saved = getOmega().config.advertising;
              getOmega().config.advertising = {}; // exhausted ladder → promo the moment it runs

              let observed = null;
              let callback = null;
              global.IntersectionObserver = class {
                constructor(cb) { callback = cb; }
                observe($el) { observed = $el; }
                disconnect() { this.disconnected = true; }
              };

              try {
                const $el = makeAdElement({ 'data-omega-vert': 'house' });
                ctx.expect(getOmega().verts.mount($el), 'lazy mounts return nothing yet').toBe(null);
                ctx.expect(observed, 'the host is observed, not rendered').toBe($el);
                ctx.expect($el.children.length, 'no lane ran, not even the promo').toBe(0);

                // Out of view → still nothing
                callback([{ isIntersecting: false }]);
                ctx.expect($el.children.length).toBe(0);

                // Near the viewport → the ladder runs and ends at the promo
                callback([{ isIntersecting: true }]);
                await new Promise((resolve) => setTimeout(resolve, 5));
                ctx.expect($el.children[0].className).toBe('omega-vert-promo');
              } finally {
                delete global.IntersectionObserver;
                getOmega().config.advertising = saved;
              }
            },
          });
          return cases;
        })(),
      );

      cases.push(
        ...(() => {
          const cases = [];
          // The promo frame is sandboxed without allow-same-origin, so real
          // messages arrive with origin 'null' and are identified by contentWindow
          function speak(unit, data, source) {
            unit.handleMessage({ origin: 'null', source: source || unit.$iframe.contentWindow, data });
          }

          function mountPromo(options = {}) {
            const $host = makeHost();
            const result = getOmega().verts.renderPromo($host, options);
            result.unit.$iframe.contentWindow = { name: 'promo-frame' };
            return { $host, unit: result.unit, result };
          }

          cases.push({
            name: 'Verts Module > the terminal promo lane > a narrow tall host reaches the document as width, so the promo stacks',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const $host = makeHost();
              $host.clientWidth = 200;
              const result = getOmega().verts.renderPromo($host, { size: 'skyscraper' });

              ctx.expect(result.unit.$iframe.srcdoc.includes('flex-direction: column;'), 'the skyscraper promo stacks').toBeTruthy();
              result.unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > the terminal promo lane > renders a real sandboxed iframe carrying the promo document, no network',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const { $host, unit, result } = mountPromo({ size: 'leaderboard' });

              ctx.expect(result.lane).toBe('promo');
              const $promo = $host.children[0];
              ctx.expect($promo).toBe(unit.$iframe);
              ctx.expect($promo.tag).toBe('iframe');
              ctx.expect($promo.className).toBe('omega-vert-promo');
              ctx.expect($promo.getAttribute('src'), 'never a network src').toBe(null);
              ctx.expect($promo.getAttribute('title')).toBe('Sponsored');
              ctx.expect($promo.getAttribute('frameborder')).toBe('0');
              ctx.expect($promo.getAttribute('scrolling')).toBe('no');
              ctx.expect($promo.getAttribute('allowtransparency')).toBe('true');
              ctx.expect($promo.getAttribute('sandbox')).toBe(vertsModule.PROMO_SANDBOX);
              ctx.expect(!vertsModule.PROMO_SANDBOX.includes('allow-same-origin'), 'a srcdoc frame never gets this origin').toBeTruthy();
              ctx.expect(vertsModule.IFRAME_SANDBOX.includes('allow-same-origin'), 'the house lane keeps its set').toBeTruthy();
              ctx.expect($promo.style.height, 'fills the reserved size').toBe('90px');
              ctx.expect($host.styles['max-height'], 'the host is capped like a real unit').toBe('90px');
              unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > the terminal promo lane > the srcdoc document is complete, local, and speaks the unit vocabulary',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const { unit } = mountPromo({ size: 'rectangle' });
              const doc = unit.$iframe.srcdoc;
              // The destination is the UTM-tagged promo url, escaped for the attribute
              const href = vertsModule.promoHref('rectangle', 'test').replace(/&/g, '&amp;');

              ctx.expect(doc.startsWith('<!DOCTYPE html>'), 'a complete document').toBeTruthy();
              ctx.expect(doc.includes('Built with OMEGA')).toBeTruthy();
              ctx.expect(doc.includes('omegajs.dev')).toBeTruthy();
              ctx.expect(doc.includes('<svg'), 'the mark is inline svg').toBeTruthy();
              ctx.expect(doc.includes(`href="${href}"`)).toBeTruthy();
              ctx.expect(doc.includes('target="_blank"')).toBeTruthy();
              ctx.expect(doc.includes('rel="noopener noreferrer sponsored"'), 'the served unit link contract').toBeTruthy();
              ctx.expect(doc.includes(vertsModule.MESSAGE_DIMENSIONS), 'reports its height').toBeTruthy();
              ctx.expect(doc.includes(vertsModule.MESSAGE_CLICK), 'forwards clicks').toBeTruthy();
              ctx.expect(doc.includes('window.parent.postMessage')).toBeTruthy();
              ctx.expect(doc.includes(JSON.stringify(global.window.location.origin)), 'messages are aimed at the host origin').toBeTruthy();

              // The promo link is the ONLY url in the document: nothing loads
              const urls = doc.match(/(?:src|href)="(https?:[^"]*)"/g) || [];
              ctx.expect(urls, 'no external asset, no request').toEqual([`href="${href}"`]);
              unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > the terminal promo lane > sizes the frame from an identified dimension message, clamped to the preset',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const { unit } = mountPromo({ size: 'rectangle' });

              // A report below the preset resizes the frame — proves the handler acts
              // (the mount already set 250px, so the clamp assertion alone could pass
              // against a handler that does nothing)
              speak(unit, { type: vertsModule.MESSAGE_DIMENSIONS, id: vertsModule.PROMO_ID, height: 120 });
              ctx.expect(unit.$iframe.style.height, 'an in-range report resizes').toBe('120px');

              speak(unit, { type: vertsModule.MESSAGE_DIMENSIONS, id: vertsModule.PROMO_ID, height: 9000 });
              ctx.expect(unit.$iframe.style.height, 'an oversized report clamps to the preset').toBe('250px');
              unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > the terminal promo lane > ignores dimension messages from any window that is not its own frame',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const { unit } = mountPromo({ size: 'rectangle' });

              speak(unit, { type: vertsModule.MESSAGE_DIMENSIONS, height: 120 }, { name: 'other-frame' });
              unit.handleMessage({ origin: 'null', data: { type: vertsModule.MESSAGE_DIMENSIONS, height: 120 } });
              ctx.expect(unit.$iframe.style.height, 'the mount height stands').toBe('250px');
              unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > the terminal promo lane > forwards the frame click to the host like a served unit does',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const $host = makeHost();
              let clicked = null;
              const result = getOmega().verts.renderPromo($host, {
                size: 'rectangle',
                onClick: (detail) => { clicked = detail; },
              });
              result.unit.$iframe.contentWindow = { name: 'promo-frame' };

              speak(result.unit, { type: vertsModule.MESSAGE_CLICK, id: vertsModule.PROMO_ID });
              ctx.expect(clicked).toEqual({ id: vertsModule.PROMO_ID });

              // A destroyed unit is inert
              clicked = null;
              result.unit.destroy();
              speak(result.unit, { type: vertsModule.MESSAGE_CLICK, id: vertsModule.PROMO_ID });
              ctx.expect(clicked).toBe(null);
            },
          });

          cases.push({
            name: 'Verts Module > the terminal promo lane > a short slot drops the pitch line so the copy never overflows',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const short = vertsModule.buildPromo(90).srcdoc;
              const tall = vertsModule.buildPromo(250).srcdoc;
              ctx.expect(!short.includes('full-stack JavaScript framework')).toBeTruthy();
              ctx.expect(short.includes('Built with OMEGA')).toBeTruthy();
              ctx.expect(short.includes('omegajs.dev')).toBeTruthy();
              ctx.expect(tall.includes('full-stack JavaScript framework')).toBeTruthy();
            },
          });

          cases.push({
            name: 'Verts Module > the terminal promo lane > carries the resolved theme across the frame boundary, literals either way',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const dark = vertsModule.buildPromo(250, 'dark').srcdoc;
              const unthemed = vertsModule.buildPromo(250).srcdoc;

              ctx.expect(dark.includes('<html lang="en" data-theme="dark">')).toBeTruthy();
              ctx.expect(unthemed.includes('<html lang="en">'), 'no theme follows the OS').toBeTruthy();
              ctx.expect(unthemed.includes('prefers-color-scheme: dark')).toBeTruthy();
              ctx.expect(!dark.includes('var(--omega-surface'), 'page tokens do not cross the boundary').toBeTruthy();
              ctx.expect(dark.includes('#16181d'), 'literal colours only').toBeTruthy();
            },
          });

          cases.push({
            name: 'Verts Module > the terminal promo lane > an unsized unit gets the minimum promo height',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const { unit, $host } = mountPromo({});
              ctx.expect(unit.$iframe.style.height).toBe('90px');
              ctx.expect($host.styles['max-height'], 'an unsized host stays uncapped').toBe(undefined);
              unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > the terminal promo lane > the promo document IS the shared renderer, fed the house promo data',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const { renderVertDocument, OMEGA_ACCENT } = await import('../src/modules/vert-document.js');

              const promo = vertsModule.buildPromoDocument(250, 'dark', 'https://host.example', '', 0, 'test');
              const direct = renderVertDocument({
                id: vertsModule.PROMO_ID,
                href: vertsModule.promoHref('', 'test'),
                title: 'Built with OMEGA',
                description: 'The full-stack JavaScript framework for web, backend, desktop, and extensions.',
                button: 'Visit omegajs.dev',
                imageMarkup: promo.match(/<svg[\s\S]*?<\/svg>/)[0],
                theme: 'dark',
                height: 250,
                accent: OMEGA_ACCENT,
                targetOrigin: 'https://host.example',
              });

              ctx.expect(promo, 'the promo takes the same pipeline a served vert takes').toBe(direct);
            },
          });

          cases.push({
            name: 'Verts Module > the terminal promo lane > wears the media-row look: thumb, copy, hairline, label + cta, content-sized',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const doc = vertsModule.buildPromo(250).srcdoc;

              ctx.expect(doc.includes('class="omega-vert-row"'), 'the media row').toBeTruthy();
              ctx.expect(doc.includes('class="omega-vert-thumb"'), 'thumbnail slot').toBeTruthy();
              ctx.expect(doc.includes('class="omega-vert-rule"'), 'the hairline').toBeTruthy();
              ctx.expect(doc.includes('class="omega-vert-foot"'), 'the bottom row').toBeTruthy();
              ctx.expect(doc.includes('<span class="omega-vert-label">Sponsored</span>'), 'the muted sponsored label').toBeTruthy();
              ctx.expect(doc.includes('<span class="omega-vert-button">Visit omegajs.dev</span>'), 'the accent cta button').toBeTruthy();
              ctx.expect(doc.includes('#4f46e5'), 'the promo passes the omega indigo accent').toBeTruthy();
              ctx.expect(!/height: \d+px/.test(doc.replace(/height: 32px|height: 56px|height: 1px/g, '')), 'content-sized: no reserved height is baked into the card').toBeTruthy();
            },
          });

          cases.push({
            name: 'Verts Module > the terminal promo lane > un-hides a host a failed lane left behind and recaps it to its own size',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const $host = makeHost();
              $host.style.setProperty('display', 'none');
              $host.style.setProperty('max-height', '600px');

              const result = getOmega().verts.renderPromo($host, { size: 'rectangle' });
              ctx.expect($host.styles.display).toBe(undefined);
              ctx.expect($host.styles['max-height']).toBe('250px');
              result.unit.destroy();
            },
          });
          return cases;
        })(),
      );

      cases.push(
        {
          name: 'Verts Module > house unit — host-owned lifecycle > isStale reflects staleAfter against the last (re)load',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const $host = makeHost();
            const { unit } = getOmega().verts.renderHouse($host, {
              source: 'https://verts.example.com',
              fillTimeout: 60000,
              staleAfter: 1000 * 60 * 10,
            });

            const now = Date.now();
            unit.lastLoadedAt = now - 1000 * 60 * 11;
            ctx.expect(unit.isStale(now)).toBe(true);
            unit.lastLoadedAt = now - 1000 * 60 * 9;
            ctx.expect(unit.isStale(now)).toBe(false);
            unit.destroy();
          },
        },
        {
          name: 'Verts Module > house unit — host-owned lifecycle > recover reloads only a stale, filled unit',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const $host = makeHost();
            const { unit } = getOmega().verts.renderHouse($host, {
              source: 'https://verts.example.com',
              fillTimeout: 60000,
            });
            let reloads = 0;
            unit.reload = () => { reloads += 1; };

            // Not filled yet → no recovery reload
            unit.lastLoadedAt = 0;
            unit.recover();
            ctx.expect(reloads).toBe(0);

            // Filled + stale → reload
            unit.filled = true;
            unit.recover();
            ctx.expect(reloads).toBe(1);

            // Filled + fresh → no reload
            unit.lastLoadedAt = Date.now();
            unit.recover();
            ctx.expect(reloads).toBe(1);
            unit.destroy();
          },
        },
        {
          name: 'Verts Module > house unit — host-owned lifecycle > rotation reloads on the configured interval and stops on destroy',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const $host = makeHost();
            const { unit } = getOmega().verts.renderHouse($host, {
              source: 'https://verts.example.com',
              fillTimeout: 60000,
              rotateInterval: 25,
            });
            let reloads = 0;
            unit.reload = () => { reloads += 1; };

            // Poll for two ticks under a generous ceiling: a loaded machine delays
            // the timer, and the promise is that it fires, not how fast
            for (const deadline = Date.now() + 2000; reloads < 2 && Date.now() < deadline;) await new Promise((resolve) => setTimeout(resolve, 5));
            ctx.expect(reloads >= 2, `rotation never reached two ticks (${reloads})`).toBeTruthy();

            unit.destroy();
            const after = reloads;
            await new Promise((resolve) => setTimeout(resolve, 60));
            ctx.expect(reloads, 'destroy stops rotation').toBe(after);
          },
        },
        {
          name: 'Verts Module > house unit — host-owned lifecycle > reload re-arms the fill timer with a fresh cache-busted URL',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const $host = makeHost();
            const { unit } = getOmega().verts.renderHouse($host, {
              source: 'https://verts.example.com',
              fillTimeout: 60000,
            });
            unit.filled = true;
            const firstSrc = unit.$iframe.src;

            await new Promise((resolve) => setTimeout(resolve, 5));
            unit.fillTimeout = 30;
            unit.reload('stale');
            ctx.expect(unit.filled, 'reload resets fill state').toBe(false);
            ctx.expect(unit.$iframe.src, 'fresh serve URL').not.toBe(firstSrc);

            // The re-armed fill timer tears down an unanswered reload
            await new Promise((resolve) => setTimeout(resolve, 80));
            ctx.expect(unit.destroyed).toBe(true);
          },
        },
      );

      // #44 — auto-UTM on the destination + host-side click analytics (no forward page)
      cases.push(
        ...(() => {
          const cases = [];
          // The real analytics instance, wrapped: every call is recorded AND passed
          // through to the module's own event() (no stand-in implementation).
          function recordAnalytics(run) {
            const analytics = getOmega().analytics;
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

          cases.push({
            name: 'Verts Module > click tracking + utm > tags the promo destination with the vert utm set, slot as utm_content',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const href = promoHrefOf(vertsModule.buildPromo(90, '', 'leaderboard', 0, 'test').srcdoc);

              ctx.expect(href.origin + href.pathname).toBe('https://omegajs.dev/');
              ctx.expect(href.searchParams.get('utm_source'), 'the host brand id').toBe('test');
              ctx.expect(href.searchParams.get('utm_medium')).toBe('omega-vert');
              ctx.expect(href.searchParams.get('utm_campaign')).toBe('omega-promo');
              ctx.expect(href.searchParams.get('utm_content')).toBe('leaderboard');
              ctx.expect([...href.searchParams.keys()].length, 'only the utm set rides along').toBe(4);
            },
          });

          cases.push({
            name: 'Verts Module > click tracking + utm > an unsized promo slot carries no utm_content',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const href = promoHrefOf(vertsModule.buildPromo(250).srcdoc);

              ctx.expect(href.searchParams.get('utm_content')).toBe(null);
              ctx.expect(href.searchParams.get('utm_medium')).toBe('omega-vert');
            },
          });

          cases.push({
            name: 'Verts Module > click tracking + utm > a mounted promo tags utm_source with the HOST brand id, not the host page',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const $host = makeHost();
              const result = getOmega().verts.renderPromo($host, { size: 'rectangle' });
              const href = promoHrefOf(result.unit.$iframe.srcdoc);

              ctx.expect(href.searchParams.get('utm_source'), 'the config brand.id').toBe('test');
              result.unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > click tracking + utm > a brand with no id falls back to the host page hostname',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const saved = getOmega().config.brand;
              getOmega().config.brand = { name: 'No Id' };

              const $host = makeHost();
              const result = getOmega().verts.renderPromo($host, { size: 'rectangle' });
              const href = promoHrefOf(result.unit.$iframe.srcdoc);

              ctx.expect(href.searchParams.get('utm_source'), 'the parent host fallback').toBe('localhost');
              result.unit.destroy();
              getOmega().config.brand = saved;
            },
          });

          cases.push({
            name: 'Verts Module > click tracking + utm > the house serve URL carries the brand id, so the redirect route tags the same source',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const $host = makeHost();
              const { unit } = getOmega().verts.renderHouse($host, {
                source: 'https://verts.example.com',
                fillTimeout: 60000,
              });

              const serve = new URL(unit.$iframe.src);
              ctx.expect(serve.searchParams.get('brand'), 'the config brand.id').toBe('test');
              unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > click tracking + utm > a brand with no id sends no brand param, so the backend falls back to the parent host',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const saved = getOmega().config.brand;
              getOmega().config.brand = { name: 'No Id' };

              const $host = makeHost();
              const { unit } = getOmega().verts.renderHouse($host, {
                source: 'https://verts.example.com',
                fillTimeout: 60000,
              });

              ctx.expect(new URL(unit.$iframe.src).searchParams.get('brand')).toBe(null);
              unit.destroy();
              getOmega().config.brand = saved;
            },
          });

          cases.push({
            name: 'Verts Module > click tracking + utm > the promo click message fires the host-side analytics event',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const $host = makeHost();
              const result = getOmega().verts.renderPromo($host, { size: 'rectangle' });
              result.unit.$iframe.contentWindow = { name: 'promo-frame' };

              const calls = recordAnalytics(() => {
                result.unit.handleMessage({
                  origin: 'null',
                  source: result.unit.$iframe.contentWindow,
                  data: { type: vertsModule.MESSAGE_CLICK, id: vertsModule.PROMO_ID },
                });
              });

              ctx.expect(calls.length, 'exactly one event per click').toBe(1);
              ctx.expect(calls[0].name).toBe('vert_click');
              ctx.expect(calls[0].params).toEqual({
                vert_id: vertsModule.PROMO_ID,
                vert_lane: 'promo',
                vert_campaign: 'omega-promo',
                vert_slot: 'rectangle',
                vert_source: 'localhost',
              });

              result.unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > click tracking + utm > the house click message fires the host-side analytics event',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const $host = makeHost();
              const { unit } = getOmega().verts.renderHouse($host, {
                source: 'https://verts.example.com',
                size: 'banner',
                fillTimeout: 60000,
              });

              const calls = recordAnalytics(() => {
                unit.handleMessage({ origin: 'https://verts.example.com', data: { type: vertsModule.MESSAGE_CLICK, id: 'vert123' } });
              });

              ctx.expect(calls.length, 'exactly one event per click').toBe(1);
              ctx.expect(calls[0].name).toBe('vert_click');
              ctx.expect(calls[0].params).toEqual({
                vert_id: 'vert123',
                vert_lane: 'house',
                vert_campaign: 'vert123',
                vert_slot: 'banner',
                vert_source: 'localhost',
              });

              unit.destroy();
            },
          });

          cases.push({
            name: 'Verts Module > click tracking + utm > a message that is not a click fires nothing',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              const $host = makeHost();
              const { unit } = getOmega().verts.renderHouse($host, {
                source: 'https://verts.example.com',
                size: 'banner',
                fillTimeout: 60000,
              });

              const calls = recordAnalytics(() => {
                unit.handleMessage({ origin: 'https://verts.example.com', data: { type: vertsModule.MESSAGE_DIMENSIONS, height: 120 } });
                unit.handleMessage({ origin: 'https://evil.example', data: { type: vertsModule.MESSAGE_CLICK, id: 'vert123' } });
              });

              ctx.expect(calls.length).toBe(0);
              unit.destroy();
            },
          });
          return cases;
        })(),
      );

      // #150 — the slot read must resolve the schema's *Slot keys
      // (advertising.providers.adsense.displaySlot etc.), not a slots.* subobject
      cases.push(
        {
          name: 'Verts Module > adsense slot wiring > _buildIns wires data-ad-slot from each schema *Slot key',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const verts = getOmega().verts;
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
              ctx.expect($ins.getAttribute('data-ad-slot'), `${type} slot`).toBe(slot);
            }
          },
        },
        {
          name: 'Verts Module > adsense slot wiring > _buildIns omits data-ad-slot when the slot is not configured',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const format = vertsModule.ADSENSE_FORMATS.display;
            const $ins = getOmega().verts._buildIns({ client: 'ca-pub-test' }, 'display', format, {});
            ctx.expect($ins.getAttribute('data-ad-slot')).toBe(null);
          },
        },
      );
      return cases;
    })(),
  ],
});
