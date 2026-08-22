/**
 * Test: `config.resolved.*` — the config-DERIVED values @omega.js/backend hands
 * consumer code ([#290](https://github.com/Omega-JS-Stack/omega/issues/290)).
 *
 * A brand target cannot require @omega.js/config (private, vendored), so a brand
 * that needed the GitHub repo slug at runtime re-implemented the derivation and
 * the copy drifted from the real merge rules. The framework runs the recipe at
 * boot and publishes the finished value at `config.resolved.github`.
 *
 * Two things are pinned: the exposed value obeys the REAL merge semantics
 * (a composed config, loaded by the real loader, with and without the backend
 * target's `github.repo` override), and it IS @omega.js/config's own derivation
 * rather than a second implementation living here. The booted Manager carries
 * the group, which is the surface consumer code actually reads.
 *
 * Run: npx omega test backend:helpers/resolved-config
 */
const path = require('path');
const jetpack = require('fs-jetpack');

const { resolvedConfigValues } = require('../../src/manager/helpers/resolved-config.js');
const { loadConfig, brandRepo } = require('./_shared-config.js');

// A real brand config on disk, composed through the real backend loader — the
// target overlay is the half of the rule no hand-built object proves.
function composeBrandConfig(targetsBackend) {
  const root = jetpack.tmpDir({ prefix: 'resolved-config-' }).path();

  jetpack.write(path.join(root, 'config', 'omega.json5'), `{
    brand: { id: 'acme' },
    repo: { providers: { github: { org: 'Acme-Org' } } },
    targets: { backend: ${JSON.stringify(targetsBackend)} },
  }`);

  try {
    return loadConfig(root, 'backend').config;
  } finally {
    jetpack.remove(root);
  }
}

module.exports = {
  description: 'config.resolved — derived values the framework hands consumer code',
  type: 'group',

  tests: [
    {
      name: 'github-repo-slug-derives-from-the-shared-provider-block',
      auth: 'none',

      async run({ assert }) {
        const config = composeBrandConfig({});

        assert.deepEqual(resolvedConfigValues(config).github, {
          owner: 'Acme-Org',
          name: 'acme',
          repo: 'Acme-Org/acme',
        });
      },
    },

    {
      name: 'backend-target-github-override-wins',
      auth: 'none',

      async run({ assert }) {
        const config = composeBrandConfig({ github: { repo: 'itw-creative-works/acme-content' } });

        assert.deepEqual(resolvedConfigValues(config).github, {
          owner: 'itw-creative-works',
          name: 'acme-content',
          repo: 'itw-creative-works/acme-content',
        });
      },
    },

    {
      name: 'the-exposed-value-is-config-packages-own-derivation',
      auth: 'none',

      async run({ assert }) {
        // The whole point of #290: ONE implementation, in @omega.js/config. If
        // this ever diverges, a second copy of the rule has grown here.
        for (const targetsBackend of [{}, { github: { repo: 'itw-creative-works/acme-content' } }]) {
          const config = composeBrandConfig(targetsBackend);

          assert.deepEqual(resolvedConfigValues(config).github, brandRepo(config),
            `resolved.github must equal @omega.js/config's brandRepo() (targets.backend: ${JSON.stringify(targetsBackend)})`);
        }
      },
    },

    {
      name: 'booted-manager-publishes-the-group',
      auth: 'none',

      async run({ assert, Manager }) {
        // The surface consumer code reads: `Manager.config.resolved.github.repo`
        // on the config object every route/hook/cron already receives.
        assert.equal(typeof Manager.config.resolved.github.repo, 'string', 'the booted config must carry resolved.github.repo');
        assert.deepEqual(Manager.config.resolved.github, brandRepo(Manager.config), 'the booted value must be the config package derivation');
      },
    },
  ],
};
