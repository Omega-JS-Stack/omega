/**
 * Marketing contact pruning cron job
 *
 * Runs daily but only acts on the 1st of each month.
 *
 * Pruning is STRICTLY PER-PROVIDER ([#365](https://github.com/Omega-JS-Stack/omega/issues/365)):
 * each provider's own engagement decides that provider's removals, never the
 * other's. SendGrid carries offers and product mail, Beehiiv carries the
 * newsletter, and a reader who devours every newsletter while ignoring offers
 * is engaged on one channel and quiet on the other — deleting them from the
 * newsletter on a SendGrid-only signal was the bug this shape replaces.
 *
 *   Stage 1 (engagement_inactive_5m) — both providers, each on its own data:
 *     → Send re-engagement email via sendCampaign (brand-scoped internally)
 *     → Excludes engagement_inactive_6m (those get pruned instead)
 *     → Already per-provider: each provider resolves the segment key against
 *       its OWN engagement tracking, so nobody is targeted on foreign data
 *
 *   Stage 2 (engagement_inactive_6m) — SENDGRID ONLY:
 *     → Create brand-scoped temp segment via createBrandScopedSegment
 *     → Export contacts, exclude paying customers, bulk delete
 *     → Log deleted emails to Firestore for recoverability
 *
 *   Stage 3 — BEEHIIV ONLY:
 *     → List the publication's active subscriptions with Beehiiv's own
 *       per-subscriber stats, delete the ones inactive by THOSE stats
 *     → Exclude paying customers (the subscription_paid definition, resolved
 *       from Firestore since Beehiiv cannot see app subscriptions)
 *     → Log deleted emails to Firestore for recoverability
 *
 * Removal is always a DELETE, never an unsubscribe: an unsubscribe revokes
 * marketing consent in Firestore permanently, and a maintenance prune must
 * never spend a consent it can't give back.
 *
 * Segment keys are resolved to provider-specific IDs at runtime.
 *
 * OPT-IN ([#422](https://github.com/Omega-JS-Stack/omega/issues/422)): nothing
 * here runs without an explicit marketing.prune.enabled = true — see
 * docs/marketing-campaigns.md § Contact Pruning for the contract.
 *
 * Runs on omega_cronDaily.
 */
const sendgridProvider = require('../../../libraries/email/providers/sendgrid.js');
const beehiivProvider = require('../../../libraries/email/providers/beehiiv.js');
const Marketing = require('../../../libraries/email/marketing/index.js');
const User = require('../../../helpers/user.js');

// The Beehiiv lane's inactivity rule, mirroring the SendGrid engagement_inactive_6m
// segment (libraries/email/constants.js) with Beehiiv's own numbers:
//
//   NEWSLETTER_RECEIVED_FLOOR mirrors `received_gte: 5` — a subscriber must have
//   been SENT enough newsletters for silence to mean anything. A quiet channel
//   prunes nobody, which is the guard working, not a bug to fix.
//
//   NEWSLETTER_MIN_AGE_DAYS mirrors the segment's `signup_date not_within 180d`
//   condition — a recent subscriber gets the same grace period on both channels.
const NEWSLETTER_RECEIVED_FLOOR = 5;
const NEWSLETTER_MIN_AGE_DAYS = 180;

// How many Beehiiv subscribers are deleted at once. Each removal is TWO API
// calls (look up the subscription, then delete it), so 50 keeps the in-flight
// call count at the same 100 the SendGrid batch loop below already uses.
const NEWSLETTER_DELETE_CHUNK = 50;

module.exports = async ({ Manager, ctx, libraries }) => {
  if (new Date().getDate() !== 1) {
    return;
  }

  if (Manager.config?.marketing?.prune?.enabled !== true) {
    ctx.log('Marketing prune: disabled (set marketing.prune.enabled to true to opt in)');
    return;
  }

  const brand = Manager.config?.brand;

  ctx.log(`Marketing prune: Starting monthly prune cycle for ${brand?.id || 'unknown'}`);

  // --- Stage 1: Re-engagement email ---
  try {
    await stageReengage(Manager, ctx);
  } catch (e) {
    ctx.error('Marketing prune: Stage 1 (re-engagement) failed:', e.message);
  }

  // --- Stage 2: Delete SendGrid-inactive contacts from SendGrid ---
  // Each stage is caught on its own: the lanes are independent by design, so a
  // provider outage in one must never cost the others their monthly run.
  try {
    await stagePrune(Manager, ctx, libraries);
  } catch (e) {
    ctx.error('Marketing prune: Stage 2 (SendGrid prune) failed:', e.message);
  }

  // --- Stage 3: Delete Beehiiv-inactive subscribers from Beehiiv ---
  try {
    await stageNewsletterPrune(Manager, ctx, libraries);
  } catch (e) {
    ctx.error('Marketing prune: Stage 3 (Beehiiv prune) failed:', e.message);
  }

  ctx.log(`Marketing prune: Completed for ${brand?.id || 'unknown'}`);
};

