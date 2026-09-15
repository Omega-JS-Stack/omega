// Boot-layer test for the OMEGA_BUILD_JSON bake
// ([#743](https://github.com/Omega-JS-Stack/omega/issues/743)).
//
// The build-lane suite proves the build writes the one `dist/build.js` and that
// no bundle carries a copy of it. This one proves the artifact a BROWSER loads
// resolves it, in the two contexts that load the same file two legal ways:
//
//   - the service worker, through `importScripts('/build.js')` on its first line
//   - a page, through the `<script src="/build.js">` tag the page template emits
//     ahead of the page's own bundle
//
// The file itself is fetchable over the extension's own origin, which is what a
// script tag and importScripts both do, and that is asserted from inside the
// extension. The `build.json` sidecar nothing read stays gone.

const defineCases = require('@omega.js/devkit/test/define-cases');

// What every context should agree on. `brand.id` is the one key every brand's
// snapshot has and the SW reads on its first line (background.js `this.brand`).
const READ_BRAND = () => (globalThis.OMEGA_BUILD_JSON || {}).config?.brand?.id ?? null;

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  description: 'OMEGA_BUILD_JSON: one /build.js, loaded by every context (#743)',
  tests: [
    {
      description: 'the packaged service worker resolves OMEGA_BUILD_JSON.config.brand',
      inspect: async ({ extension, expect }) => {
        expect(extension.swTarget).not.toBeNull();
        const worker = await extension.swTarget.worker();

        // `self` is what background.js reads, and globalThis is the same object
        // in a service worker: the file assigns `self`, so both answer.
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

        // ONE file, both contexts: the promise is that they cannot disagree.
        expect(inPage).toBe(inWorker);
      },
    },
    {
      description: '/build.js is reachable on the extension origin, /build.json is not',
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

        // The one file every context loads…
        expect(reachable.js).toBe(true);
        // …and no sidecar describing the same build a second time.
        expect(reachable.json).toBe(false);
      },
    },
  ],
});
