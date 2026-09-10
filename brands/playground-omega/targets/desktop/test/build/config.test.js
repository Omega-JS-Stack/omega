/**
 * Build-layer test: this project's own config/omega.json5 resolves to the
 * identity the desktop app ships with.
 *
 * @omega.js/desktop's corpus already proves the RESOLVER (merge chain, derived
 * defaults, repo derivation). What no framework test can know is what THIS brand
 * declares, and every declaration below is load-bearing at build time: the brand
 * id names the app, the product name is stamped into the window title, the tray
 * and every artifact filename, `releases` opts the download links in, and the two
 * derived repos address where a release is published and dispatched from.
 *
 * A silent edit to config/omega.json5 that renamed the brand or dropped the
 * releases block would still build a green app that published to the wrong repo,
 * so the expected values are hard-coded here, never read back out of the config.
 */

const Manager = require('@omega.js/desktop/build');
const { brandRepo, releasesRepo } = require('@omega.js/desktop/config');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'omega.json5: the playground desktop identity',
  tests: [
    {
      name: 'resolves this brand and the product name the app is built under',
      run: (ctx) => {
        const config = Manager.getConfig();

        ctx.expect(config.brand.id).toBe('playground');
        // Not declared under targets.desktop.app, so derived from brand.name.
        ctx.expect(config.app.productName).toBe('OMEGA Playground');
      },
    },

    {
      name: 'the desktop target is enabled and opts into release downloads',
      run: (ctx) => {
        const config = Manager.getConfig();

        // Key presence under `targets` IS the enable switch.
        ctx.expect(typeof config.targets.desktop).toBe('object');
        // #124: download links are opt-in, and the playground keeps the block to
        // exercise the derivation the two repo assertions below cover.
        ctx.expect(typeof config.releases).toBe('object');
      },
    },

    {
      name: 'derives the releases repo and the brand repo this target publishes to',
      run: (ctx) => {
        const config = Manager.getConfig();

        // Nothing declares a releases repo, so the `<brand.id>-releases` default
        // under the brand repo's owner is the address every release verb uses.
        ctx.expect(releasesRepo(config).name).toBe('playground-releases');
        ctx.expect(releasesRepo(config).repo).toBe('Omega-JS-Stack/playground-releases');

        // Nothing declares a brand repo either, so the `<brand.id>-omega` default
        // of the `<brand.id>-<role>` rule resolves the source repo.
        ctx.expect(brandRepo(config).repo).toBe('Omega-JS-Stack/playground-omega');
      },
    },
  ],
};
