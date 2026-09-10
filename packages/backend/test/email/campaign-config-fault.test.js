/**
 * Campaign config-fault finalization — a permanent brand-config hole fails the
 * campaign in ONE cron pass instead of retrying forever.
 *
 * A send that throws leaves the campaign at 'processing' for the stale-lease
 * reclaim — right for a crash or a provider blip, wrong for a config hole
 * (missing `brand.url` on the push path, missing `brand.contact.*` on the email
 * path), which no amount of retrying can heal. The cron now finalizes a CODED
 * 400 — the framework's config-fault convention — as 'failed', and leaves
 * everything else on its existing path.
 *
 * A permanent fault reaches the cron three ways, all covered here:
 *   - thrown by the send (the push path throws its brand.url 400 directly)
 *   - CARRIED in a provider result: sendCampaign() converts each provider's
 *     throw to { success: false, error, code }, so the email path's config-hole
 *     400s never surface as throws
 *   - thrown by the generator pipeline (the AI library's invalid-request 400s),
 *     which the empty-generation attempts ladder never counts
 *
 * Plain-node control-flow test (no emulator, no network): the real cron module
 * and the real notification library throw the real coded error. Only Firestore
 * is a minimal in-memory stand-in — the fixture project's brand IS fully
 * configured, so the emulator suite (campaign-cron-pipeline) cannot produce a
 * config hole at all; it stays the integration surface for the happy paths.
 */
