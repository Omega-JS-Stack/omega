/**
 * Boot-layer test: the packaged manifest grants what the notes feature uses,
 * and the content script is confined to the brand's own site.
 *
 * src/manifest.json writes the content-script match as the brand.url config
 * token, so this reads the compiled manifest of the extension Chromium loaded:
 * the token must have resolved to the brand origin. brand.url must stay a bare
 * origin for the resolved match to cover the whole site.
 */
const build = require('@omega.js/extension/build');
const { defineCases } = require('@omega.js/extension/test');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  description: 'manifest: the notes permissions and the brand-only content script (packaged)',
  tests: [
    {
      description: 'the content script matches the brand origin and nothing else',
      inspect: async ({ extension, expect }) => {
        const origin = new URL(build.getConfig().brand.url).origin;
        const scripts = extension.manifest.content_scripts;

        expect(scripts.length).toBe(1);
        expect(scripts[0].matches).toEqual([`${origin}/*`]);
        expect(build.getConfig().brand.url).toBe(origin);
        expect(scripts[0].js).toEqual(['assets/js/components/content.bundle.js']);
      },
    },
    {
      description: 'the permissions the notes surfaces need are declared',
      inspect: async ({ extension, expect }) => {
        const { permissions } = extension.manifest;

        for (const permission of ['tabs', 'storage', 'offscreen', 'sidePanel']) {
          expect(permissions).toContain(permission);
        }
      },
    },
  ],
});
