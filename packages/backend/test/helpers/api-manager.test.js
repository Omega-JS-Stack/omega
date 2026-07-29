/**
 * Test: helpers/api-manager.js — plan limits, per-user stats, quota math
 *
 * Run: npx omega test backend:helpers/api-manager
 *
 * The rate-limit half of ApiManager is pure arithmetic over an in-memory user
 * record, and it decides whether a paying customer's request is served or
 * refused — so it is unit-testable and worth pinning exactly:
 *   - init() derives the plan table from config.payment.products.
 *   - getUserStat()/incrementUserStat() read and write `_APIManager.stats`
 *     against `subscription.limits`.
 *   - isUserOverStat()'s `daily` frame is the MONTHLY limit divided by 31
 *     (floored), and the comparison is inclusive.
 *   - A whitelisted API key reports zero usage and an infinite limit.
 *
 * getUser()'s cache/refetch path and validateOfficialRequest()'s captcha
 * verification need a real ctx/hcaptcha boundary and are proven at the route
 * level, not here.
 */
const ApiManager = require('../../src/manager/helpers/api-manager.js');

// The only Manager surface init() reads.
const makeManager = (products) => ({ config: { payment: { products: products || [] } } });

async function makeApi(options, products) {
  return new ApiManager(makeManager(products)).init(options);
}

// The message fn() threw, or null when it did not throw.
function throwsWith(fn) {
  try {
    fn();
  } catch (e) {
    return e.message;
  }
  return null;
}