/**
 * Stage 1: Send re-engagement email to contacts inactive 5+ months
 * (excluding 6+ months — those get pruned in stage 2).
 *
 * sendCampaign handles brand-scoping internally via _resolveAudience →
 * createBrandScopedSegment, so this stage is already brand-safe.
 */
async function stageReengage(Manager, ctx) {
  ctx.log('Marketing prune: Stage 1 — Re-engagement');

  const mailer = Manager.Email(ctx);
  const brand = Manager.config?.brand;

  const result = await mailer.sendCampaign({
    name: 'Re-engagement: Are you still with us?',
    subject: `We miss you at ${brand?.name || 'our service'}!`,
    preheader: 'Update your preferences or say goodbye',
    content: [
      '# We miss you!',
      '',
      'It\'s been a while since you\'ve opened one of our emails. We want to make sure we\'re sending you content you actually want.',
      '',
      '**If you\'d like to keep hearing from us**, simply open this email — no action needed!',
      '',
      'If we don\'t hear from you, we\'ll remove you from our mailing list next month to keep your inbox clean.',
      '',
      `Thanks for being part of the ${brand?.name || ''} community.`,
    ].join('\n'),
    sender: 'hello',
    segments: ['engagement_inactive_5m'],
    excludeSegments: ['engagement_inactive_6m'],
    sendAt: 'now',
  });

  ctx.log('Marketing prune: Re-engagement result:', result);
}

/**
 * Stage 2: Delete SENDGRID contacts inactive 6+ months in SENDGRID (brand-scoped).
 *
 * Uses createBrandScopedSegment to AND the engagement_inactive_6m query
 * with brand_id = '<brandId>' — each brand only prunes its own contacts.
 * Excludes paying customers (subscription_paid segment).
 * Logs deleted emails to Firestore for recoverability.
 *
 * Stops at SendGrid: the same emails stay in Beehiiv, which prunes on its own
 * engagement in stage 3.
 */
async function stagePrune(Manager, ctx, libraries) {
  ctx.log('Marketing prune: Stage 2 — Prune (SendGrid)');

  const marketing = Manager.config?.marketing || {};
  const brand = Manager.config?.brand;
  const { admin } = libraries;

  if (!brand?.id) {
    ctx.error('Marketing prune: brand.id is missing — aborting to prevent account-global deletion');
    return;
  }

  if (marketing.campaigns?.enabled === false || !process.env.SENDGRID_API_KEY) {
    ctx.log('Marketing prune: SendGrid not configured, skipping');
    return;
  }

  const segmentIdMap = await sendgridProvider.resolveSegmentIds();
  const pruneSegmentId = segmentIdMap['engagement_inactive_6m'];

  if (!pruneSegmentId) {
    ctx.error('Marketing prune: engagement_inactive_6m segment not found in SendGrid');
    return;
  }

  // Brand-scope the prune segment
  const tempPrune = await sendgridProvider.createBrandScopedSegment(
    [pruneSegmentId],
    brand.id,
  );

  if (!tempPrune) {
    ctx.error('Marketing prune: Failed to create brand-scoped prune segment');
    return;
  }

  try {
    const exportResult = await sendgridProvider.getSegmentContacts(tempPrune.segmentId, 180000);

    if (!exportResult.success) {
      ctx.error('Marketing prune: Failed to export segment:', exportResult.error);
      return;
    }

    if (exportResult.contacts.length === 0) {
      ctx.log('Marketing prune: No contacts to prune');
      return;
    }

    // Exclude paying customers
    let contactsToPrune = exportResult.contacts;
    let skippedPaid = 0;

    const paidSegmentId = segmentIdMap['subscription_paid'];

    if (paidSegmentId) {
      const tempPaid = await sendgridProvider.createBrandScopedSegment(
        [paidSegmentId],
        brand.id,
      );

      if (tempPaid) {
        try {
          const paidExport = await sendgridProvider.getSegmentContacts(tempPaid.segmentId, 180000);

          if (paidExport.success && paidExport.contacts.length > 0) {
            const paidEmails = new Set(paidExport.contacts.map(c => c.email));
            contactsToPrune = contactsToPrune.filter(c => !paidEmails.has(c.email));
            skippedPaid = exportResult.contacts.length - contactsToPrune.length;
            ctx.log(`Marketing prune: Excluded ${skippedPaid} paying customers`);
          }
        } finally {
          await tempPaid.cleanup();
        }
      }
    }

    if (contactsToPrune.length === 0) {
      ctx.log('Marketing prune: No contacts to prune after paid exclusion');
      return;
    }

    const emails = contactsToPrune.map(c => c.email).filter(Boolean);

    ctx.log(`Marketing prune: Deleting ${contactsToPrune.length} contacts for ${brand.id}`);

    // Delete from SendGrid
    const ids = contactsToPrune.map(c => c.id).filter(Boolean);
    let totalDeleted = 0;

    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const deleteResult = await sendgridProvider.bulkDeleteContacts(batch);

      if (deleteResult.success) {
        totalDeleted += batch.length;
      } else {
        ctx.error('Marketing prune: Batch delete failed:', deleteResult.error);
      }
    }

    ctx.log(`Marketing prune: Deleted ${totalDeleted} SendGrid contacts for ${brand.id}`);

    await logPrunedEmails(admin, ctx, brand.id, '', { emails, skippedPaid });
  } finally {
    await tempPrune.cleanup();
  }
}

