/**
 * Build-layer test: the manifest grants what the notes feature uses, and the
 * content script is confined to the brand's own site.
 *
 * A manifest carries no config tokens, so the content-script match is a
 * literal. This holds it to brand.url in config/omega.json5: a brand URL that
 * moves without the manifest fails here instead of silently injecting nowhere.
 */
const build = require('@omega.js/extension/build');

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'manifest: the notes permissions and the brand-only content script',
  tests: [
    {
      name: 'the content script matches the brand origin and nothing else',
      run: (ctx) => {
        const origin = new URL(build.getConfig().brand.url).origin;
        const scripts = build.getManifest().content_scripts;

        ctx.expect(scripts.length).toBe(1);
        ctx.expect(scripts[0].matches).toEqual([`${origin}/*`]);
        ctx.expect(scripts[0].js).toEqual(['assets/js/components/content.bundle.js']);
      },
    },
    {
      name: 'the permissions the notes surfaces need are declared',
      run: (ctx) => {
        const { permissions } = build.getManifest();

        for (const permission of ['tabs', 'storage', 'offscreen', 'sidePanel']) {
          ctx.expect(permissions).toContain(permission);
        }
      },
    },
  ],
};
