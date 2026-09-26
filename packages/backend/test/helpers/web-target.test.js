/**
 * Test: `resolveWebTarget()`, the one-or-many rule the CMS routes address a
 * website by ([#887](https://github.com/Omega-JS-Stack/omega/issues/887)).
 *
 * A brand's website lives at `targets/<name>/` and ONE backend serves every
 * website the brand runs, so "which site is this post for?" has to be
 * answerable before any path is composed. The rule: optional when the brand
 * runs exactly one web target, REQUIRED when it runs several, and a missing or
 * unknown name fails loudly with the declared list rather than guessing.
 *
 * The configs are real ones, written to disk and read back through the backend
 * loader, so the target map the helper reads is the map a deployed backend
 * reads.
 *
 * Run: npx omega test backend:helpers/web-target
 */
const { resolveWebTarget, cmsContext } = require('../../dist/omega/helpers/web-target.js');
const { brandConfig } = require('./_cms-target-harness.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const ONE_WEBSITE = { web: { type: 'web' }, backend: { type: 'backend' } };
const TWO_WEBSITES = { web: { type: 'web' }, community: { type: 'web' }, backend: { type: 'backend' } };

// What a route does with the throw: the message is the response body.
function refusal(config, requested) {
  try {
    resolveWebTarget(config, requested);
  } catch (e) {
    return e;
  }

  return null;
}

module.exports = defineCases({
  description: 'resolveWebTarget: which website a CMS request writes into',
  type: 'group',

  tests: [
    {
      name: 'one-web-target-needs-no-parameter',
      auth: 'none',

      async run({ assert }) {
        const config = brandConfig(ONE_WEBSITE);

        assert.deepEqual(resolveWebTarget(config, undefined), { name: 'web', path: 'targets/web' },
          'the brand\'s only website is the default');
        assert.deepEqual(resolveWebTarget(config, ''), { name: 'web', path: 'targets/web' },
          'an empty parameter is the same as none');
      },
    },

    {
      name: 'naming-the-only-web-target-is-allowed',
      auth: 'none',

      async run({ assert }) {
        assert.deepEqual(resolveWebTarget(brandConfig(ONE_WEBSITE), 'web'), { name: 'web', path: 'targets/web' });
      },
    },

    {
      name: 'several-web-targets-require-the-name',
      auth: 'none',

      async run({ assert }) {
        const error = refusal(brandConfig(TWO_WEBSITES), undefined);

        assert.ok(error, 'two websites and no name must never resolve to a guess');
        assert.equal(error.code, 400, 'the refusal is the caller\'s fault, so it answers 400');
        assert.match(error.message, /Missing required parameter: target/);
        assert.match(error.message, /\[web, community\]/, 'the message lists every declared web target');
      },
    },

    {
      name: 'the-named-target-wins-when-several-exist',
      auth: 'none',

      async run({ assert }) {
        assert.deepEqual(resolveWebTarget(brandConfig(TWO_WEBSITES), 'community'), { name: 'community', path: 'targets/community' });
      },
    },

    {
      name: 'an-unknown-name-fails-with-the-list',
      auth: 'none',

      async run({ assert }) {
        const error = refusal(brandConfig(TWO_WEBSITES), 'blog');

        assert.ok(error, 'a name nobody declared must not resolve');
        assert.equal(error.code, 400);
        assert.match(error.message, /Unknown target "blog"/);
        assert.match(error.message, /\[web, community\]/);
      },
    },

    {
      name: 'a-non-web-target-is-never-a-candidate',
      auth: 'none',

      async run({ assert }) {
        // The backend is a target too, and it is not a place content lands.
        const error = refusal(brandConfig(ONE_WEBSITE), 'backend');

        assert.ok(error, 'only web targets are addressable here');
        assert.match(error.message, /Unknown target "backend"/);
      },
    },

    // The other half of what a CMS route needs before it touches content: the
    // SOURCE repo it commits to. One call answers both, and both failures
    // arrive response-shaped, so a route is one respond either way.
    {
      name: 'cms-context-answers-the-source-repo-and-the-target',
      auth: 'none',

      async run({ assert }) {
        const { source, target } = cmsContext(brandConfig(ONE_WEBSITE), undefined);

        assert.deepEqual(source, { owner: 'Acme-Org', name: 'acme-omega', slug: 'Acme-Org/acme-omega' },
          'the content repo is <brand.id>-omega under repo.org');
        assert.deepEqual(target, { name: 'web', path: 'targets/web' });
      },
    },

    {
      name: 'cms-context-with-no-repo-block-is-a-500-naming-the-key',
      auth: 'none',

      async run({ assert }) {
        // A brand that declares no `repo` block: the BACKEND is misconfigured,
        // not the caller, so this is a 500 and not one of the 400s a bad
        // `target` earns.
        const config = { ...brandConfig(ONE_WEBSITE) };
        delete config.repo;

        let error = null;
        try {
          cmsContext(config, undefined);
        } catch (e) {
          error = e;
        }

        assert.ok(error, 'half an address commits nowhere');
        assert.equal(error.code, 500, 'the route answers with e.code, with no `|| 400` to fall back on');
        assert.match(error.message, /GitHub repo not configured/);
        assert.match(error.message, /repo\.org/, 'and it names the key to set');
      },
    },

    {
      name: 'cms-context-passes-the-target-400-through',
      auth: 'none',

      async run({ assert }) {
        let error = null;
        try {
          cmsContext(brandConfig(TWO_WEBSITES), undefined);
        } catch (e) {
          error = e;
        }

        assert.ok(error, 'several websites, no name: nothing is guessed');
        assert.equal(error.code, 400, 'a request problem stays a request problem');
        assert.match(error.message, /Missing required parameter: target/);
      },
    },

    {
      name: 'no-web-target-at-all-fails-loudly',
      auth: 'none',

      async run({ assert }) {
        const error = refusal(brandConfig({ backend: { type: 'backend' } }), undefined);

        assert.ok(error, 'content cannot land in a brand that runs no website');
        assert.equal(error.code, 400);
        assert.match(error.message, /declares no web target/);
      },
    },
  ],
});
