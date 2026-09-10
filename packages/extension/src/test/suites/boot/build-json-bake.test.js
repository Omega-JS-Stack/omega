// Boot-layer test for the OMEGA_BUILD_JSON bake
// ([#743](https://github.com/Omega-JS-Stack/omega/issues/743)).
//
// The build-lane suite proves the emitted bundles carry the snapshot. This one
// proves the artifact a BROWSER loads resolves it — in the two contexts that
// used to reach it by two different mechanisms:
//
//   - the service worker, which read `/build.js` through an importScripts() call
//   - a page, which read it from a `<script src="/build.js">` tag the page
//     template emitted ahead of the page's own bundle
//
// Neither file is in the artifact any more, so a lane that only asserted the
// global would pass on a build that still shipped the old file. The absence is
// asserted from inside the extension, over the extension's own origin — the one
// place a leftover `/build.js` would still be fetchable.

const defineCases = require('@omega.js/devkit/test/define-cases');

// What every context should agree on. `brand.id` is the one key every brand's
// snapshot has and the SW reads on its first line (background.js `this.brand`).
const READ_BRAND = () => (globalThis.OMEGA_BUILD_JSON || {}).config?.brand?.id ?? null;

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  description: 'OMEGA_BUILD_JSON — baked into the bundles, no /build.js in the artifact (#743)',
  tests: [
    {
      description: 'the packaged service worker resolves OMEGA_BUILD_JSON.config.brand',
      inspect: async ({ extension, expect }) => {
        expect(extension.swTarget).not.toBeNull();
        const worker = await extension.swTarget.worker();

        // `self` is what background.js reads; globalThis is the same object in a
        // service worker, and the banner assigns both.
        const fromSelf = await worker.evaluate(() => (self.OMEGA_BUILD_JSON || {}).config?.brand?.id ?? null);
        expect(typeof fromSelf).toBe('string');
        expect(fromSelf.length > 0).toBe(true);

        const fromGlobal = await worker.evaluate(READ_BRAND);
        expect(fromGlobal).toBe(fromSelf);
      },
    },
    {
      description: 'the packaged popup resolves the SAME snapshot from its own bundle',
      inspect: async ({ extension, page, expect }) => {
        const worker = await extension.swTarget.worker();
        const inWorker = await worker.evaluate(READ_BRAND);

        await page.goto(extension.popupUrl, { waitUntil: 'load' });
        const inPage = await page.evaluate(() => (window.OMEGA_BUILD_JSON || {}).config?.brand?.id ?? null);

        // Every bundle carries its OWN copy — the promise is that they agree.
        expect(inPage).toBe(inWorker);
      },
    },
    {
      description: 'no /build.js and no /build.json are reachable on the extension origin',
      inspect: async ({ extension, page, expect }) => {
        await page.goto(extension.popupUrl, { waitUntil: 'domcontentloaded' });

        const reachable = await page.evaluate(async (id) => {
          const probe = async (file) => {
            try {
              const response = await fetch(`chrome-extension://${id}/${file}`);
              return response.ok;
            } catch (e) {
              // chrome refuses a fetch for a path the extension does not ship
              return false;
            }
          };
          return { js: await probe('build.js'), json: await probe('build.json') };
        }, extension.id);

        expect(reachable.js).toBe(false);
        expect(reachable.json).toBe(false);
      },
    },
  ],
});
