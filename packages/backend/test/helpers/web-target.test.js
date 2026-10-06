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

      async run({ expect }) {
        const config = brandConfig(ONE_WEBSITE);

        expect(resolveWebTarget(config, undefined), 'the brand\'s only website is the default').toEqual({ name: 'web', path: 'targets/web' });
        expect(resolveWebTarget(config, ''), 'an empty parameter is the same as none').toEqual({ name: 'web', path: 'targets/web' });
      },
    },

    {
      name: 'naming-the-only-web-target-is-allowed',
      auth: 'none',

      async run({ expect }) {
        expect(resolveWebTarget(brandConfig(ONE_WEBSITE), 'web')).toEqual({ name: 'web', path: 'targets/web' });
      },
    },

    {
      name: 'several-web-targets-require-the-name',
      auth: 'none',

      async run({ expect }) {
        const error = refusal(brandConfig(TWO_WEBSITES), undefined);

        expect(error, 'two websites and no name must never resolve to a guess').toBeTruthy();
        expect(error.code, 'the refusal is the caller\'s fault, so it answers 400').toBe(400);
        expect(error.message).toMatch(/Missing required parameter: target/);
        expect(error.message, 'the message lists every declared web target').toMatch(/\[web, community\]/);
      },
    },

    {
      name: 'the-named-target-wins-when-several-exist',
      auth: 'none',

      async run({ expect }) {
        expect(resolveWebTarget(brandConfig(TWO_WEBSITES), 'community')).toEqual({ name: 'community', path: 'targets/community' });
      },
    },

    {
      name: 'an-unknown-name-fails-with-the-list',
      auth: 'none',

      async run({ expect }) {
        const error = refusal(brandConfig(TWO_WEBSITES), 'blog');

        expect(error, 'a name nobody declared must not resolve').toBeTruthy();
        expect(error.code).toBe(400);
        expect(error.message).toMatch(/Unknown target "blog"/);
        expect(error.message).toMatch(/\[web, community\]/);
      },
    },

    {
      name: 'a-non-web-target-is-never-a-candidate',
      auth: 'none',

      async run({ expect }) {
        // The backend is a target too, and it is not a place content lands.
        const error = refusal(brandConfig(ONE_WEBSITE), 'backend');

        expect(error, 'only web targets are addressable here').toBeTruthy();
        expect(error.message).toMatch(/Unknown target "backend"/);
      },
    },

    // The other half of what a CMS route needs before it touches content: the
    // SOURCE repo it commits to. One call answers both, and both failures
    // arrive response-shaped, so a route is one respond either way.
    {
      name: 'cms-context-answers-the-source-repo-and-the-target',
      auth: 'none',

      async run({ expect }) {
        const { source, target } = cmsContext(brandConfig(ONE_WEBSITE), undefined);

        expect(source, 'the content repo is <brand.id>-omega under repo.owner').toEqual({ owner: 'Acme-Org', name: 'acme-omega', slug: 'Acme-Org/acme-omega' });
        expect(target).toEqual({ name: 'web', path: 'targets/web' });
      },
    },

    {
      name: 'cms-context-with-no-repo-block-is-a-500-naming-the-key',
      auth: 'none',

      async run({ expect }) {
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

        expect(error, 'half an address commits nowhere').toBeTruthy();
        expect(error.code, 'the route answers with e.code, with no `|| 400` to fall back on').toBe(500);
        expect(error.message).toMatch(/GitHub repo not configured/);
        expect(error.message, 'and it names the key to set').toMatch(/repo\.owner/);
        expect(error.message.includes('Set repo.owner and brand.id in config/omega.json5: the source repo is <brand.id>-omega under that owner.'), 'the content repo IS the source repo, so the shared line names the source role').toBeTruthy();
      },
    },

    {
      name: 'cms-context-passes-the-target-400-through',
      auth: 'none',

      async run({ expect }) {
        let error = null;
        try {
          cmsContext(brandConfig(TWO_WEBSITES), undefined);
        } catch (e) {
          error = e;
        }

        expect(error, 'several websites, no name: nothing is guessed').toBeTruthy();
        expect(error.code, 'a request problem stays a request problem').toBe(400);
        expect(error.message).toMatch(/Missing required parameter: target/);
      },
    },

    {
      name: 'no-web-target-at-all-fails-loudly',
      auth: 'none',

      async run({ expect }) {
        const error = refusal(brandConfig({ backend: { type: 'backend' } }), undefined);

        expect(error, 'content cannot land in a brand that runs no website').toBeTruthy();
        expect(error.code).toBe(400);
        expect(error.message).toMatch(/declares no web target/);
      },
    },
  ],
});