module.exports = {
  description: 'ApiManager plan limits + stat accounting',
  type: 'group',

  tests: [
    // ─── init() ───

    {
      name: 'init-derives-the-plan-table-from-config-products',
      async run({ assert }) {
        const api = await makeApi({}, [
          { id: 'basic', limits: { requests: 3100 } },
          { id: 'premium', limits: { requests: 62000, storage: 10 } },
          { id: 'free' },
        ]);

        assert.deepEqual(api.options.plans, {
          basic: { limits: { requests: 3100 } },
          premium: { limits: { requests: 62000, storage: 10 } },
          free: { limits: {} },
        });
        assert.equal(api.initialized, true);
      },
    },

    {
      name: 'init-applies-its-defaults-and-a-caller-may-override-them',
      async run({ assert }) {
        const defaults = await makeApi({});
        assert.equal(defaults.options.maxUsersStored, 10000);
        assert.equal(defaults.options.refetchInterval, 60);
        assert.equal(defaults.options.resetInterval, 1440);
        assert.deepEqual(defaults.options.officialAPIKeys, []);
        assert.deepEqual(defaults.options.whitelistedAPIKeys, []);

        const custom = await makeApi({ refetchInterval: 5, resetInterval: 60, maxUsersStored: 10 });
        assert.equal(custom.options.refetchInterval, 5);
        assert.equal(custom.options.resetInterval, 60);
        assert.equal(custom.options.maxUsersStored, 10);
      },
    },

    {
      name: 'a-config-with-no-products-yields-an-empty-plan-table',
      async run({ assert }) {
        const api = await new ApiManager({ config: {} }).init({});

        assert.deepEqual(api.options.plans, {});
      },
    },

    // ─── getUserStat ───

    {
      name: 'getUserStat-reads-current-usage-and-the-plan-limit',
      async run({ assert }) {
        const api = await makeApi({});
        const user = {
          api: { privateKey: 'key_abc' },
          subscription: { limits: { requests: 3100 } },
          _APIManager: { stats: { requests: 42 } },
        };

        assert.deepEqual(api.getUserStat(user, 'requests'), { current: 42, limit: 3100 });
      },
    },

    {
      name: 'an-unknown-stat-falls-back-to-the-supplied-default-then-zero',
      async run({ assert }) {
        const api = await makeApi({});
        const user = { api: {}, subscription: { limits: {} }, _APIManager: { stats: {} } };

        assert.deepEqual(api.getUserStat(user, 'requests'), { current: 0, limit: 0 });
        assert.deepEqual(api.getUserStat(user, 'requests', 7), { current: 7, limit: 7 });
      },
    },

    {
      name: 'a-whitelisted-key-reports-zero-used-and-an-infinite-limit',
      async run({ assert }) {
        const api = await makeApi({ whitelistedAPIKeys: ['key_internal'] });
        const byPrivateKey = {
          api: { privateKey: 'key_internal' },
          subscription: { limits: { requests: 10 } },
          _APIManager: { stats: { requests: 9999 } },
        };
        const byProvidedKey = {
          api: {},
          subscription: { limits: { requests: 10 } },
          _APIManager: { stats: { requests: 9999 }, providedAPIKey: 'key_internal' },
        };

        assert.deepEqual(api.getUserStat(byPrivateKey, 'requests'), { current: 0, limit: Infinity });
        assert.deepEqual(api.getUserStat(byProvidedKey, 'requests'), { current: 0, limit: Infinity });
      },
    },

    {
      name: 'getUserStat-requires-a-user-and-a-stat',
      async run({ assert }) {
        const api = await makeApi({});

        assert.equal(throwsWith(() => api.getUserStat(null, 'requests')), '<user> and <stat> required');
        assert.equal(throwsWith(() => api.getUserStat({}, '')), '<user> and <stat> required');
      },
    },

    // ─── incrementUserStat ───

    {
      name: 'incrementUserStat-adds-and-returns-the-fresh-reading',
      async run({ assert }) {
        const api = await makeApi({});
        const user = { api: {}, subscription: { limits: { requests: 100 } }, _APIManager: { stats: {} } };

        assert.deepEqual(api.incrementUserStat(user, 'requests', 1), { current: 1, limit: 100 });
        assert.deepEqual(api.incrementUserStat(user, 'requests', 4), { current: 5, limit: 100 });
        assert.equal(user._APIManager.stats.requests, 5, 'the user record is updated in place');
      },
    },

    {
      name: 'incrementUserStat-accepts-a-negative-amount-the-official-refund-path',
      async run({ assert }) {
        const api = await makeApi({});
        const user = { api: {}, subscription: { limits: { requests: 100 } }, _APIManager: { stats: { requests: 5 } } };

        assert.deepEqual(api.incrementUserStat(user, 'requests', -1), { current: 4, limit: 100 });
      },
    },

    // ─── isUserOverStat: the quota decision ───

    {
      name: 'the-daily-frame-is-the-monthly-limit-divided-by-31-floored',
      async run({ assert }) {
        const api = await makeApi({});
        // 3100 / 31 = 100 requests/day.
        const at = (used) => api.isUserOverStat(
          { api: {}, subscription: { limits: { requests: 3100 } }, _APIManager: { stats: { requests: used } } },
          'requests',
        );

        assert.equal(at(0), false, 'fresh user is not over quota');
        assert.equal(at(99), false);
        assert.equal(at(100), false, 'the bound itself is not over');
        assert.equal(at(101), true, 'one past the bound is over quota');
      },
    },

    {
      name: 'a-non-daily-frame-uses-the-whole-limit',
      async run({ assert }) {
        const api = await makeApi({});
        const user = { api: {}, subscription: { limits: { requests: 3100 } }, _APIManager: { stats: { requests: 3100 } } };

        assert.equal(api.isUserOverStat(user, 'requests', undefined, 'monthly'), false);
        user._APIManager.stats.requests = 3101;
        assert.equal(api.isUserOverStat(user, 'requests', undefined, 'monthly'), true);
      },
    },

    {
      name: 'a-whitelisted-key-is-never-over-quota',
      async run({ assert }) {
        const api = await makeApi({ whitelistedAPIKeys: ['key_internal'] });
        const user = {
          api: { privateKey: 'key_internal' },
          subscription: { limits: { requests: 1 } },
          _APIManager: { stats: { requests: 9999 } },
        };

        // Infinity is a number, so the daily divide keeps it Infinity.
        assert.equal(api.isUserOverStat(user, 'requests'), false);
      },
    },

    {
      name: 'a-non-numeric-limit-is-refused-rather-than-guessed',
      async run({ assert }) {
        const api = await makeApi({});
        const user = {
          api: {},
          subscription: { limits: { requests: 'unlimited' } },
          _APIManager: { stats: { requests: 0 } },
        };

        assert.equal(api.isUserOverStat(user, 'requests'), true, 'a malformed limit fails closed');
      },
    },

    {
      name: 'isUserOverStat-requires-a-user-and-a-stat',
      async run({ assert }) {
        const api = await makeApi({});

        assert.equal(throwsWith(() => api.isUserOverStat(null, 'requests')), '<user> and <stat> required');
        assert.equal(throwsWith(() => api.isUserOverStat({}, null)), '<user> and <stat> required');
      },
    },

    // ─── _createNewUser: plan limits land on the record ───

    {
      name: 'a-new-user-inherits-the-plan-limits-and-starts-at-zero',
      async run({ assert }) {
        const api = await makeApi({}, [{ id: 'premium', limits: { requests: 62000, storage: 10 } }]);

        const user = api._createNewUser(
          { auth: { uid: 'uid_1' }, authenticated: true, ip: '1.2.3.4', country: 'US' },
          'premium',
          {},
          false,
          'key_abc',
        );

        assert.deepEqual(user.subscription.limits, { requests: 62000, storage: 10 });
        assert.equal(user.subscription.product.id, 'premium');
        assert.equal(user._APIManager.stats.requests, 0);
        assert.equal(user._APIManager.providedAPIKey, 'key_abc');
        assert.equal(user.authenticated, true);
        assert.equal(user.ip, '1.2.3.4');
        assert.equal(user.country, 'US');
      },
    },

    {
      name: 'a-per-user-limit-override-beats-the-plan-limit',
      async run({ assert }) {
        const api = await makeApi({}, [{ id: 'basic', limits: { requests: 3100 } }]);

        const user = api._createNewUser(
          { auth: { uid: 'uid_1' }, authenticated: true, subscription: { limits: { requests: 999999 } } },
          'basic',
          {},
          false,
          null,
        );

        assert.equal(user.subscription.limits.requests, 999999);
      },
    },

    {
      name: 'stats-carry-over-inside-the-reset-window-and-drop-outside-it',
      async run({ assert }) {
        const api = await makeApi({ resetInterval: 60 }, [{ id: 'basic', limits: { requests: 3100 } }]);
        const authed = { auth: { uid: 'uid_1' }, authenticated: true };

        const recent = api._createNewUser(authed, 'basic', {
          _APIManager: {
            stats: { requests: 25 },
            meta: { lastStatsReset: new Date(Date.now() - 10 * 60 * 1000), lastUserFetch: new Date() },
          },
        }, false, null);
        assert.equal(recent._APIManager.stats.requests, 25, 'inside the window usage is kept');

        const stale = api._createNewUser(authed, 'basic', {
          _APIManager: {
            stats: { requests: 25 },
            meta: { lastStatsReset: new Date(Date.now() - 120 * 60 * 1000), lastUserFetch: new Date() },
          },
        }, false, null);
        assert.equal(stale._APIManager.stats.requests, 0, 'past the window usage resets');
      },
    },
  ],
};
