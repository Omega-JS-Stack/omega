/**
 * Test: `config.resolved.*` — the config-DERIVED values @omega.js/backend hands
 * consumer code ([#290](https://github.com/Omega-JS-Stack/omega/issues/290)).
 *
 * A brand target cannot require @omega.js/config (private, vendored), so a brand
 * that needed the GitHub repo slug at runtime re-implemented the derivation and
 * the copy drifted from the real merge rules. The framework runs the recipe at
 * boot and publishes the finished value at `config.resolved.github`.
 *
 * Two things are pinned: the exposed value is the SOURCE repo the one `repo`
 * block derives ([#883](https://github.com/Omega-JS-Stack/omega/issues/883):
 * `<brand.id>-omega` under `repo.org`, loaded by the real loader), and it IS
 * @omega.js/config's own derivation rather than a second implementation living
 * here. The booted Omega instance carries the group, which is the surface consumer
 * code actually reads.
 *
 * Run: npx omega test backend:helpers/resolved-config
 */
const path = require('path');
const jetpack = require('fs-jetpack');

const { resolvedConfigValues } = require('../../dist/omega/helpers/resolved-config.js');
const { loadConfig, sourceRepo } = require('./_shared-config.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// A real brand config on disk, composed through the real backend loader — the
// target overlay is the half of the rule no hand-built object proves.
function composeBrandConfig(targetsBackend, repo) {
  const root = jetpack.tmpDir({ prefix: 'resolved-config-' }).path();

  jetpack.write(path.join(root, 'config', 'omega.json5'), `{
    brand: { id: 'acme' },
    ${repo === null ? '' : `repo: ${JSON.stringify(repo || { provider: 'github', org: 'Acme-Org' })},`}
    targets: { backend: ${JSON.stringify({ type: 'backend', ...targetsBackend })} },
  }`);

  try {
    return loadConfig(root, 'backend').config;
  } finally {
    jetpack.remove(root);
  }
}

module.exports = defineCases({
  description: 'config.resolved — derived values the framework hands consumer code',
  type: 'group',

  tests: [
    {
      name: 'the-source-repo-derives-from-the-one-repo-block',
      auth: 'none',

      async run({ assert }) {
        const config = composeBrandConfig({});

        assert.deepEqual(resolvedConfigValues(config).github, {
          owner: 'Acme-Org',
          name: 'acme-omega',
          slug: 'Acme-Org/acme-omega',
        });
      },
    },

    {
      name: 'no-repo-block-is-null-never-half-an-address',
      auth: 'none',

      async run({ assert }) {
        // #883: a brand that declares no org has no content repo, and the CMS
        // routes answer "GitHub repo not configured" off exactly this value.
        assert.equal(resolvedConfigValues(composeBrandConfig({}, null)).github, null);
      },
    },

    {
      name: 'the-exposed-value-is-config-packages-own-derivation',
      auth: 'none',

      async run({ assert }) {
        // The whole point of #290: ONE implementation, in @omega.js/config. If
        // this ever diverges, a second copy of the rule has grown here.
        for (const repo of [undefined, { provider: 'github', org: 'Other-Org' }]) {
          const config = composeBrandConfig({}, repo);

          assert.deepEqual(resolvedConfigValues(config).github, sourceRepo(config),
            `resolved.github must equal @omega.js/config's sourceRepo() (repo: ${JSON.stringify(repo)})`);
        }
      },
    },

    {
      name: 'booted-manager-publishes-the-group',
      auth: 'none',

      async run({ assert, omega }) {
        // The surface consumer code reads: `omega.config.resolved.github.slug`
        // on the config object every route/hook/cron already receives.
        assert.deepEqual(omega.config.resolved.github, sourceRepo(omega.config), 'the booted value must be the config package derivation');
      },
    },
  ],
});