/**
 * Stage 3: Delete BEEHIIV subscribers inactive by BEEHIIV's own engagement.
 *
 * Beehiiv reports lifetime per-subscriber stats rather than a windowed
 * last-engaged date, so this lane reads what it has: a subscriber who has
 * received enough newsletters, has been on the list long enough, and has never
 * once opened or clicked is the Beehiiv-native shape of "gone".
 *
 * One publication belongs to one brand, so the listing is brand-scoped by
 * construction — no equivalent of stage 2's brand-scoped temp segment.
 * Paying customers are excluded exactly as stage 2 excludes them, removal
 * deletes the subscription (never unsubscribes it), and the deleted emails are
 * logged to Firestore for recoverability.
 */
async function stageNewsletterPrune(Manager, ctx, libraries) {
  ctx.log('Marketing prune: Stage 3 — Prune (Beehiiv)');

  const marketing = Manager.config?.marketing || {};
  const brand = Manager.config?.brand;
  const { admin } = libraries;

  if (!brand?.id) {
    ctx.error('Marketing prune: brand.id is missing — aborting to prevent account-global deletion');
    return;
  }

  if (marketing.newsletter?.enabled === false || !process.env.BEEHIIV_API_KEY) {
    ctx.log('Marketing prune: Beehiiv not configured, skipping');
    return;
  }

  const listing = await beehiivProvider.listSubscriptions({
    status: 'active',
    expand: ['stats'],
  });

  if (!listing.success) {
    ctx.error('Marketing prune: Failed to list Beehiiv subscriptions:', listing.error);
    return;
  }

  const now = Date.now();
  const candidates = listing.subscriptions.filter(subscription => isNewsletterInactive(subscription, now));

  if (candidates.length === 0) {
    ctx.log(`Marketing prune: No Beehiiv subscribers to prune (${listing.subscriptions.length} scanned)`);
    return;
  }

  const { targets, skippedPaid } = await excludePayingSubscribers(admin, ctx, candidates);

  if (targets.length === 0) {
    ctx.log('Marketing prune: No Beehiiv subscribers to prune after paid exclusion');
    return;
  }

  ctx.log(`Marketing prune: Deleting ${targets.length} Beehiiv subscribers for ${brand.id} (${listing.subscriptions.length} scanned)`);

  const emails = [];

  for (let i = 0; i < targets.length; i += NEWSLETTER_DELETE_CHUNK) {
    const batch = targets.slice(i, i + NEWSLETTER_DELETE_CHUNK);
    const results = await Promise.allSettled(
      batch.map(subscription => beehiivProvider.removeContact(subscription.email))
    );

    results.forEach((result, index) => {
      const email = batch[index].email;

      // `deleted`, not `success`: a subscriber who vanished between the listing
      // and the delete comes back { success: true, skipped: true }, and counting
      // that as a prune would inflate the recoverability log with emails this
      // run never removed.
      if (result.status === 'fulfilled' && result.value?.deleted) {
        emails.push(email);
      } else if (result.status === 'fulfilled' && result.value?.skipped) {
        ctx.log(`Marketing prune: Beehiiv subscriber already gone, skipping: ${email}`);
      } else {
        ctx.error(`Marketing prune: Beehiiv delete failed for ${email}:`, result.reason?.message || result.value?.error);
      }
    });
  }

  ctx.log(`Marketing prune: Deleted ${emails.length} Beehiiv subscribers for ${brand.id}`);

  await logPrunedEmails(admin, ctx, brand.id, '-newsletter', { emails, skippedPaid, provider: 'newsletter' });
}

