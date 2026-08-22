/**
 * Marketing prune test — the opt-in gate on the cron entry
 * ([#422](https://github.com/Omega-JS-Stack/omega/issues/422)), then the
 * per-provider lanes: each provider's OWN engagement decides that provider's
 * removals ([#365](https://github.com/Omega-JS-Stack/omega/issues/365)).
 *
 * The bug this pins: stage 2 measured engagement in SendGrid and then deleted
 * the same emails from Beehiiv, so a reader who opens every newsletter but
 * ignores offer mail was removed from the NEWSLETTER on a signal from the other
 * channel. Stage 2 is now SendGrid-only and stage 3 is the Beehiiv lane, keyed
 * to Beehiiv's own per-subscriber stats with its own received floor.
 *
 * Plain-node control-flow test (no emulator, no network): the real cron stages
 * run against provider modules swapped in the require cache — the cron requires
 * them by path, so the require cache IS the seam (same idiom as
 * campaign-config-fault.test.js). Firestore is a minimal in-memory stand-in.
 *
 * Removal method: both lanes call the providers' DELETE paths
 * (sendgrid.bulkDeleteContacts, beehiiv.removeContact → removeSubscriber's
 * DELETE), never an unsubscribe — an unsubscribe would revoke marketing consent
 * in Firestore permanently. The live provider surface is covered by the
 * extended-mode marketing-lifecycle suite.
 */
const assert = require('node:assert');
const cron = require('../../../src/manager/events/cron/daily/marketing-prune.js');
const Manager = require('../../../src/manager/index.js');
const sendgridProvider = require('../../../src/manager/libraries/email/providers/sendgrid.js');
const beehiivProvider = require('../../../src/manager/libraries/email/providers/beehiiv.js');

const {
  stagePrune,
  stageNewsletterPrune,
  isNewsletterInactive,
  NEWSLETTER_RECEIVED_FLOOR,
  NEWSLETTER_MIN_AGE_DAYS,
} = cron;

const DAY = 24 * 60 * 60 * 1000;
const BRAND = { id: 'acme', name: 'Acme' };

/** The run doc id stage logs land under (year-month of the run). */
function logKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Minimal in-memory Firestore stand-in — the stages only ever write one
 * prune-log doc per lane, and stage 3's paid exclusion reads users by email
 * (the marketing library's canonical lookup). An email absent from
 * `usersByEmail` is a pure newsletter contact with no account.
 */
function buildAdmin(usersByEmail = {}) {
  const writes = [];

  const admin = {
    firestore: () => ({
      collection: () => ({
        where: (field, op, value) => ({
          limit: () => ({
            get: async () => {
              const userDoc = usersByEmail[value];

              return userDoc
                ? { empty: false, docs: [{ data: () => userDoc }] }
                : { empty: true, docs: [] };
            },
          }),
        }),
      }),
      doc: (path) => ({
        set: async (data) => { writes.push({ path, data }); },
      }),
    }),
  };

  return { admin, writes };
}

function buildAssistant() {
  const calls = { logs: [], errors: [] };

  const ctx = {
    log: (...args) => calls.logs.push(args.join(' ')),
    error: (...args) => calls.errors.push(args.join(' ')),
  };

  return { ctx, calls };
}

/**
 * A Manager stub. The cron ENTRY runs stage 1, which sends the re-engagement
 * campaign through Manager.Email(ctx) — stages 2 and 3 never touch the mailer,
 * so the recorder stays optional.
 */
function buildManager(marketing, sentCampaigns = []) {
  return {
    config: { brand: BRAND, marketing },
    Email: () => ({
      sendCampaign: async (campaign) => { sentCampaigns.push(campaign); return { success: true }; },
    }),
  };
}

/**
 * Run with the clock pinned to the 1st of the CURRENT month — the cron entry
 * acts on that day alone, so a gate test on any other day would return before
 * ever reaching the gate and pass without proving anything. The current month
 * (rather than a fixed date) keeps the subscription ages the seams build
 * inside the window honest.
 */
async function onPruneDay(run) {
  const RealDate = Date;
  const today = new RealDate();
  const frozen = new RealDate(today.getFullYear(), today.getMonth(), 1, 12, 0, 0).getTime();

  class FrozenDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [frozen]));
    }

    static now() {
      return frozen;
    }
  }

  global.Date = FrozenDate;

  try {
    return await run();
  } finally {
    global.Date = RealDate;
  }
}

