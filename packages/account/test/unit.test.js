/**
 * Unit tests for @omega.js/account — engine semantics, generator injection,
 * the frontend auth-user overlay, and resolveSubscription derivations.
 * (Byte-parity with @omega.js/backend's live user.js is covered by golden-master.test.js.)
 */
const fs = require('fs');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { USER_SCHEMA, User, resolveAccount, resolveSubscription } = require('../src/index.js');

// The framework half of the Firestore rules, whose user rule denies client writes
// to the keys its isWritingFrameworkField() list names
const FRAMEWORK_RULES = path.join(__dirname, '..', '..', 'backend', 'templates', 'firestore.framework.rules');

module.exports = defineCases({
  type: 'group',
  description: 'unit',
  tests: [
    // ─── Defaults & generators ───

    {
      name: 'empty input resolves full defaults; generated fields are null without generators',
      run: (ctx) => {
        const account = resolveAccount({});

        ctx.expect(account.auth.uid).toBe(null);
        ctx.expect(account.subscription.product.id).toBe('basic');
        ctx.expect(account.subscription.status).toBe('active');
        ctx.expect(account.subscription.expires.timestamp).toBe('1970-01-01T00:00:00.000Z');
        ctx.expect(account.subscription.expires.timestampUNIX).toBe(0);
        ctx.expect(account.flags.signupProcessed).toBe(false);
        ctx.expect(account.consent.legal.status).toBe('revoked');

        // No generators injected → null (frontend mode: real values come from the backend)
        ctx.expect(account.api.clientId).toBe(null);
        ctx.expect(account.api.privateKey).toBe(null);
        ctx.expect(account.affiliate.code).toBe(null);
      },
    },

    {
      name: '#663: personal.location carries postalCode and street, null until filled',
      run: (ctx) => {
        const empty = resolveAccount({});

        ctx.expect(empty.personal.location.postalCode).toBe(null);
        ctx.expect(empty.personal.location.street).toBe(null);

        const filled = resolveAccount({ personal: { location: { postalCode: '90210', street: '123 Main Street' } } });

        ctx.expect(filled.personal.location.postalCode).toBe('90210');
        ctx.expect(filled.personal.location.street).toBe('123 Main Street');
      },
    },

    {
      name: 'injected generators feed $uuid/$randomId/$apiKey',
      run: (ctx) => {
        const account = resolveAccount({}, {
          generators: { uuid: () => 'u-1', randomId: () => 'r-1', apiKey: () => 'k-1' },
        });

        ctx.expect(account.api.clientId).toBe('u-1');
        ctx.expect(account.api.privateKey).toBe('k-1');
        ctx.expect(account.affiliate.code).toBe('r-1');
      },
    },

    {
      name: 'metadata.created/updated default to now (ISO + unix pair)',
      run: (ctx) => {
        const before = Math.floor(Date.now() / 1000);
        const account = resolveAccount({});
        const after = Math.floor(Date.now() / 1000);

        ctx.expect(account.metadata.created.timestampUNIX >= before && account.metadata.created.timestampUNIX <= after).toBeTruthy();
        ctx.expect(Math.floor(new Date(account.metadata.created.timestamp).getTime() / 1000)).toBe(account.metadata.created.timestampUNIX);
      },
    },

    {
      name: 'array defaults are fresh copies (no shared references)',
      run: (ctx) => {
        const first = resolveAccount({});
        first.affiliate.referrals.push('mutated');

        ctx.expect(resolveAccount({}).affiliate.referrals).toEqual([]);
      },
    },

    // ─── Type handling ───

    {
      name: 'coercion: strings/numbers/booleans converge to schema types',
      run: (ctx) => {
        const account = resolveAccount({
          auth: { uid: 12345, temporary: 'true' },
          subscription: { payment: { price: '4.99' }, trial: { claimed: 1 } },
          personal: { telephone: { countryCode: '49', national: 'not-a-number' } },
        });

        ctx.expect(account.auth.uid).toBe('12345');
        ctx.expect(account.auth.temporary).toBe(true);
        ctx.expect(account.subscription.payment.price).toBe(4.99);
        ctx.expect(account.subscription.trial.claimed).toBe(true);
        ctx.expect(account.personal.telephone.countryCode).toBe(49);
        ctx.expect(account.personal.telephone.national).toBe(0); // NaN → default
      },
    },

    {
      name: 'nullable semantics: null survives on nullable fields, resets non-nullable ones',
      run: (ctx) => {
        const account = resolveAccount({
          personal: { gender: null },
          subscription: { product: { id: null }, payment: { price: null } },
        });

        ctx.expect(account.personal.gender).toBe(null);
        ctx.expect(account.subscription.product.id).toBe('basic');
        ctx.expect(account.subscription.payment.price).toBe(0);
      },
    },

    {
      name: 'array type: non-array input falls back to default',
      run: (ctx) => {
        const account = resolveAccount({ affiliate: { referrals: 'not-an-array' } });

        ctx.expect(account.affiliate.referrals).toEqual([]);
      },
    },

    // ─── Passthrough & template ───

    {
      name: '$passthrough keeps unknown keys, the root included; plain branches strip them',
      run: (ctx) => {
        const account = resolveAccount({
          roles: { admin: true, customRole: true },
          connections: { google: { 'google-sub-1': { token: 'tok' } } },
          unknownTopLevel: { kept: true },
          auth: { unknownNested: { stripped: true } },
        });

        ctx.expect(account.roles.customRole).toBe(true);
        ctx.expect(account.connections).toEqual({ google: { 'google-sub-1': { token: 'tok' } } });
        ctx.expect(account.unknownTopLevel).toEqual({ kept: true });
        ctx.expect('unknownNested' in account.auth).toBe(false);
      },
    },

    {
      name: 'a brand\'s own top-level key rides through resolveAccount and User, framework keys still defaulted',
      run: (ctx) => {
        const account = resolveAccount({ notes: { created: 3 } });

        ctx.expect(account.notes.created).toBe(3);
        ctx.expect(account.subscription.product.id).toBe('basic');
        ctx.expect(account.auth.uid).toBe(null);
        ctx.expect(account.flags.signupProcessed).toBe(false);

        const stored = new User({ notes: { created: 3 } }).toJSON();

        ctx.expect(stored.notes.created).toBe(3);
        ctx.expect(stored.subscription.product.id).toBe('basic');
        ctx.expect(stored.consent.legal.status).toBe('revoked');
      },
    },

    {
      name: 'a brand key cannot shadow one of User\'s derived getters: new User throws naming it',
      run: (ctx) => {
        ctx.expect(() => new User({ plan: {} })).toThrow(Error);
        ctx.expect(() => new User({ plan: {} })).toThrow(/plan/);
      },
    },

    {
      name: 'the framework rules deny client writes to every key the User guard blocks',
      run: (ctx) => {
        const rules = fs.readFileSync(FRAMEWORK_RULES, 'utf8');
        const list = rules.match(/function isWritingFrameworkField\(\)\s*\{\s*return isWritingAny\(\[([^\]]*)\]\)/);

        ctx.expect(list, 'isWritingFrameworkField() is no longer one isWritingAny([...]) list').toBeTruthy();

        const denied = [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
        const guarded = [...Object.getOwnPropertyNames(User.prototype).filter((name) => name !== 'constructor'), 'profile'];
        const open = guarded.filter((name) => !denied.includes(name));

        ctx.expect(open, 'a client could write a key new User() refuses to build from').toEqual([]);
      },
    },

    {
      name: '$template resolves dynamic usage keys against the template shape',
      run: (ctx) => {
        const account = resolveAccount({
          usage: { requests: { monthly: '5', last: { timestampUNIX: 1788397430 } } },
        });

        ctx.expect(account.usage.requests.monthly).toBe(5);
        ctx.expect(account.usage.requests.daily).toBe(0);
        ctx.expect(account.usage.requests.total).toBe(0);
        ctx.expect(account.usage.requests.last.timestampUNIX).toBe(1788397430);
        ctx.expect(account.usage.requests.last.timestamp).toBe('1970-01-01T00:00:00.000Z');
      },
    },

    {
      name: '#647: usage.last carries only WHEN the counter moved — the retired `id` is gone',
      run: (ctx) => {
        const account = resolveAccount({ usage: { requests: { monthly: 1 } } });

        ctx.expect(Object.keys(account.usage.requests.last), 'a schema field nothing writes reads as a fact that is always null').toEqual(['timestamp', 'timestampUNIX']);
      },
    },

    // ─── Auth-user overlay (frontend semantic) ───

    {
      name: 'options.user fills missing auth identity but never overrides the doc',
      run: (ctx) => {
        const fresh = resolveAccount({}, { user: { uid: 'fb-1', email: 'fb@example.com' } });
        ctx.expect(fresh.auth.uid).toBe('fb-1');
        ctx.expect(fresh.auth.email).toBe('fb@example.com');

        const existing = resolveAccount(
          { auth: { uid: 'doc-1', email: 'doc@example.com' } },
          { user: { uid: 'fb-1', email: 'fb@example.com' } },
        );
        ctx.expect(existing.auth.uid).toBe('doc-1');
        ctx.expect(existing.auth.email).toBe('doc@example.com');
      },
    },

    // ─── The applied discount ───

    {
      name: 'an applied winback discount survives resolution, source and all',
      run: (ctx) => {
        // The card that renders it reads the RESOLVED account, and resolution strips
        // every key the schema does not name — so a claim the route persisted has to
        // come back out of the engine intact ([#325]).
        const account = resolveAccount({
          subscription: {
            product: { id: 'premium' },
            status: 'active',
            discount: {
              valid: true,
              code: 'WINBACK50',
              percent: 50,
              amount: 0,
              duration: 'once',
              source: 'winback',
              resourceId: 'sub_live',
            },
          },
        });

        ctx.expect(account.subscription.discount).toEqual({
          valid: true,
          code: 'WINBACK50',
          percent: 50,
          amount: 0,
          duration: 'once',
          source: 'winback',
          resourceId: 'sub_live',
        });
      },
    },

    {
      name: 'the discount names the subscription it was applied to',
      run: (ctx) => {
        // The stamp is what makes the node clearable ([#333]): the webhook pipeline
        // compares it against the subscription the event is about, and a mismatch is a
        // NEW subscription that never claimed this discount. Resolution strips every
        // key the schema does not name, so a stamp the engine drops is a discount that
        // rides a resubscribe forever and silently retires the save offer.
        const account = resolveAccount({
          subscription: {
            discount: { valid: true, code: 'WINBACK50', percent: 50, duration: 'once', source: 'winback', resourceId: 'sub_old' },
          },
        });

        ctx.expect(account.subscription.discount.resourceId).toBe('sub_old');
      },
    },

    {
      name: 'a fresh account carries no discount at all',
      run: (ctx) => {
        const discount = resolveAccount({}).subscription.discount;

        ctx.expect(discount.valid, 'absent and denied are the same thing to a reader').toBe(false);
        ctx.expect(discount.code).toBe(null);
        ctx.expect(discount.source, 'and nothing claims to be a winback claim').toBe(null);
        ctx.expect(discount.resourceId, 'and none names a subscription').toBe(null);
      },
    },

    {
      name: 'a checkout discount keeps its OWN source — the winback claim is not the shape',
      run: (ctx) => {
        // A code typed at checkout sets this same node, and a winback pitch suppressed
        // by someone else's promo is an offer silently withheld. `source` is what the
        // pitch gate reads, so the two are never the same signal.
        const account = resolveAccount({
          subscription: {
            discount: { valid: true, code: 'WELCOME10OFF', amount: 10, duration: 'once', source: 'checkout' },
          },
        });

        ctx.expect(account.subscription.discount.source).toBe('checkout');
        ctx.expect(account.subscription.discount.amount).toBe(10);
        ctx.expect(account.subscription.discount.percent, 'the shape it is not reports zero, never undefined').toBe(0);
      },
    },

    // ─── resolveSubscription ───

    {
      name: 'fresh account resolves to basic/inactive/never-paid',
      run: (ctx) => {
        ctx.expect(resolveSubscription(resolveAccount({}))).toEqual({
          plan: 'basic',
          active: false,
          trialing: false,
          cancelling: false,
          everPaid: false,
        });
      },
    },

    {
      name: 'active paid plan resolves plan/active/everPaid',
      run: (ctx) => {
        const account = resolveAccount({
          subscription: {
            product: { id: 'premium' },
            status: 'active',
            payment: { startDate: { timestampUNIX: 1735689600 } },
          },
        });

        ctx.expect(resolveSubscription(account)).toEqual({
          plan: 'premium',
          active: true,
          trialing: false,
          cancelling: false,
          everPaid: true,
        });
      },
    },

    {
      name: 'unexpired claimed trial is trialing; cancellation only counts when not trialing',
      run: (ctx) => {
        const future = Math.floor(Date.now() / 1000) + 86400;

        const trialing = resolveAccount({
          subscription: {
            product: { id: 'premium' },
            status: 'active',
            trial: { claimed: true, expires: { timestampUNIX: future } },
            cancellation: { pending: true },
          },
        });
        ctx.expect(resolveSubscription(trialing)).toEqual({
          plan: 'premium',
          active: true,
          trialing: true,
          cancelling: false,
          everPaid: false,
        });

        const cancelling = resolveAccount({
          subscription: {
            product: { id: 'premium' },
            status: 'active',
            cancellation: { pending: true },
          },
        });
        ctx.expect(resolveSubscription(cancelling)).toEqual({
          plan: 'premium',
          active: true,
          trialing: false,
          cancelling: true,
          everPaid: false,
        });
      },
    },

    {
      name: 'suspended paid plan falls back to basic',
      run: (ctx) => {
        const account = resolveAccount({
          subscription: { product: { id: 'premium' }, status: 'suspended' },
        });

        ctx.expect(resolveSubscription(account)).toEqual({
          plan: 'basic',
          active: false,
          trialing: false,
          cancelling: false,
          everPaid: false,
        });
      },
    },

    // ─── Schema export sanity ───

    {
      name: 'USER_SCHEMA is exported and carries the canonical branches',
      run: (ctx) => {
        for (const branch of ['auth', 'subscription', 'roles', 'flags', 'affiliate', 'metadata', 'activity', 'api', 'usage', 'personal', 'connections', 'attribution', 'trackingConsent', 'consent']) {
          ctx.expect(USER_SCHEMA[branch], `missing branch: ${branch}`).toBeTruthy();
        }
      },
    },
  ],
});