/**
 * Split prune candidates into the ones to delete and the paying customers to
 * keep — stage 2's subscription_paid exclusion, done the only way Beehiiv
 * allows.
 *
 * Beehiiv has no view of app subscriptions (its own `subscription_tier` is the
 * paid-NEWSLETTER tier, a different thing), so paid-ness comes from Firestore:
 * the marketing library's canonical by-email user lookup, then the account
 * package's resolveSubscription. Its `active` IS the subscription_paid
 * segment's two conditions (plan not basic AND status active), so no second
 * definition of "paying" enters the codebase.
 *
 * No user doc means a pure newsletter contact with nothing to pay with, and a
 * failed lookup reads the same way — the same fail-open posture stage 2 takes
 * when its paid export comes back empty.
 *
 * @param {object} admin - firebase-admin instance
 * @param {object} ctx - Assistant (for logging)
 * @param {Array<object>} candidates - Subscriptions inactive by Beehiiv's stats
 * @returns {{ targets: Array<object>, skippedPaid: number }}
 */
async function excludePayingSubscribers(admin, ctx, candidates) {
  const targets = [];
  let skippedPaid = 0;

  for (let i = 0; i < candidates.length; i += NEWSLETTER_DELETE_CHUNK) {
    const batch = candidates.slice(i, i + NEWSLETTER_DELETE_CHUNK);
    const userDocs = await Promise.all(
      batch.map(subscription => Marketing.findUserByEmail(admin, ctx, subscription.email))
    );

    userDocs.forEach((userDoc, index) => {
      if (userDoc && User.resolveSubscription(userDoc).active) {
        skippedPaid++;
      } else {
        targets.push(batch[index]);
      }
    });
  }

  if (skippedPaid > 0) {
    ctx.log(`Marketing prune: Excluded ${skippedPaid} paying customers`);
  }

  return { targets, skippedPaid };
}

/**
 * Is this Beehiiv subscription prunable on BEEHIIV's own engagement?
 *
 * Beehiiv's `expand[]=stats` reports lifetime counters — emails_received plus
 * open_rate and click_through_rate as percentages — so "inactive" here means
 * never engaged at all, across a meaningful number of sends. That is stricter
 * than SendGrid's 180-day window: anyone who has EVER opened or clicked a
 * newsletter carries a non-zero rate forever and is safe from this lane.
 *
 * Stats the expand did not return leave the subscriber unjudgeable, and an
 * unjudgeable subscriber is never deleted — a destructive lane acts on data it
 * has, never on data it assumed.
 *
 * @param {object} subscription - A Beehiiv subscription with `stats` expanded
 * @param {number} now - Milliseconds since epoch
 * @returns {boolean}
 */
function isNewsletterInactive(subscription, now) {
  const stats = subscription?.stats;

  if (
    typeof stats?.emails_received !== 'number'
    || typeof stats?.open_rate !== 'number'
    || typeof stats?.click_through_rate !== 'number'
  ) {
    return false;
  }

  if (stats.emails_received < NEWSLETTER_RECEIVED_FLOOR) {
    return false;
  }

  // Beehiiv's `created` is unix SECONDS
  const createdAt = Number(subscription.created) * 1000;

  if (!createdAt || (now - createdAt) < (NEWSLETTER_MIN_AGE_DAYS * 24 * 60 * 60 * 1000)) {
    return false;
  }

  return stats.open_rate <= 0 && stats.click_through_rate <= 0;
}

/**
 * Log a lane's deleted emails to Firestore for recoverability.
 *
 * One doc per brand per month per lane (`suffix` keeps the two lanes from
 * overwriting each other). Non-fatal: a failed log must never abort a prune
 * that already deleted.
 *
 * @param {object} admin - firebase-admin instance
 * @param {object} ctx - Assistant (for logging)
 * @param {string} brandId
 * @param {string} suffix - Lane suffix on the run doc id ('' for SendGrid)
 * @param {object} payload - Extra fields to store alongside the emails
 */
async function logPrunedEmails(admin, ctx, brandId, suffix, payload) {
  try {
    const now = new Date();
    const logKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    await admin.firestore()
      .doc(`marketing-prune-logs/${brandId}/runs/${logKey}${suffix}`)
      .set({
        brandId,
        date: now.toISOString(),
        count: payload.emails.length,
        ...payload,
      });

    ctx.log(`Marketing prune: Logged ${payload.emails.length} pruned emails to Firestore (${logKey}${suffix})`);
  } catch (e) {
    ctx.error('Marketing prune: Failed to write Firestore log:', e.message);
  }
}

// Exposed as statics for plain-node unit tests (prune-per-provider.test.js) —
// the cron entry itself only acts on the 1st of the month.
module.exports.stagePrune = stagePrune;
module.exports.stageNewsletterPrune = stageNewsletterPrune;
module.exports.isNewsletterInactive = isNewsletterInactive;
module.exports.NEWSLETTER_RECEIVED_FLOOR = NEWSLETTER_RECEIVED_FLOOR;
module.exports.NEWSLETTER_MIN_AGE_DAYS = NEWSLETTER_MIN_AGE_DAYS;