const assert = require('node:assert');
const cron = require('../../dist/manager/events/cron/frequent/marketing-campaigns.js');
const newsletter = require('../../dist/manager/libraries/email/generators/newsletter.js');
const Marketing = require('../../dist/manager/libraries/email/marketing/index.js');
const { getNextFutureOccurrence } = require('../../dist/manager/libraries/email/constants.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// The config-hole message the email library actually throws (prepare.js).
const EMAIL_CONFIG_HOLE = 'Missing brand.contact.email in config/omega.json5';

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// No `url` — the push path's coded-400 config hole (notification.js throws it).
const BRAND_WITHOUT_URL = { id: 'acme', name: 'Acme' };

function stamp(now) {
  return { timestamp: new Date(now * 1000).toISOString(), timestampUNIX: now };
}

/**
 * Minimal in-memory Firestore stand-in: the queries, the claim transaction, and
 * the merge writes the cron actually makes. Merge is top-level (the cron only
 * ever merges whole top-level fields).
 */
function buildAdmin(seed) {
  const store = new Map(Object.entries(seed));

  const ref = (id) => ({
    id,
    set: async (data, options) => {
      store.set(id, { ...(options?.merge ? store.get(id) || {} : {}), ...data });
    },
  });

  const matches = (data, { field, op, value }) => {
    const actual = data[field];
    return op === '<=' ? actual <= value : actual === value;
  };

  const query = (filters) => ({
    where: (field, op, value) => query([...filters, { field, op, value }]),
    limit: () => query(filters),
    get: async () => {
      const ids = [...store.keys()].filter(id => filters.every(f => matches(store.get(id), f)));

      return {
        empty: ids.length === 0,
        size: ids.length,
        docs: ids.map(id => ({ id, data: () => ({ ...store.get(id) }), ref: ref(id) })),
      };
    },
  });

  const admin = {
    firestore: () => ({
      collection: () => query([]),
      doc: (path) => ref(path.split('/').pop()),
      runTransaction: async (fn) => fn({
        get: async (r) => ({ exists: store.has(r.id), data: () => store.get(r.id) }),
        set: (r, data, options) => { r.set(data, options); },
      }),
    }),
  };

  return { admin, store };
}

/**
 * Run one cron pass over the seeded campaigns and return the resulting docs.
 *
 * `sendCampaign` defaults to a throw so an accidental email dispatch on the
 * push cases is loud rather than silently passing; the email cases pass their
 * own. `generate` swaps the newsletter generator's export for the run (the
 * cron requires the module by path, so the require cache IS the seam) and is
 * always restored.
 */
async function runCron(seed, { sendCampaign, generate } = {}) {
  const { admin, store } = buildAdmin(seed);
  const logs = [];
  const errors = [];

  const Manager = {
    config: { brand: BRAND_WITHOUT_URL },
    isProduction: () => false,
    Email: () => ({
      sendCampaign: sendCampaign
        || (async () => { throw new Error('sendCampaign() should not be reached'); }),
    }),
  };

  // notification.send() reads the brand off ctx.Manager, as it does in the
  // real framework ctx.
  const ctx = {
    Manager,
    log: (...args) => logs.push(args.join(' ')),
    error: (...args) => errors.push(args.join(' ')),
  };

  const original = newsletter.generate;

  if (generate) {
    newsletter.generate = generate;
  }

  try {
    await cron({ Manager, ctx, libraries: { admin } });
  } finally {
    newsletter.generate = original;
  }

  return { store, logs, errors };
}

/** A due push campaign whose title/body are set — the send reaches buildPayload. */
function pushCampaign(now, extra = {}) {
  return {
    status: 'pending',
    type: 'push',
    sendAt: now - 600,
    settings: { name: '[TEST] Config fault', subject: 'Body copy' },
    metadata: { created: stamp(now), updated: stamp(now) },
    ...extra,
  };
}

/** A due email campaign. */
function emailCampaign(now, extra = {}) {
  return {
    status: 'pending',
    type: 'email',
    sendAt: now - 600,
    settings: { name: '[TEST] Config fault', subject: 'Subject' },
    metadata: { created: stamp(now), updated: stamp(now) },
    ...extra,
  };
}

/** A due newsletter-generator campaign. */
function generatorCampaign(now, extra = {}) {
  return emailCampaign(now, { generator: 'newsletter', ...extra });
}

const WEEKLY = { pattern: 'weekly', hour: 10, minute: 0, day: 1 };

module.exports = defineCases({
  description: 'Campaign config faults finalize as failed (no forever-retry)',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a coded-400 config fault fails the campaign in one pass',

      async run() {
        const now = Math.round(Date.now() / 1000);
        const { store } = await runCron({ '_fault-oneoff': pushCampaign(now) });
        const doc = store.get('_fault-oneoff');

        assert.equal(doc.status, 'failed', 'a config hole must be finalized, not left for the lease reclaim');
        assert.match(doc.error, /brand\.url/, 'the error names the missing config key');
        assert.ok(doc.metadata?.updated, 'the finalize stamps metadata.updated');
      },
    },

    {
      name: 'a recurring campaign fails outright too (a recurrence cannot heal it)',

      async run() {
        const now = Math.round(Date.now() / 1000);
        const sendAt = now - 600;
        const { store } = await runCron({
          '_fault-recurring': pushCampaign(now, { recurrence: WEEKLY }),
        });
        const doc = store.get('_fault-recurring');

        assert.equal(doc.status, 'failed', 'the recurring doc fails rather than returning to pending');
        assert.equal(doc.sendAt, sendAt, 'sendAt is NOT advanced — the next occurrence meets the same hole');
        assert.match(doc.error, /brand\.url/, 'the error names the missing config key');
      },
    },

    {
      name: 'an uncoded (transient) throw still stays processing for the lease reclaim',

      async run() {
        const now = Math.round(Date.now() / 1000);
        // No subject/body — notification.send() throws a CODE-LESS error, the
        // transient shape. Unchanged behavior: the doc keeps its lease.
        const { store, errors } = await runCron({
          '_transient': pushCampaign(now, { settings: { name: '[TEST] Transient' } }),
        });
        const doc = store.get('_transient');

        assert.equal(doc.status, 'processing', 'a code-less failure keeps the stale-lease retry path');
        assert.ok(!doc.error, 'no terminal error field is written');
        assert.equal(errors.length, 1, 'the rejection is still reported once');
        assert.match(errors[0], /title and body are required/, 'the reported reason is the real throw');
      },
    },

    {
      name: 'a stale lease is still reclaimed and re-processed',

      async run() {
        const now = Math.round(Date.now() / 1000);
        const { store } = await runCron({
          '_stale': pushCampaign(now, {
            status: 'processing',
            processingStartedAt: now - cron.PROCESSING_LEASE_SECONDS - 600,
          }),
        });
        const doc = store.get('_stale');

        // Reclaimed → pending, then picked up by the same pass's due query and
        // finalized by the config fault. The reclaim itself is untouched.
        assert.equal(doc.status, 'failed', 'the reclaimed campaign is processed in the same pass');
      },
    },

    // ---------- Email path: the fault is CARRIED, not thrown ----------

    {
      name: 'sendCampaign keeps a provider throw\'s code (and omits it when absent)',

      run() {
        const coded = Marketing.providerFailure(codedError(EMAIL_CONFIG_HOLE, 400));

        assert.equal(coded.success, false, 'still the failure shape callers read');
        assert.equal(coded.error, EMAIL_CONFIG_HOLE, 'still carries the message');
        assert.equal(coded.code, 400, 'the config-fault code survives the conversion');

        const plain = Marketing.providerFailure(new Error('SendGrid 503'));

        assert.ok(!('code' in plain), 'no code key at all — Firestore rejects undefined field values');
      },
    },

    {
      name: 'a carried coded-400 fails a one-off email campaign',

      async run() {
        const now = Math.round(Date.now() / 1000);
        const { store } = await runCron(
          { '_email-oneoff': emailCampaign(now) },
          { sendCampaign: async () => ({ campaigns: { success: false, error: EMAIL_CONFIG_HOLE, code: 400 } }) },
        );
        const doc = store.get('_email-oneoff');

        assert.equal(doc.status, 'failed', 'a carried config fault finalizes the campaign');
        assert.equal(doc.error, EMAIL_CONFIG_HOLE, 'the provider message lands in error');
      },
    },

    {
      name: 'a carried coded-400 fails a recurring email campaign without advancing sendAt',

      async run() {
        const now = Math.round(Date.now() / 1000);
        const sendAt = now - 600;
        const { store } = await runCron(
          { '_email-recurring': emailCampaign(now, { recurrence: WEEKLY }) },
          { sendCampaign: async () => ({ campaigns: { success: false, error: EMAIL_CONFIG_HOLE, code: 400 } }) },
        );
        const doc = store.get('_email-recurring');

        assert.equal(doc.status, 'failed', 'the recurring doc must not return to pending');
        assert.equal(doc.sendAt, sendAt, 'sendAt is NOT advanced into the identical failure');
        assert.equal(store.size, 1, 'no history doc for a campaign that never sent');
      },
    },

    {
      name: 'a code-less provider failure keeps today\'s success:false bookkeeping',

      async run() {
        const now = Math.round(Date.now() / 1000);
        const sendAt = now - 600;
        const { store } = await runCron(
          { '_email-transient': emailCampaign(now, { recurrence: WEEKLY }) },
          { sendCampaign: async () => ({ campaigns: { success: false, error: 'SendGrid 503' } }) },
        );
        const doc = store.get('_email-transient');

        // Pinned as found: a transient provider failure still writes a 'failed'
        // history doc and re-pends the recurring template at its next occurrence.
        assert.equal(doc.status, 'pending', 'the recurring template returns to pending');
        assert.equal(doc.sendAt, getNextFutureOccurrence(sendAt, WEEKLY, now), 'sendAt advances');
        assert.equal(store.size, 2, 'the history doc is still written');

        const history = [...store.values()].find(d => d.recurringId === '_email-transient');
        assert.equal(history.status, 'failed', 'the history doc records the failed send');
      },
    },

    {
      name: 'a thrown coded-400 fails an email campaign too',

      async run() {
        const now = Math.round(Date.now() / 1000);
        const { store } = await runCron(
          { '_email-thrown': emailCampaign(now) },
          { sendCampaign: async () => { throw codedError(EMAIL_CONFIG_HOLE, 400); } },
        );
        const doc = store.get('_email-thrown');

        assert.equal(doc.status, 'failed', 'the dispatch catch covers the email path, not just push');
        assert.equal(doc.error, EMAIL_CONFIG_HOLE, 'the thrown message lands in error');
      },
    },

    // ---------- Generator path: a THROW never reaches the attempts ladder ----------

    {
      name: 'a coded-400 out of generate() fails the campaign in one pass',

      async run() {
        const now = Math.round(Date.now() / 1000);
        const { store } = await runCron(
          { '_gen-fault': generatorCampaign(now, { recurrence: WEEKLY }) },
          { generate: async () => { throw codedError('Error loading prompt[system]: missing', 400); } },
        );
        const doc = store.get('_gen-fault');

        assert.equal(doc.status, 'failed', 'a permanent AI fault is finalized, not reclaimed forever');
        assert.match(doc.error, /Error loading prompt/, 'the pipeline message lands in error');
        assert.ok(!doc.generatorAttempts, 'the empty-generation ladder never counted a throw');
      },
    },

    {
      name: 'an uncoded generate() rejection still stays processing',

      async run() {
        const now = Math.round(Date.now() / 1000);
        const { store, errors } = await runCron(
          { '_gen-transient': generatorCampaign(now) },
          { generate: async () => { throw new Error('OpenAI rate limit'); } },
        );
        const doc = store.get('_gen-transient');

        assert.equal(doc.status, 'processing', 'a transient AI fault keeps the stale-lease retry path');
        assert.ok(!doc.error, 'no terminal error field is written');
        assert.match(errors[0], /rate limit/, 'the reported reason is the real throw');
      },
    },
  ],
});
