/**
 * Test: helpers/backend-router.js — request URL → middleware route path
 *
 * Run: npx omega test backend:helpers/backend-router
 *
 * Every incoming HTTP request enters the middleware system through this one
 * resolution, and the prefix table is a COMPATIBILITY contract:
 *   /omega/…            the canonical prefix
 *   /omega_api/…        the direct Cloud Function URL
 *   /backend-manager/…  the legacy BEM alias, kept so migrating brands'
 *                       in-the-wild clients keep working
 * Everything else keeps its path, minus the leading slash — including a first
 * segment that merely STARTS with a prefix word (/omegatron/…), since a prefix
 * only counts as a whole segment.
 */
const BackendRouter = require('../../src/manager/helpers/backend-router.js');

const Manager = { libraries: {} };

// The router only ever reads req.path.
const resolve = (path) => new BackendRouter(Manager, { path }, {}).resolve().routePath;

module.exports = {
  description: 'BackendRouter.resolve() route path extraction',
  type: 'group',

  tests: [
    // ─── The canonical prefix ───

    {
      name: 'strips-the-omega-prefix',
      async run({ assert }) {
        assert.equal(resolve('/omega/user/sign-up'), 'user/sign-up');
        assert.equal(resolve('/omega/admin/post'), 'admin/post');
      },
    },

    {
      // The direct Cloud Function URL. The prefix alternation is ordered
      // longest-first AND followed by a boundary assertion, so `omega` can
      // never win a `/omega_api/…` path the way first-match alternation
      // used to (which left `_api/…`, a route that cannot exist).
      name: 'strips-the-direct-function-url-prefix',
      async run({ assert }) {
        assert.equal(resolve('/omega_api/user/sign-up'), 'user/sign-up');
      },
    },

    {
      name: 'strips-the-legacy-backend-manager-alias',
      async run({ assert }) {
        assert.equal(resolve('/backend-manager/user/sign-up'), 'user/sign-up');
      },
    },

    // ─── Bare prefixes and depth ───

    {
      name: 'a-bare-prefix-resolves-to-the-empty-route',
      async run({ assert }) {
        assert.equal(resolve('/omega/'), '');
        assert.equal(resolve('/omega'), '');
        assert.equal(resolve('/backend-manager/'), '');
        assert.equal(resolve('/omega_api'), '');
      },
    },

    {
      name: 'deep-paths-keep-every-remaining-segment',
      async run({ assert }) {
        assert.equal(resolve('/omega/payment/subscription/cancel'), 'payment/subscription/cancel');
        assert.equal(resolve('/omega/a/b/c/d/e'), 'a/b/c/d/e');
      },
    },

    {
      name: 'trailing-slashes-are-preserved',
      async run({ assert }) {
        assert.equal(resolve('/omega/user/sign-up/'), 'user/sign-up/');
      },
    },

    // ─── Unprefixed and absent paths ───

    {
      name: 'an-unprefixed-path-just-loses-its-leading-slash',
      async run({ assert }) {
        assert.equal(resolve('/user/sign-up'), 'user/sign-up');
        assert.equal(resolve('user/sign-up'), 'user/sign-up');
      },
    },

    {
      name: 'an-absent-path-resolves-to-the-empty-route',
      async run({ assert }) {
        assert.equal(resolve(''), '');
        assert.equal(resolve(undefined), '');
        assert.equal(resolve('/'), '');
      },
    },

    // ─── The prefix must LEAD ───

    {
      name: 'a-prefix-word-mid-path-is-not-stripped',
      async run({ assert }) {
        assert.equal(resolve('/api/omega/user'), 'api/omega/user');
        assert.equal(resolve('/omega/omega/user'), 'omega/user', 'only the leading prefix goes');
      },
    },

    {
      // The prefix must be a WHOLE first segment: a path whose first segment
      // merely starts with a prefix word is not a prefixed path at all, and
      // keeps every character (minus its leading slash).
      name: 'a-route-merely-starting-with-a-prefix-word-is-untouched',
      async run({ assert }) {
        assert.equal(resolve('/omegatron/user'), 'omegatron/user');
        assert.equal(resolve('/backend-manager-legacy/user'), 'backend-manager-legacy/user');
      },
    },

    // ─── Query strings never reach here (req.path excludes them) ───

    {
      name: 'the-resolution-returns-a-routePath-object',
      async run({ assert }) {
        const resolved = new BackendRouter(Manager, { path: '/omega/user/sign-up' }, {}).resolve();

        assert.equal(typeof resolved, 'object');
        assert.equal(resolved.routePath, 'user/sign-up');
      },
    },
  ],
};
