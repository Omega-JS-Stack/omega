/**
 * `site.target`: WHICH target this build IS
 * ([#887](https://github.com/Omega-JS-Stack/omega/issues/887)).
 *
 * A brand can run several websites (`targets/web`, `targets/community`), and
 * they share ONE backend. The CMS routes therefore take a `target` naming the
 * site a post belongs to, which means a page has to know its own target name:
 * `site.targets` is the MAP of every target the brand declares and answers a
 * different question entirely.
 *
 * The chain this pins, end to end: the resolved target name from the config
 * loader, the `site.target` build fact the engine publishes from it, and the
 * `OMEGA_BUILD_JSON.config.target` the build snapshot hands the client runtime (which is what
 * the admin post editor sends to the backend).
 *
 * Run: node --require @omega.js/devkit/test/stdout-guard --test test/site-target.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const expect = require('@omega.js/devkit/test/expect');

const { loadSiteData } = require('../src/consumer.js');
const { SITE_FACT_KEYS } = require('../src/config-sections.js');
const { buildWith, readBuildJson, miniData } = require('./lib/build.js');

/** A brand monorepo on disk whose ONE web target is named `community`. */
function brandWithCommunityTarget() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-target-'));

  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
    brand: { id: 'acme', name: 'Acme', url: 'https://acme.com' },
    targets: { community: { type: 'web' } },
  }`);
  fs.mkdirSync(path.join(root, 'targets', 'community'), { recursive: true });

  return path.join(root, 'targets', 'community');
}

/** The client config a built page hands the client runtime (#894). */
async function configurationOf(siteData, name) {
  const pages = await buildWith(siteData, {}, name);
  const buildJson = readBuildJson(pages);
  expect(buildJson, 'the build wrote the OMEGA_BUILD_JSON snapshot').toBeTruthy();

  return buildJson.config;
}

module.exports = defineCases({
  type: 'group',
  description: 'site-target',
  tests: [
    {
      name: '#887: the site data carries the RESOLVED target name, not a guess',
      run: (ctx) => {
        const siteData = loadSiteData(brandWithCommunityTarget());

        ctx.expect(siteData.target, 'the target folder names the target, so a second website is addressable').toEqual({ name: 'community', type: 'web' });
      },
    },

    {
      name: '#887: site.target is a build fact, beside the targets map',
      run: async (ctx) => {
        ctx.expect(SITE_FACT_KEYS.includes('target'), 'the read census has to know the key, or a template read of it is refused').toBeTruthy();

        const config = await configurationOf({ ...miniData, target: { name: 'community', type: 'web' } }, 'site-target-bake');

        ctx.expect(config.target, 'the page hands the client its own target name, which is what the admin editor sends to the CMS routes').toBe('community');
      },
    },

    {
      name: '#887: a build with no resolved target bakes null, never a guessed name',
      run: async (ctx) => {
        const config = await configurationOf({ ...miniData }, 'site-target-absent');

        ctx.expect(config.target, 'an unknown target is stated as unknown; the backend default rule then applies').toBe(null);
      },
    },
  ],
});
