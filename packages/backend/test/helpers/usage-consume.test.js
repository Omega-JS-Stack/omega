/**
 * Usage.consume() — the counted-feature gate
 * ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)).
 *
 * The promises, all of them things a caller or a customer can be misled by:
 *  - ONE call checks, counts and writes, and a refusal is a 429 that says WHICH
 *    counter hit — the day ("try again tomorrow") or the month ("upgrade");
 *  - the MONTH cap always holds, so a spent month is never sold as "tomorrow";
 *  - the day's share is the month limit spread over the days of THIS month, so
 *    a quota cannot be burned on day one — and `pace: false` opts a feature out;
 *  - a per-user override wins over the plan's number, and the day share derives
 *    from the EFFECTIVE number;
 *  - a write carries the touched feature's counters and nothing else, so two
 *    features counted at once cannot overwrite each other;
 *  - mirrors come from the CATALOG and the account's owned docs, never a
 *    call-site API;
 *  - init is LAZY: attaching reads nothing, and an unused counter never
 *    resolves an account;
 *  - a key is EXPLICIT: forKey() is a separate counter, so a signed-in user's
 *    own counters can never be moved into the anonymous store;
 *  - a feature the catalog does not define, or a perk, is a 500 — a limit
 *    nothing enforces must never look like one that does.
 *
 * Plain-node unit test (no emulator, no network): the gate's decision, its
 * arithmetic and its write COMPOSITION are pure given a ctx and a config, so
 * the only thing standing in for I/O is `write()` — recorded rather than sent,
 * which is what makes the payload assertable at all.
 */
const assert = require('node:assert');

const Usage = require('../../dist/manager/helpers/usage.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// A 31-day month, so ceil(100 / 31) = 4 is a number the assertions can name.
const IN_MARCH = new Date('2026-03-10T12:00:00.000Z');

const CATALOG = {
  saves: {
    name: 'Saves',
    icon: 'feather',
    definition: 'Notes you can save.',
    usage: { mirror: ['teams'] },
  },
  exports: { name: 'Exports', usage: { pace: false } },
  support: { name: 'Priority support', icon: 'headset' },
};

const PRODUCTS = [
  { id: 'basic', name: 'Basic', features: { saves: 100, exports: 20 } },
  { id: 'premium', name: 'Premium', features: { saves: -1, exports: 500, support: true } },
];

function makeManager(options) {
  options = options || {};

  return {
    config: {
      features: options.catalog === undefined ? CATALOG : options.catalog,
      payment: { products: PRODUCTS },
    },
    storage: () => ({ get: () => ({ value: () => ({}) }), set: () => ({ write: () => {} }) }),
    libraries: {},
  };
}

// A ctx that answers exactly what the counter asks it: who the caller is, and
// where to put a log line. `report` returns the decorated Error ctx.report does.
function makeCtx(account, options) {
  options = options || {};

  const state = { authenticated: 0, lines: [] };
  const record = (...args) => state.lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));

  return {
    state: state,
    log: record,
    warn: record,
    error: record,
    isDevelopment: () => true,
    isTesting: () => true,
    report: (e, opts) => {
      const error = e instanceof Error ? e : new Error(e);
      error.code = (opts || {}).code || 500;
      record(`report(${error.code}): ${error.message}`);
      return error;
    },
    authenticate: async () => {
      state.authenticated++;
      return JSON.parse(JSON.stringify(account || {}));
    },
    request: { data: {}, geolocation: { ip: options.ip || '203.0.113.7' } },
  };
}

// A counter whose writes are RECORDED instead of sent — the one I/O boundary.
function attach(account, options) {
  options = options || {};

  const ctx = makeCtx(account, options);
  const usage = new Usage(makeManager(options));

  usage.attach(ctx, { log: false, today: options.today || IN_MARCH });

  const writes = [];
  usage.write = async function (feature) {
    writes.push({ feature: feature, paths: this.mirrorPaths(feature), patch: this.countersPatch(feature) });
  };

  return { usage, ctx, writes };
}

function account(overrides) {
  return {
    auth: { uid: 'user-647', email: 'user@test.dev' },
    api: { clientId: 'client-647', privateKey: 'sk_test_fake' },
    subscription: { product: { id: 'basic' }, status: 'active' },
    usage: {},
    ...overrides,
  };
}

