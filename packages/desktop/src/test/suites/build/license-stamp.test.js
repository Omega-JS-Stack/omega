// Build-layer tests for the license stamp the bundle bake carries
// ([#320](https://github.com/Omega-JS-Stack/omega/issues/320)).
//
// A packaged desktop app has no attribution surface and its payments ride the
// backend's own gate, so the stamp changes no behavior — it is the artifact's
// record of the verdict it was packaged under. What must hold: the stamp rides
// OMEGA_BUILD_JSON itself and never the `config` blob the renderer hands
// @omega.js/client, and a non-production build is keyless with no network call
// (the check is a deploy-time question, spec call 5).

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const FRAMEWORK_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { resolveLicenseStamp } = require('@omega.js/devkit/license');

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'license stamp — the verdict OMEGA_BUILD_JSON records (#320)',
  tests: [
    {
      name: 'the stamp rides the build blob, never the client config',
      run: (ctx) => {
        const { composeBuildJson } = require(path.join(FRAMEWORK_ROOT, 'src', 'gulp', 'tasks', 'bundle.js'));

        const buildJson = composeBuildJson({
          config: { brand: { id: 'paperloom' } },
          dev: null,
          pkg: { version: '3.1.4' },
          mode: { environment: 'production' },
          license: { status: 'licensed', payments: 'live', attribution: 'removed' },
        });

        ctx.expect(buildJson.license.status).toBe('licensed');
        ctx.expect(buildJson.license.attribution).toBe('removed');
        // The renderer merges `config` into what @omega.js/client sees — the
        // build's own facts (package, mode, license) stay outside it.
        ctx.expect(buildJson.config.license).toBeUndefined();
        ctx.expect(buildJson.config.brand.id).toBe('paperloom');
      },
    },
    {
      name: 'a non-production build stamps keyless and asks the network nothing',
      run: async (ctx) => {
        let called = false;
        const transport = async () => { called = true; };

        const stamp = await resolveLicenseStamp({
          config: { brand: { id: 'paperloom' }, cloud: { config: { projectId: 'paperloom-prod' } } },
          production: false,
          env: { OMEGA_LICENSE_KEY: 'a-real-looking-key' },
          transport,
        });

        ctx.expect(called).toBe(false);
        ctx.expect(stamp.status).toBe('keyless');
        ctx.expect(stamp.payments).toBe('gated');
        ctx.expect(stamp.attribution).toBe('shown');
      },
    },
  ],
});
