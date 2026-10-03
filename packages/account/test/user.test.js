/**
 * Unit tests for the User class: the stored document as own fields, the
 * identity overlay and profile, the computed getters, the generators seam,
 * and byte parity with resolveAccount.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { mock } = require('node:test');

const { User, resolveAccount } = require('../src/index.js');

const FIXED_NOW_MS = 1783300000000; // 2026-07-06T01:06:40.000Z
const FIXED_NOW_UNIX = Math.floor(FIXED_NOW_MS / 1000);

const GETTERS = ['authenticated', 'uid', 'email', 'plan', 'active', 'trialing', 'cancelling', 'everPaid'];

module.exports = defineCases({
  type: 'group',
  description: 'user',
  tests: [
    // ─── Signed out ───

    {
      name: 'new User() is the signed-out user: basic, inactive, never null',
      run: (ctx) => {
        mock.timers.enable({ apis: ['Date'], now: FIXED_NOW_MS });
        ctx.after(() => mock.timers.reset());

        const user = new User();

        ctx.expect(user.authenticated).toBe(false);
        ctx.expect(user.uid).toBe(null);
        ctx.expect(user.email).toBe(null);
        ctx.expect(user.plan).toBe('basic');
        ctx.expect(user.active).toBe(false);
        ctx.expect(user.trialing).toBe(false);
        ctx.expect(user.cancelling).toBe(false);
        ctx.expect(user.everPaid).toBe(false);
        ctx.expect(user.profile).toEqual({ displayName: null, photoURL: null, emailVerified: false });
        ctx.expect(user.toJSON()).toEqual(resolveAccount({}));
        ctx.expect(JSON.stringify(user)).toBe(JSON.stringify(resolveAccount({})));
      },
    },

    // ─── Identity overlay & profile ───

    {
      name: 'identity fills auth only where the document lacks it, and fills profile',
      run: (ctx) => {
        const identity = {
          uid: 'fb-1',
          email: 'fb@example.com',
          displayName: 'Ada Lovelace',
          photoURL: 'https://example.com/ada.png',
          emailVerified: true,
        };

        const fresh = new User({}, identity);
        ctx.expect(fresh.authenticated).toBe(true);
        ctx.expect(fresh.uid).toBe('fb-1');
        ctx.expect(fresh.email).toBe('fb@example.com');
        ctx.expect(fresh.auth.uid).toBe('fb-1');
        ctx.expect(fresh.profile).toEqual({
          displayName: 'Ada Lovelace',
          photoURL: 'https://example.com/ada.png',
          emailVerified: true,
        });

        const existing = new User({ auth: { uid: 'doc-1', email: 'doc@example.com' } }, identity);
        ctx.expect(existing.uid).toBe('doc-1');
        ctx.expect(existing.email).toBe('doc@example.com');
        ctx.expect(existing.profile.displayName).toBe('Ada Lovelace');
      },
    },

    {
      name: 'profile and the getters never reach the own keys or the serialized shape',
      run: (ctx) => {
        const user = new User({ subscription: { product: { id: 'premium' } } }, { uid: 'fb-1', email: 'fb@example.com', displayName: 'Ada' });
        const json = JSON.stringify(user);
        // The getter names also spell stored fields deeper down (auth.uid, a status of
        // 'active'), so the check is on the TOP-LEVEL keys the serialized shape carries
        const serializedKeys = Object.keys(JSON.parse(json));

        ctx.expect(Object.keys(user).includes('profile')).toBe(false);
        ctx.expect(serializedKeys.includes('profile')).toBe(false);
        ctx.expect(json.includes('"displayName"')).toBe(false);
        for (const name of GETTERS) {
          ctx.expect(Object.keys(user).includes(name), `own key: ${name}`).toBe(false);
          ctx.expect(serializedKeys.includes(name), `serialized: ${name}`).toBe(false);
        }
      },
    },

    {
      name: 'an identity with no profile fields still yields the one profile shape',
      run: (ctx) => {
        const user = new User({}, { uid: 'fb-1', email: 'fb@example.com' });

        ctx.expect(user.profile).toEqual({ displayName: null, photoURL: null, emailVerified: false });
      },
    },

    // ─── Subscription getters ───

    {
      name: 'an active paid plan reads plan, active and everPaid',
      run: (ctx) => {
        const user = new User({
          subscription: {
            product: { id: 'premium' },
            status: 'active',
            payment: { startDate: { timestampUNIX: 1735689600 } },
          },
        });

        ctx.expect(user.plan).toBe('premium');
        ctx.expect(user.active).toBe(true);
        ctx.expect(user.trialing).toBe(false);
        ctx.expect(user.cancelling).toBe(false);
        ctx.expect(user.everPaid).toBe(true);
      },
    },

    {
      name: 'an unexpired claimed trial is trialing, and stops at its expiry',
      run: (ctx) => {
        mock.timers.enable({ apis: ['Date'], now: FIXED_NOW_MS });
        ctx.after(() => mock.timers.reset());

        const user = new User({
          subscription: {
            product: { id: 'premium' },
            status: 'active',
            trial: { claimed: true, expires: { timestampUNIX: FIXED_NOW_UNIX + 86400 } },
            cancellation: { pending: true },
          },
        });

        ctx.expect(user.trialing).toBe(true);
        ctx.expect(user.cancelling, 'a pending cancel only counts once the trial is over').toBe(false);
        ctx.expect(user.plan).toBe('premium');

        // The getters read the clock on every access: past the expiry, the trial is over
        mock.timers.tick(86400 * 1000 + 1000);
        ctx.expect(user.trialing).toBe(false);
        ctx.expect(user.cancelling).toBe(true);
      },
    },

    {
      name: 'a pending cancellation on a paid plan is cancelling',
      run: (ctx) => {
        const user = new User({
          subscription: { product: { id: 'premium' }, status: 'active', cancellation: { pending: true } },
        });

        ctx.expect(user.cancelling).toBe(true);
        ctx.expect(user.active).toBe(true);
        ctx.expect(user.plan).toBe('premium');
      },
    },

    {
      name: 'a cancelled or suspended paid plan reads basic and inactive',
      run: (ctx) => {
        for (const status of ['cancelled', 'suspended']) {
          const user = new User({ subscription: { product: { id: 'premium' }, status } });

          ctx.expect(user.plan, status).toBe('basic');
          ctx.expect(user.active, status).toBe(false);
          ctx.expect(user.trialing, status).toBe(false);
          ctx.expect(user.cancelling, status).toBe(false);
        }
      },
    },

    {
      name: 'the getters follow an in-place mutation of the subscription',
      run: (ctx) => {
        const user = new User({ subscription: { product: { id: 'premium' }, status: 'active' } });
        ctx.expect(user.plan).toBe('premium');

        user.subscription.status = 'cancelled';

        ctx.expect(user.plan).toBe('basic');
        ctx.expect(user.active).toBe(false);
      },
    },

    // ─── Generators ───

    {
      name: 'User.generators feed the token fields; unset, they resolve to null',
      run: (ctx) => {
        ctx.after(() => {
          User.generators = {};
        });

        User.generators = { uuid: () => '<uuid>', randomId: () => '<randomId>', apiKey: () => '<apiKey>' };
        const generated = new User();
        ctx.expect(generated.api.clientId).toBe('<uuid>');
        ctx.expect(generated.api.privateKey).toBe('<apiKey>');
        ctx.expect(generated.affiliate.code).toBe('<randomId>');

        User.generators = {};
        const bare = new User();
        ctx.expect(bare.api.clientId).toBe(null);
        ctx.expect(bare.api.privateKey).toBe(null);
        ctx.expect(bare.affiliate.code).toBe(null);
      },
    },

    // ─── Parity with resolveAccount ───

    {
      name: 'own keys and serialized bytes match resolveAccount, key order included',
      run: (ctx) => {
        mock.timers.enable({ apis: ['Date'], now: FIXED_NOW_MS });
        ctx.after(() => mock.timers.reset());

        const fixtures = [
          {},
          {
            roles: { admin: true, customRole: true },
            connections: { google: { 'google-sub-1': { token: 'tok' } } },
            unknownTopLevel: { stripped: true },
          },
          {
            auth: { uid: 12345, temporary: 'true' },
            subscription: { payment: { price: '4.99' }, trial: { claimed: 1 } },
            usage: { requests: { monthly: '5', last: { timestampUNIX: 1788397430 } } },
          },
        ];

        for (const fixture of fixtures) {
          const user = new User(fixture);

          ctx.expect(Object.keys(user)).toEqual(Object.keys(resolveAccount(fixture)));
          ctx.expect(JSON.stringify(user)).toBe(JSON.stringify(resolveAccount(fixture)));
        }
      },
    },

    // ─── The cleared discount ───

    {
      name: 'User.EMPTY_DISCOUNT is the schema\'s own cleared discount node',
      run: (ctx) => {
        ctx.expect(User.EMPTY_DISCOUNT).toEqual(resolveAccount({}).subscription.discount);
      },
    },
  ],
});