module.exports = defineCases({
  description: 'Usage.consume() — the counted-feature gate',
  type: 'group',

  tests: [
    {
      name: 'attach reads nothing — the account resolves on the FIRST consume',

      async run() {
        const { usage, ctx } = attach(account());

        assert.equal(ctx.state.authenticated, 0, 'attaching must cost no read');
        assert.equal(usage.resolved, false);

        await usage.consume('saves');
        await usage.consume('saves');

        assert.equal(ctx.state.authenticated, 1, 'the account resolves once, on first use');
      },
    },

    {
      name: 'a request the middleware already authenticated is never authenticated twice',

      async run() {
        const { usage, ctx } = attach(account());

        // What the middleware leaves behind: the caller resolved, and the flag
        // that says so
        ctx.resolvedUser = true;
        ctx.request.user = account({ usage: { saves: { monthly: 7, daily: 0 } } });

        const state = await usage.read('saves');

        assert.equal(ctx.state.authenticated, 0, 'no second token verification, no second user-doc read');
        assert.equal(state.used, 7, 'and the counter reads the account the middleware resolved');
      },
    },

    {
      name: 'a signed-OUT caller is refused loudly, never routed to the anonymous store',

      async run() {
        // What ctx.authenticate() leaves behind for a caller with no credential:
        // a full account SHAPE whose uid is null, and resolvedUser set all the
        // same. Writing that would land on `users/null` — one document every
        // anonymous caller on earth shares.
        const { usage, ctx } = attach(null);

        ctx.resolvedUser = true;
        ctx.request.user = { ...account(), auth: { uid: null, email: null }, authenticated: false };

        const consumed = await usage.consume('saves').catch((e) => e);
        const read = await usage.read('saves').catch((e) => e);

        for (const error of [consumed, read]) {
          assert.ok(error instanceof Error, 'a signed-out caller must be refused');
          assert.match(error.message, /no signed-in account to count against/i, error.message);
          assert.match(error.message, /usage\.forKey/, 'and pointed at the explicit anonymous counter');
        }
      },
    },

    {
      name: 'consume counts, writes, and returns what is left of both counters',

      async run() {
        const { usage, writes } = attach(account({ usage: { saves: { monthly: 30, daily: 1, total: 500 } } }));

        const left = await usage.consume('saves');

        assert.deepEqual(left, { used: 31, left: 69, day: { used: 2, left: 2 } }, JSON.stringify(left));
        assert.equal(writes.length, 1, 'one write per consume');
        assert.equal(writes[0].patch.usage.saves.total, 501, 'total never resets and still moved');
      },
    },

    {
      name: 'a write carries the touched feature ONLY — never the whole usage object',

      async run() {
        const { usage, writes } = attach(account({
          usage: { saves: { monthly: 1, daily: 1 }, exports: { monthly: 9, daily: 9 } },
        }));

        await usage.consume('saves');

        assert.deepEqual(Object.keys(writes[0].patch.usage), ['saves'], JSON.stringify(writes[0].patch));
      },
    },

    {
      name: 'the DAY share refuses first when the month still has room',

      async run() {
        // ceil(100/31) = 4 a day; 4 already spent today, 4 spent this month
        const { usage } = attach(account({ usage: { saves: { monthly: 4, daily: 4 } } }));

        const error = await usage.consume('saves').catch((e) => e);

        assert.ok(error instanceof Error, 'over the day share must refuse');
        assert.equal(error.code, 429);
        assert.match(error.message, /try again tomorrow/i, error.message);
      },
    },

    {
      name: 'a spent MONTH is never sold as "tomorrow" — the month is checked first',

      async run() {
        // The month is gone, but today's counter is untouched
        const { usage } = attach(account({ usage: { saves: { monthly: 100, daily: 0 } } }));

        const error = await usage.consume('saves').catch((e) => e);

        assert.equal(error.code, 429);
        assert.match(error.message, /upgrade/i, error.message);
        assert.doesNotMatch(error.message, /tomorrow/i, error.message);
      },
    },

    {
      name: 'a refusal counts nothing and writes nothing',

      async run() {
        const { usage, writes } = attach(account({ usage: { saves: { monthly: 100, daily: 0 } } }));

        await usage.consume('saves').catch(() => {});

        assert.deepEqual(writes, [], 'a refused call must leave the counters alone');
        assert.equal(usage.user.usage.saves.monthly, 100);
      },
    },

    {
      name: 'an amount larger than what is left refuses before it counts',

      async run() {
        const { usage } = attach(account({ usage: { saves: { monthly: 98, daily: 0 } } }));

        const error = await usage.consume('saves', 3).catch((e) => e);

        assert.equal(error.code, 429, 'consuming 3 with 2 left must refuse, not overshoot');
      },
    },

    {
      name: 'pace: false has no day cap — the month is the only gate',

      async run() {
        const { usage } = attach(account({ usage: { exports: { monthly: 0, daily: 19 } } }));

        const left = await usage.consume('exports');

        assert.deepEqual(left.day, { used: 20, left: -1 }, JSON.stringify(left));
      },
    },

    {
      name: 'a per-user override wins over the plan, day share and all',

      async run() {
        const { usage } = attach(account({
          usage: { saves: { monthly: 100, daily: 0 }, overrides: { saves: 300 } },
        }));

        const left = await usage.consume('saves');

        assert.equal(left.used, 101, 'the plan said 100 — the override says otherwise');
        assert.equal(left.left, 199);
        assert.equal(left.day.left, 9, 'ceil(300/31) = 10, one just spent');
      },
    },

    {
      name: 'unlimited never refuses and still counts',

      async run() {
        const { usage } = attach(account({
          subscription: { product: { id: 'premium' }, status: 'active' },
          usage: { saves: { monthly: 99999, daily: 5000 } },
        }));

        const left = await usage.consume('saves');

        assert.equal(left.left, -1, 'unlimited stays unlimited');
        assert.equal(left.used, 100000, 'and the record stays honest');
      },
    },

    {
      name: 'a feature the plan never names is a limit of zero — every call refuses',

      async run() {
        // `support` is a perk on premium and absent from basic; `saves` here is
        // the counted case: a plan that names no number promises nothing
        const { usage } = attach(account({
          subscription: { product: { id: 'nonexistent-tier' }, status: 'active' },
          usage: {},
        }));

        // An unknown product id falls back to `basic`, which does name saves —
        // so pin the case on a plan that genuinely omits the number
        usage.getProduct = () => ({ id: 'hollow', features: {} });

        const error = await usage.consume('saves').catch((e) => e);

        assert.equal(error.code, 429, error.message);
        assert.match(error.message, /all 0 of your Saves/i, error.message);
      },
    },

    {
      name: 'mirrors come from the CATALOG and the account owns the documents',

      async run() {
        const { usage, writes } = attach(account({ owns: { teams: ['team-a', 'team-b'] } }));

        await usage.consume('saves');

        assert.deepEqual(writes[0].paths, ['teams/team-a', 'teams/team-b'], JSON.stringify(writes[0].paths));
      },
    },

    {
      name: 'a feature the catalog does not mirror writes nowhere else',

      async run() {
        const { usage, writes } = attach(account({ owns: { teams: ['team-a'] } }));

        await usage.consume('exports');

        assert.deepEqual(writes[0].paths, [], JSON.stringify(writes[0].paths));
      },
    },

    {
      name: 'read() reports without counting',

      async run() {
        const { usage, writes } = attach(account({ usage: { saves: { monthly: 30, daily: 1 } } }));

        const state = await usage.read('saves');

        assert.equal(state.used, 30);
        assert.equal(state.left, 70);
        assert.deepEqual(writes, [], 'read must never write');
      },
    },

    {
      name: 'forKey is a SEPARATE counter — a key never moves the signed-in user',

      async run() {
        const { usage } = attach(account({ usage: { saves: { monthly: 30, daily: 1 } } }));

        const keyed = usage.forKey('203.0.113.7');

        assert.notStrictEqual(keyed, usage, 'forKey returns its own counter');
        assert.equal(keyed.key, '203.0.113.7');
        assert.equal(usage.key, null, 'the original counter is untouched');
        assert.deepEqual(keyed.mirrorPaths('saves'), [], 'an anonymous key owns nothing to mirror to');
      },
    },

    {
      name: 'a feature the catalog does not define is a 500, not a silent gate',

      async run() {
        const { usage } = attach(account());

        const error = await usage.consume('teleport').catch((e) => e);

        assert.equal(error.code, 500, error.message);
        assert.match(error.message, /features catalog/i, error.message);
      },
    },

    {
      name: 'a PERK cannot be consumed — it carries no meter',

      async run() {
        const { usage } = attach(account());

        const error = await usage.consume('support').catch((e) => e);

        assert.equal(error.code, 500, error.message);
        assert.match(error.message, /perk/i, error.message);
      },
    },

    {
      name: 'an EXPLICIT limit gates a counter the catalog never defines',

      async run() {
        // The signup-by-IP shape: a security control with its own config key
        const { usage, writes } = attach(account({ usage: { signups: { monthly: 1, daily: 1 } } }), { catalog: {} });

        const left = await usage.consume('signups', 1, { limit: 2 });

        assert.equal(left.used, 2);
        assert.equal(left.left, 0);
        assert.equal(writes.length, 1);

        const error = await usage.consume('signups', 1, { limit: 2 }).catch((e) => e);

        assert.equal(error.code, 429, error.message);
      },
    },

    {
      name: 'a whitelisted API key never gets refused, and still counts',

      async run() {
        const { usage } = attach(account({ usage: { saves: { monthly: 100, daily: 100 } } }));

        usage.addWhitelistKeys('sk_test_fake');

        const left = await usage.consume('saves');

        assert.equal(left.used, 101, 'the record stays honest even when the gate stands down');
      },
    },

    {
      name: 'limits() reports every counted feature, overrides applied; perks are not limits',

      async run() {
        const { usage } = attach(account({ usage: { overrides: { saves: 250 } } }));

        assert.deepEqual(usage.limits(), {}, 'nothing is known before the counter resolves');

        await usage.read('saves');

        assert.deepEqual(usage.limits(), { saves: 250, exports: 20 }, JSON.stringify(usage.limits()));
      },
    },
  ],
});