/**
 * Run a stage with the provider modules (and provider API keys) swapped for
 * the call, always restoring them — an ambient key must never let a stage
 * reach a real provider.
 */
async function withProviders({ sendgrid = {}, beehiiv = {}, env = {} }, run) {
  const originals = { sendgrid: {}, beehiiv: {}, env: {} };

  for (const [name, fn] of Object.entries(sendgrid)) {
    originals.sendgrid[name] = sendgridProvider[name];
    sendgridProvider[name] = fn;
  }

  for (const [name, fn] of Object.entries(beehiiv)) {
    originals.beehiiv[name] = beehiivProvider[name];
    beehiivProvider[name] = fn;
  }

  for (const [name, value] of Object.entries(env)) {
    originals.env[name] = process.env[name];
    process.env[name] = value;
  }

  try {
    return await run();
  } finally {
    for (const [name, fn] of Object.entries(originals.sendgrid)) {
      sendgridProvider[name] = fn;
    }

    for (const [name, fn] of Object.entries(originals.beehiiv)) {
      beehiivProvider[name] = fn;
    }

    for (const [name, value] of Object.entries(originals.env)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

/**
 * Run with a Beehiiv publication configured. getPublicationId() reads the
 * static config off the Manager constructor, so the tests that exercise the
 * real listSubscriptions have to put one there, and always put back what they
 * found.
 */
async function withPublication(run) {
  const original = Manager.config;

  Manager.config = { marketing: { newsletter: { providers: { beehiiv: { publicationId: 'pub_test' } } } } };

  try {
    return await run();
  } finally {
    Manager.config = original;
  }
}

/** A SendGrid segment export contact (the shape getSegmentContacts returns). */
function contact(email, id) {
  return { email, id };
}

/** Stage 2's SendGrid seam: one inactive contact, no paying customers. */
function sendgridSeam(contacts, deleted) {
  return {
    resolveSegmentIds: async () => ({ engagement_inactive_6m: 'seg_inactive' }),
    createBrandScopedSegment: async () => ({ segmentId: 'seg_temp', cleanup: async () => {} }),
    getSegmentContacts: async () => ({ success: true, contacts }),
    bulkDeleteContacts: async (ids) => { deleted.push(...ids); return { success: true }; },
  };
}

/**
 * A Beehiiv subscription with `stats` expanded. Defaults describe a subscriber
 * old enough and mailed enough to qualify — each case overrides the one field
 * it is about.
 */
function subscription({ email, received = NEWSLETTER_RECEIVED_FLOOR, openRate = 0, clickRate = 0, ageDays = NEWSLETTER_MIN_AGE_DAYS + 30 }) {
  return {
    id: `sub_${email}`,
    email,
    status: 'active',
    created: Math.round((Date.now() - (ageDays * DAY)) / 1000),
    stats: {
      emails_received: received,
      open_rate: openRate,
      click_through_rate: clickRate,
    },
  };
}

const NEWSLETTER_ENABLED = { campaigns: { enabled: true }, newsletter: { enabled: true } };

// Both providers live, and the prune explicitly opted in — the only shape that
// deletes anything ([#422](https://github.com/Omega-JS-Stack/omega/issues/422)).
const PRUNE_OPTED_IN = { ...NEWSLETTER_ENABLED, prune: { enabled: true } };

// Paid-ness is whatever resolveSubscription() calls active — the subscription_paid
// segment's two conditions (plan not basic AND status active), not a local rule.
const PAYING_USER = {
  auth: { email: 'payer@gmail.com' },
  subscription: { product: { id: 'premium' }, status: 'active' },
};

const FREE_USER = {
  auth: { email: 'free@gmail.com' },
  subscription: { product: { id: 'basic' }, status: 'active' },
};

const CANCELLED_USER = {
  auth: { email: 'cancelled@gmail.com' },
  subscription: { product: { id: 'premium' }, status: 'cancelled' },
};

// ─── isNewsletterInactive(): the Beehiiv lane's own rule ───
const INACTIVE_CASES = [
  {
    name: 'never opened or clicked across the received floor',
    subscription: { email: 'cold@gmail.com' },
    expect: true,
  },
  {
    name: 'opened at least once (a rate survives forever)',
    subscription: { email: 'opener@gmail.com', openRate: 12.5 },
    expect: false,
  },
  {
    name: 'clicked at least once',
    subscription: { email: 'clicker@gmail.com', clickRate: 4 },
    expect: false,
  },
  {
    name: 'under the received floor (a quiet channel prunes nobody)',
    subscription: { email: 'unmailed@gmail.com', received: NEWSLETTER_RECEIVED_FLOOR - 1 },
    expect: false,
  },
  {
    name: 'exactly at the received floor',
    subscription: { email: 'floor@gmail.com', received: NEWSLETTER_RECEIVED_FLOOR },
    expect: true,
  },
  {
    name: 'too new to judge (inside the grace period)',
    subscription: { email: 'fresh@gmail.com', ageDays: NEWSLETTER_MIN_AGE_DAYS - 1 },
    expect: false,
  },
];

module.exports = {
  description: 'Marketing prune is strictly per-provider (SendGrid lane + Beehiiv lane)',
  type: 'group',

  tests: [
    // ─── 1. The bug: SendGrid-inactive emails must NOT leave Beehiiv ───
    {
      name: 'stage 2: a SendGrid-inactive contact is deleted from SendGrid and left in Beehiiv',

      async run() {
        const { admin, writes } = buildAdmin();
        const { ctx } = buildAssistant();
        const deleted = [];
        const beehiivRemovals = [];

        await withProviders({
          sendgrid: sendgridSeam([contact('newsletter.reader@gmail.com', 'sg_1')], deleted),
          beehiiv: {
            removeContact: async (email) => { beehiivRemovals.push(email); return { success: true, deleted: true }; },
          },
          env: { SENDGRID_API_KEY: 'test-key', BEEHIIV_API_KEY: 'test-key' },
        }, () => stagePrune(buildManager(NEWSLETTER_ENABLED), ctx, { admin }));

        assert.deepStrictEqual(
          beehiivRemovals,
          [],
          `SendGrid engagement must never delete a Beehiiv subscriber, removed: ${JSON.stringify(beehiivRemovals)}`,
        );
        assert.deepStrictEqual(deleted, ['sg_1'], `The SendGrid delete still runs, got ${JSON.stringify(deleted)}`);
        assert.strictEqual(writes.length, 1, `Stage 2 writes one prune log, got ${writes.length}`);
        assert.strictEqual(
          writes[0].path,
          `marketing-prune-logs/${BRAND.id}/runs/${logKey()}`,
          `The SendGrid lane keeps its run doc path, got ${writes[0].path}`,
        );
        assert.deepStrictEqual(writes[0].data.emails, ['newsletter.reader@gmail.com'], 'The log keeps the deleted emails for recoverability');
      },
    },

    // ─── 2. The Beehiiv lane's rule ───
    ...INACTIVE_CASES.map(({ name, subscription: options, expect }) => ({
      name: `isNewsletterInactive: ${name}`,

      run() {
        const actual = isNewsletterInactive(subscription(options), Date.now());

        assert.strictEqual(actual, expect, `Expected ${expect}, got ${actual}`);
      },
    })),

    {
      name: 'isNewsletterInactive: unjudgeable without stats (never delete on data we do not have)',

      run() {
        const bare = { id: 'sub_1', email: 'nostats@gmail.com', created: Math.round((Date.now() - (400 * DAY)) / 1000) };

        assert.strictEqual(isNewsletterInactive(bare, Date.now()), false, 'A subscription with no stats is never prunable');
        assert.strictEqual(
          isNewsletterInactive({ ...bare, stats: { emails_received: 40 } }, Date.now()),
          false,
          'A stats block missing the rates is never prunable',
        );
      },
    },

    // ─── 3. Stage 3 deletes exactly the Beehiiv-inactive subscribers ───
    {
      name: 'stage 3: deletes the Beehiiv-inactive subscribers and nobody else',

      async run() {
        const { admin, writes } = buildAdmin();
        const { ctx } = buildAssistant();
        const removals = [];
        const listArgs = [];

        await withProviders({
          beehiiv: {
            listSubscriptions: async (options) => {
              listArgs.push(options);
              return {
                success: true,
                subscriptions: [
                  subscription({ email: 'cold@gmail.com' }),
                  subscription({ email: 'opener@gmail.com', openRate: 22 }),
                  subscription({ email: 'clicker@gmail.com', clickRate: 3 }),
                  subscription({ email: 'unmailed@gmail.com', received: NEWSLETTER_RECEIVED_FLOOR - 1 }),
                  subscription({ email: 'fresh@gmail.com', ageDays: 3 }),
                ],
              };
            },
            removeContact: async (email) => { removals.push(email); return { success: true, deleted: true }; },
          },
          env: { BEEHIIV_API_KEY: 'test-key' },
        }, () => stageNewsletterPrune(buildManager(NEWSLETTER_ENABLED), ctx, { admin }));

        assert.deepStrictEqual(removals, ['cold@gmail.com'], `Only the Beehiiv-inactive subscriber is deleted, got ${JSON.stringify(removals)}`);
        assert.deepStrictEqual(
          listArgs,
          [{ status: 'active', expand: ['stats'] }],
          `The lane reads Beehiiv's own per-subscriber stats, got ${JSON.stringify(listArgs)}`,
        );
        assert.strictEqual(
          writes[0]?.path,
          `marketing-prune-logs/${BRAND.id}/runs/${logKey()}-newsletter`,
          `The Beehiiv lane logs under its own run doc, got ${writes[0]?.path}`,
        );
        assert.deepStrictEqual(writes[0].data.emails, ['cold@gmail.com'], 'The log keeps the deleted emails for recoverability');
      },
    },

    // ─── 4. A quiet channel prunes nobody (the received-floor dormancy) ───
    {
      name: 'stage 3: a channel that has barely sent prunes nobody',

      async run() {
        const { admin, writes } = buildAdmin();
        const { ctx } = buildAssistant();
        const removals = [];

        await withProviders({
          beehiiv: {
            listSubscriptions: async () => ({
              success: true,
              subscriptions: [
                subscription({ email: 'a@gmail.com', received: 0 }),
                subscription({ email: 'b@gmail.com', received: NEWSLETTER_RECEIVED_FLOOR - 1 }),
              ],
            }),
            removeContact: async (email) => { removals.push(email); return { success: true }; },
          },
          env: { BEEHIIV_API_KEY: 'test-key' },
        }, () => stageNewsletterPrune(buildManager(NEWSLETTER_ENABLED), ctx, { admin }));

        assert.deepStrictEqual(removals, [], `Dormancy is the guard working, got ${JSON.stringify(removals)}`);
        assert.strictEqual(writes.length, 0, 'Nothing deleted means nothing logged');
      },
    },

    // ─── 5. A failed listing deletes nothing ───
    {
      name: 'stage 3: a failed listing deletes nobody',

      async run() {
        const { admin } = buildAdmin();
        const { ctx, calls } = buildAssistant();
        const removals = [];

        await withProviders({
          beehiiv: {
            listSubscriptions: async () => ({ success: false, error: 'Publication not found' }),
            removeContact: async (email) => { removals.push(email); return { success: true }; },
          },
          env: { BEEHIIV_API_KEY: 'test-key' },
        }, () => stageNewsletterPrune(buildManager(NEWSLETTER_ENABLED), ctx, { admin }));

        assert.deepStrictEqual(removals, [], `A partial or failed read must never drive deletes, got ${JSON.stringify(removals)}`);
        assert.strictEqual(calls.errors.length, 1, `The failed listing is logged loudly, got ${JSON.stringify(calls.errors)}`);
      },
    },

    // ─── 6. A subscriber who vanished mid-run is not counted as pruned ───
    {
      name: 'stage 3: a subscriber already gone at delete time is not logged as pruned',

      async run() {
        const { admin, writes } = buildAdmin();
        const { ctx } = buildAssistant();

        await withProviders({
          beehiiv: {
            listSubscriptions: async () => ({
              success: true,
              subscriptions: [
                subscription({ email: 'cold@gmail.com' }),
                subscription({ email: 'vanished@gmail.com' }),
              ],
            }),
            // Beehiiv answers { success: true, skipped: true } when the
            // subscription is already gone — a skip is not a prune.
            removeContact: async (email) => (email === 'vanished@gmail.com'
              ? { success: true, skipped: true, reason: 'Subscriber not found' }
              : { success: true, deleted: true }),
          },
          env: { BEEHIIV_API_KEY: 'test-key' },
        }, () => stageNewsletterPrune(buildManager(NEWSLETTER_ENABLED), ctx, { admin }));

        assert.deepStrictEqual(
          writes[0]?.data.emails,
          ['cold@gmail.com'],
          `Only the subscribers this run actually deleted are logged, got ${JSON.stringify(writes[0]?.data.emails)}`,
        );
        assert.strictEqual(writes[0]?.data.count, 1, `The recoverability count matches the deletes, got ${writes[0]?.data.count}`);
      },
    },

    // ─── 7. Paying customers are never pruned (stage 2's exclusion, stage 3's data) ───
    {
      name: 'stage 3: a paying account is skipped and the free ones still go',

      async run() {
        const { admin, writes } = buildAdmin({
          'payer@gmail.com': PAYING_USER,
          'free@gmail.com': FREE_USER,
          'cancelled@gmail.com': CANCELLED_USER,
        });
        const { ctx } = buildAssistant();
        const removals = [];

        await withProviders({
          beehiiv: {
            listSubscriptions: async () => ({
              success: true,
              subscriptions: [
                subscription({ email: 'payer@gmail.com' }),
                subscription({ email: 'free@gmail.com' }),
                subscription({ email: 'cancelled@gmail.com' }),
                subscription({ email: 'noaccount@gmail.com' }),
              ],
            }),
            removeContact: async (email) => { removals.push(email); return { success: true, deleted: true }; },
          },
          env: { BEEHIIV_API_KEY: 'test-key' },
        }, () => stageNewsletterPrune(buildManager(NEWSLETTER_ENABLED), ctx, { admin }));

        assert.deepStrictEqual(
          removals,
          ['free@gmail.com', 'cancelled@gmail.com', 'noaccount@gmail.com'],
          `A paying account is never pruned, and nobody else is spared, got ${JSON.stringify(removals)}`,
        );
        assert.strictEqual(writes[0]?.data.skippedPaid, 1, `The run log counts the skipped payer, got ${writes[0]?.data.skippedPaid}`);
        assert.deepStrictEqual(
          writes[0]?.data.emails,
          ['free@gmail.com', 'cancelled@gmail.com', 'noaccount@gmail.com'],
          `The run log holds only the deleted emails, got ${JSON.stringify(writes[0]?.data.emails)}`,
        );
      },
    },

    {
      name: 'stage 3: an all-paying candidate set deletes nobody',

      async run() {
        const { admin, writes } = buildAdmin({ 'payer@gmail.com': PAYING_USER });
        const { ctx } = buildAssistant();
        const removals = [];

        await withProviders({
          beehiiv: {
            listSubscriptions: async () => ({
              success: true,
              subscriptions: [subscription({ email: 'payer@gmail.com' })],
            }),
            removeContact: async (email) => { removals.push(email); return { success: true, deleted: true }; },
          },
          env: { BEEHIIV_API_KEY: 'test-key' },
        }, () => stageNewsletterPrune(buildManager(NEWSLETTER_ENABLED), ctx, { admin }));

        assert.deepStrictEqual(removals, [], `Nothing left to prune means no deletes, got ${JSON.stringify(removals)}`);
        assert.strictEqual(writes.length, 0, 'Nothing deleted means nothing logged');
      },
    },

    // ─── 8. The lane is gated on Beehiiv being configured ───
    {
      name: 'stage 3: skips when the newsletter is disabled',

      async run() {
        const { admin } = buildAdmin();
        const { ctx } = buildAssistant();
        let listed = false;

        await withProviders({
          beehiiv: {
            listSubscriptions: async () => { listed = true; return { success: true, subscriptions: [] }; },
          },
          env: { BEEHIIV_API_KEY: 'test-key' },
        }, () => stageNewsletterPrune(
          buildManager({ campaigns: { enabled: true }, newsletter: { enabled: false } }),
          ctx,
          { admin },
        ));

        assert.strictEqual(listed, false, 'A disabled newsletter never reaches the provider');
      },
    },

    // ─── 9. listSubscriptions: the pagination contract ───
    {
      name: 'listSubscriptions: follows the cursor to the end',

      async run() {
        const calls = [];
        const pages = [
          { data: [{ id: 'sub_1' }, { id: 'sub_2' }], has_more: true, next_cursor: 'cursor_2' },
          { data: [{ id: 'sub_3' }], has_more: false, next_cursor: null },
        ];

        const request = async (url) => {
          calls.push(url);
          return pages[calls.length - 1];
        };

        const result = await withPublication(() => beehiivProvider.listSubscriptions(
          { status: 'active', expand: ['stats'] },
          request,
        ));

        assert.strictEqual(result.success, true, `Expected a successful walk, got ${JSON.stringify(result)}`);
        assert.strictEqual(result.subscriptions.length, 3, `Every page's subscribers are collected, got ${result.subscriptions.length}`);
        assert.strictEqual(calls.length, 2, `The walk stops on has_more: false, got ${calls.length} calls`);
        assert.match(calls[0], /limit=100/, `The first page asks for a full page, got ${calls[0]}`);
        assert.match(calls[0], /status=active/, `The status filter rides the query, got ${calls[0]}`);
        assert.match(calls[0], /expand\[\]=stats/, `The stats expand rides the query unencoded, got ${calls[0]}`);
        assert.ok(!calls[0].includes('cursor='), `The first page carries no cursor, got ${calls[0]}`);
        assert.match(calls[1], /cursor=cursor_2/, `The next page carries the returned cursor, got ${calls[1]}`);
      },
    },

    {
      name: 'listSubscriptions: an offset-paginated response fails instead of truncating',

      async run() {
        const full = { data: Array.from({ length: 100 }, (_, i) => ({ id: `sub_${i}` })), limit: 100, page: 1, total_pages: 3 };
        let calls = 0;

        const result = await withPublication(() => beehiivProvider.listSubscriptions({}, async () => {
          calls++;
          return full;
        }));

        assert.strictEqual(result.success, false, `A response with no has_more and more pages behind it must fail, got ${JSON.stringify(result).slice(0, 120)}`);
        assert.match(result.error, /offset/i, `The error names the shape, got ${result.error}`);
        assert.strictEqual(calls, 1, `The walk stops at the unexpected shape, got ${calls} calls`);

        // The carve-out: one short page with nothing behind it is complete, not truncated.
        const short = await withPublication(() => beehiivProvider.listSubscriptions({}, async () => ({
          data: [{ id: 'sub_1' }, { id: 'sub_2' }],
          limit: 100,
        })));

        assert.strictEqual(short.success, true, `A single short page is a complete list, got ${JSON.stringify(short).slice(0, 120)}`);
        assert.strictEqual(short.subscriptions.length, 2, `Got ${short.subscriptions.length}`);
      },
    },

    {
      name: 'listSubscriptions: the page cap fails instead of truncating',

      async run() {
        let calls = 0;

        const result = await withPublication(() => beehiivProvider.listSubscriptions({}, async () => {
          calls++;
          return { data: [{ id: `sub_${calls}` }], has_more: true, next_cursor: `cursor_${calls}` };
        }));

        assert.strictEqual(result.success, false, `A never-ending walk must fail, got ${JSON.stringify(result).slice(0, 120)}`);
        assert.match(result.error, /500 pages/, `The error names the cap, got ${result.error}`);
        assert.strictEqual(calls, 500, `The cap stops the walk at 500 pages, got ${calls}`);
        assert.strictEqual(result.subscriptions, undefined, 'A capped walk reports no list at all, so nobody can prune from it');
      },
    },

    // ─── 10. The cron entry is OPT-IN (#422) ───
    // A framework that deletes a consumer's contacts unless told not to is the
    // wrong default: nothing runs without an explicit marketing.prune.enabled.
    {
      name: 'entry: a marketing block with no prune key books zero deletions',

      async run() {
        const { admin, writes } = buildAdmin();
        const { ctx, calls } = buildAssistant();
        const deleted = [];
        const removals = [];
        const sent = [];

        await onPruneDay(() => withProviders({
          sendgrid: sendgridSeam([contact('cold@gmail.com', 'sg_1')], deleted),
          beehiiv: {
            listSubscriptions: async () => ({
              success: true,
              subscriptions: [subscription({ email: 'cold@gmail.com' })],
            }),
            removeContact: async (email) => { removals.push(email); return { success: true, deleted: true }; },
          },
          env: { SENDGRID_API_KEY: 'test-key', BEEHIIV_API_KEY: 'test-key' },
        }, () => cron({ Manager: buildManager(NEWSLETTER_ENABLED, sent), ctx, libraries: { admin } })));

        assert.deepStrictEqual(deleted, [], `An unconfigured prune deletes no SendGrid contact, got ${JSON.stringify(deleted)}`);
        assert.deepStrictEqual(removals, [], `An unconfigured prune deletes no Beehiiv subscriber, got ${JSON.stringify(removals)}`);
        assert.deepStrictEqual(sent, [], `An unconfigured prune sends no re-engagement campaign, got ${JSON.stringify(sent)}`);
        assert.strictEqual(writes.length, 0, `Nothing ran, so nothing is logged, got ${JSON.stringify(writes)}`);
        assert.ok(
          calls.logs.some((line) => line.includes('Marketing prune: disabled')),
          `The skip is logged, got ${JSON.stringify(calls.logs)}`,
        );
      },
    },

    {
      name: 'entry: prune.enabled = true runs every lane',

      async run() {
        const { admin, writes } = buildAdmin();
        const { ctx } = buildAssistant();
        const deleted = [];
        const removals = [];
        const sent = [];

        await onPruneDay(() => withProviders({
          sendgrid: sendgridSeam([contact('cold@gmail.com', 'sg_1')], deleted),
          beehiiv: {
            listSubscriptions: async () => ({
              success: true,
              subscriptions: [subscription({ email: 'cold@gmail.com' })],
            }),
            removeContact: async (email) => { removals.push(email); return { success: true, deleted: true }; },
          },
          env: { SENDGRID_API_KEY: 'test-key', BEEHIIV_API_KEY: 'test-key' },
        }, () => cron({ Manager: buildManager(PRUNE_OPTED_IN, sent), ctx, libraries: { admin } })));

        assert.deepStrictEqual(deleted, ['sg_1'], `The SendGrid lane still deletes, got ${JSON.stringify(deleted)}`);
        assert.deepStrictEqual(removals, ['cold@gmail.com'], `The Beehiiv lane still deletes, got ${JSON.stringify(removals)}`);
        assert.strictEqual(sent.length, 1, `The re-engagement campaign still sends, got ${sent.length}`);
        assert.deepStrictEqual(
          writes.map((write) => write.path),
          [
            `marketing-prune-logs/${BRAND.id}/runs/${logKey()}`,
            `marketing-prune-logs/${BRAND.id}/runs/${logKey()}-newsletter`,
          ],
          `Both lanes log their run doc, got ${JSON.stringify(writes.map((write) => write.path))}`,
        );
      },
    },
  ],
};
