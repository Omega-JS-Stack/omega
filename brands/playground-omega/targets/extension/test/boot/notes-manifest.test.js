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
  timeout: 45000,
  description: 'manifest: the notes permissions and the brand-only content script (packaged)',
  tests: [
    {
      name: 'the content script matches the brand origin and nothing else',
      run: async (ctx) => {
        const origin = new URL(build.getConfig().brand.url).origin;
        const scripts = ctx.extension.manifest.content_scripts;

        ctx.expect(scripts.length).toBe(1);
        ctx.expect(scripts[0].matches).toEqual([`${origin}/*`]);
        ctx.expect(build.getConfig().brand.url).toBe(origin);
        ctx.expect(scripts[0].js).toEqual(['assets/js/components/content.bundle.js']);
      },
    },
    {
      name: 'the permissions the notes surfaces need are declared',
      run: async (ctx) => {
        const { permissions } = ctx.extension.manifest;

        for (const permission of ['tabs', 'storage', 'offscreen', 'sidePanel']) {
          ctx.expect(permissions).toContain(permission);
        }
      },
    },
  ],
});
