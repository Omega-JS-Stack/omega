# Payment System

This document covers the full payment system: pipeline architecture, subscription model + statuses, transition handlers, processor interface, product configuration, and the test processor.

## Pipeline

The payment system follows a linear pipeline: **Intent → Webhook → On-Write → Transition**.

1. **Intent** (`POST /payments/intent`): Client requests a payment session. @omega.js/backend validates the product, generates an order ID (`XXXX-XXXX-XXXX`), and delegates to the processor module (e.g., Stripe creates a Checkout Session). Saves to `payments-intents/{orderId}`.

2. **Webhook** (`POST /payments/webhook?processor=X&key=Y`): Processor sends event data. @omega.js/backend parses and categorizes the event (`subscription` or `one-time`), extracts the UID, and saves to `payments-webhooks/{eventId}` with `status: 'pending'`.

3. **On-Write** (Firestore trigger on `payments-webhooks/{eventId}`): Fetches the latest resource from the processor API (not stale webhook data), transforms it into a unified object, detects state transitions, dispatches handlers, tracks analytics, and writes to `users/{uid}.subscription` (subscriptions) and `payments-orders/{orderId}`.

4. **Transitions** (fire-and-forget): Handler files run asynchronously after detection. Failures never block webhook processing. Skipped during tests unless `TEST_EXTENDED_MODE` is set.

### The writes are one batch

The three writes an event produces — `users/{uid}.subscription` (subscriptions only), `payments-orders/{orderId}`, and `payments-intents/{orderId}` — land in **ONE Firestore batch**. As separate awaits, anything that threw between them left the state split: a user who paid with no order behind it, or an order whose intent still said `pending`. The batch makes it all-or-nothing. Transition dispatch and analytics stay **outside** the batch — they are fire-and-forget and must never gate the writes.

### A refund merges into the purchase

A refund **updates** a purchase record; it does not redefine it. A one-time refund's resource is the bare charge that moved the money back — it names no product and no price — so re-deriving the order from it degraded a completed purchase to `product: 'unknown'` at price 0 and replaced the checkout `resourceId` with the charge id. The pipeline merges instead:

- `unified.status` → `refunded`
- `unified.payment.refund` → `{ amount, currency, reason, date }` (from the processor library's `getRefundDetails()`)
- product, price, and the purchase's own `resourceId` stay exactly what the completed purchase wrote

## 3-Layer Architecture

The payment system is cleanly separated into three independent layers:

| Layer | Purpose | Tests |
|-------|---------|-------|
| **Processor input** (Stripe, PayPal, Test) | Parse raw webhooks + transform to unified shape | Helper tests per processor (`payment/stripe/to-unified-subscription.js`, `payment/paypal/to-unified-one-time.js`, etc.) |
| **Unified pipeline** (processor-agnostic) | Transition detection, Firestore writes, analytics | Journey tests (`journey-payments-*.js`) |
| **Transition handlers** (fire-and-forget) | Emails, notifications, side effects | Skipped during tests unless `TEST_EXTENDED_MODE` |

Each processor transforms its raw data into the **same unified shape**. Once data enters the pipeline, the code doesn't know or care which processor it came from. This means:
- Adding a new processor = implement the processor interface (below). The pipeline handles the rest.
- Journey tests use the `test` processor but exercise the full unified pipeline end-to-end.
- Processor-specific tests only need to verify correct transformation to the unified shape.

## Subscription Statuses

| Status | Meaning | User can delete account? |
|--------|---------|--------------------------|
| `active` | Subscription is current and valid (includes trialing) | No (unless `product.id === 'basic'`) |
| `suspended` | Payment failed (Stripe: `past_due`, `unpaid`) | No |
| `cancelled` | Subscription terminated (Stripe: `canceled`, `incomplete`, `incomplete_expired`) | Yes |

`suspended` is the dunning entry state for **both** failure shapes: a renewal that fails on a live subscription, and a FIRST checkout that declines. The two are told apart by the transition, not the status — `payment-failed` for the renewal, `checkout-declined` for the first checkout ([Subscription Transitions](#subscription-transitions)).

### Stripe Status Mapping

| Stripe Status | `subscription.status` | Notes |
|---|---|---|
| `active` | `active` | Normal active subscription |
| `trialing` | `active` | `trial.claimed = true` |
| `past_due` | `suspended` | Payment failed, retrying |
| `unpaid` | `suspended` | Payment failed |
| `canceled` | `cancelled` | Subscription terminated |
| `incomplete` | `cancelled` | Never completed initial payment |
| `incomplete_expired` | `cancelled` | Expired before completion |
| `active` + `cancel_at_period_end` | `active` | `cancellation.pending = true` |

## Unified Subscription Object (`users/{uid}.subscription`)

```javascript
subscription: {
  product: {
    id: 'basic',                   // product ID from config ('basic', 'premium', etc.)
    name: 'Basic',                 // display name from config
  },
  status: 'active',                // 'active' | 'suspended' | 'cancelled'
  expires: { timestamp, timestampUNIX },
  trial: {
    claimed: false,                // has user EVER used a trial
    expires: { timestamp, timestampUNIX },
    outcome: null,                 // 'converted' | 'lapsed' | null — stamped by the trial-lapse sweep, NOT by the unified transform
  },
  cancellation: {
    pending: false,                // true = cancel at period end
    date: { timestamp, timestampUNIX },
  },
  payment: {
    processor: null,               // 'stripe' | 'paypal' | etc.
    orderId: null,                 // @omega.js/backend order ID (e.g., '1234-5678-9012')
    resourceId: null,              // provider subscription ID (e.g., 'sub_xxx')
    frequency: null,               // 'monthly' | 'annually' | 'weekly' | 'daily'
    price: 0,                      // resolved from config (number, e.g., 4.99)
    startDate: { timestamp, timestampUNIX },
    updatedBy: {
      event: { name: null, id: null },
      date: { timestamp, timestampUNIX },
    },
  },
}
```

`trial.claimed` says only that a trial **happened** — a converted trial and a lapsed one carry identical dates — so `trial.outcome` is the one stored conversion signal. It is additive: the processor libraries never produce it (the unified transform's `trial` carries `claimed` + `expires` only, and the user-doc write is a merge), the trial-lapse sweep stamps it once the processor confirms which it was ([Payment Cron Jobs](#payment-cron-jobs)), and it is mirrored in the `@omega.js/account` user schema.

## Access Check Patterns

```javascript
// Is premium (paid)?
user.subscription.status === 'active' && user.subscription.product.id !== 'basic'

// Is on trial?
user.subscription.trial.claimed && user.subscription.status === 'active'

// Has pending cancellation?
user.subscription.cancellation.pending === true

// Payment failed?
user.subscription.status === 'suspended'
```

## resolveSubscription(account)

`User.resolveSubscription(account)` is a static method on the User helper that derives calculated subscription fields from raw account data. It returns only fields that require derivation logic — raw data (product.id, status, trial, cancellation) lives on the account object directly.

```javascript
const User = require('@omega.js/backend/dist/manager/helpers/user');

const resolved = User.resolveSubscription(account);
// Returns: { plan, active, trialing, cancelling }
```

| Field | Type | Description |
|-------|------|-------------|
| `plan` | `string` | Effective plan ID the user has access to RIGHT NOW (`'basic'` if cancelled/suspended) |
| `active` | `boolean` | User has active access (active, trialing, or cancelling) |
| `trialing` | `boolean` | In an active trial (status `'active'` + `trial.claimed` + unexpired `trial.expires`) |
| `cancelling` | `boolean` | Cancellation pending (status `'active'` + `cancellation.pending` + NOT trialing) |

Accepts either a raw Firestore account object or a resolved `User` instance (checks both `account.subscription` and `account.properties.subscription`).

**Unified with @omega.js/client**: The same function exists as `auth.resolveSubscription(account)` in @omega.js/client (`modules/auth.js`) with identical logic and return shape.

**Use this instead of manual access checks** — it centralizes all the derivation logic in one place:

```javascript
// ✅ PREFERRED — use resolveSubscription
const resolved = User.resolveSubscription(user);
if (resolved.active) { /* has access */ }

// ❌ AVOID — manual checks that duplicate logic
if (user.subscription.status === 'active' && user.subscription.product.id !== 'basic') { /* ... */ }
```

## Transition Handlers

When a webhook changes a subscription or processes a one-time payment, @omega.js/backend detects the state transition and dispatches to a handler file. Handlers are fire-and-forget (non-blocking) — they run after the transition is detected but before or during the Firestore writes. Handler failures never block webhook processing.

Handlers are skipped during tests unless `TEST_EXTENDED_MODE` is set.

### Transition Detection

The `transitions/index.js` module compares the **before** state (current `users/{uid}.subscription`) with the **after** state (new unified subscription) to detect what changed.

### Subscription Transitions

| Transition | Before → After | File | Email event |
|---|---|---|---|
| `payment-refunded` | detected from the event type, not the state diff | `transitions/subscription/payment-refunded.js` | `refunded` |
| `new-subscription` | basic/null → active paid | `transitions/subscription/new-subscription.js` | `confirmation` |
| `subscription-winback` | cancelled paid → active paid | `transitions/subscription/subscription-winback.js` | `confirmation` (delegates to `new-subscription.js`) |
| `checkout-declined` | basic/null → suspended | `transitions/subscription/checkout-declined.js` | none — log only |
| `payment-failed` | active → suspended | `transitions/subscription/payment-failed.js` | `payment-failed` |
| `payment-recovered` | suspended → active | `transitions/subscription/payment-recovered.js` | `payment-recovered` |
| `cancellation-requested` | pending=false → pending=true | `transitions/subscription/cancellation-requested.js` | `cancellation-requested` |
| `cancellation-removed` | pending=true → pending=false, same product, still active | `transitions/subscription/cancellation-removed.js` | none — log only |
| `subscription-cancelled` | non-cancelled → cancelled | `transitions/subscription/subscription-cancelled.js` | `cancelled` |
| `plan-changed` | active product A → active product B | `transitions/subscription/plan-changed.js` | `plan-changed` |

**Order is behavior.** `payment-refunded` is checked first, from the event type alone (a refund may not move the subscription's state at all). The other nine are an ordered ladder — most specific first — and the table lists them in that order. Two placements carry the weight:

- `subscription-winback` and `checkout-declined` sit **ahead of** `payment-failed`. Users are born active on `basic`, and a full cancellation leaves the paid product id in place, so without them a returning subscriber matched nothing (no confirmation email, and analytics read the checkout as a renewal) and a declined FIRST checkout read as active → suspended and sent renewal-dunning copy to someone who never had access to lose.
- `cancellation-removed` sits **behind** `payment-recovered` and requires the same product, so a recovery or a plan change that also clears the schedule keeps its own, more meaningful, name.

Two transitions are deliberately log-only:

- `checkout-declined` — the user is standing at the checkout watching the decline. No email, and no analytics either: no money moved.
- `cancellation-removed` — the `order` template has no copy for a withdrawn cancellation, and an unknown event falls back to the `confirmation` variant, which would show a subscriber a "total paid today" they were never charged. Sending the wrong email is worse than sending none, so it stays a record until the template carries the copy.

`subscription-winback` sends the customer the same order confirmation a first subscription does — same template, same computed totals — by calling `new-subscription.js` rather than keeping a second copy of it. Analytics fires a **purchase** (`reason: 'winback-purchase'`, non-recurring, at what the customer actually paid) instead of the renewal the payment event would otherwise have been read as.

All email-sending transition handlers send via `template: 'order'` + `data.order.event: '<event>'`. The single `order.js` template handles all 9 event types — no per-event template files. See [docs/email-system.md](email-system.md) for the full template system reference.

Note: Trials are NOT a separate transition. The `new-subscription` handler checks `after.trial.claimed` to determine if the subscription started with a trial.

### One-Time Transitions

| Transition | Event Type | File |
|---|---|---|
| `purchase-refunded` | `charge.refunded` (Stripe), `PAYMENT.SALE.REFUNDED` (PayPal), `payment_refunded` (Chargebee) | `transitions/one-time/purchase-refunded.js` |
| `purchase-completed` | `checkout.session.completed`, `CHECKOUT.ORDER.APPROVED` | `transitions/one-time/purchase-completed.js` |
| `purchase-failed` | `invoice.payment_failed` | `transitions/one-time/purchase-failed.js` |

`purchase-refunded` logs the structured amount/currency/reason (from the processor library's `getRefundDetails()`) and sends nothing — no email template for a refunded one-time purchase exists yet, the same stub shape `purchase-failed.js` uses. Its subscription twin (`subscription/payment-refunded.js`) does send.

**Idempotency:** EVERY transition on this side is detected from the event type alone, so the `previouslyCompleted` guard covers the whole one-time side — a webhook doc that already completed once (a redelivery, or a doc put back to `pending`) detects nothing, and the customer is not emailed twice about the same purchase or refund. The subscription side applies the same guard to its one event-type-only path, `payment-refunded`.

### Handler Interface

All handlers are in `src/manager/events/firestore/payments-webhooks/transitions/` and export a single async function:

```javascript
module.exports = async function ({ before, after, uid, userDoc, admin, ctx, Manager, eventType, eventId }) {
  // before: previous subscription state (null for new/one-time)
  // after: new unified state (subscription or one-time)
  // userDoc: full user document data
  // eventType: original webhook event type (e.g., 'customer.subscription.updated')
  // eventId: webhook event ID
};
```

### Creating a New Transition Handler

1. Add detection logic in `transitions/index.js` (in priority order)
2. Create handler file in `transitions/{category}/{name}.js`
3. Handler receives full context — use `ctx.log()` for logging, `Manager.getApiUrl()` for API calls

## Subscription Management Routes

Owned, cross-provider endpoints for managing a live subscription. Like `POST /payments/cancel`, they write **no subscription state** — they delegate to the processor and let the resulting webhook drive the pipeline.

### POST /payments/uncancel

Withdraws a scheduled cancellation, so the subscription renews as normal instead of ending at the close of the current billing period. Input: `confirmed`.

Guards: authenticated, `confirmed: true`, an ACTIVE paid subscription whose `cancellation.pending === true`, and a known processor.

Delegates to the processor — Stripe clears `cancel_at_period_end`, Chargebee calls `remove_scheduled_cancellation` — and the webhook that follows fires the `cancellation-removed` transition. The only thing the route writes is the withdrawal of the request itself: `payments-orders/{orderId}.requests.cancellation` is cleared, because leaving the reason/feedback behind would misreport the order's state.

**PayPal is not supported.** PayPal cannot resume a cancelled subscription — its only reactivation verb (`/v1/billing/subscriptions/{id}/activate`) works on a SUSPENDED subscription, and a cancelled one is terminal. PayPal also has no cancel-at-period-end: our cancel route cancels the PayPal subscription outright and the pipeline represents the remaining paid term as `cancellation.pending`, so a PayPal subscriber reading "pending cancellation" is already cancelled at PayPal.

### POST /payments/plan

Moves a live subscription to another product and/or billing frequency without cancel-and-resubscribe. Input: `productId`, `frequency`, `confirmed`.

Guards: authenticated, `confirmed: true`, an active paid subscription, and a target that is a subscription product the brand sells at that frequency and is not the plan the caller is already on.

| Processor | How it switches |
|---|---|
| **Stripe** | Updates the existing subscription ITEM with the new price, `proration_behavior: 'create_prorations'` (the item's id must be sent or Stripe adds a second item instead of replacing the first) |
| **Chargebee** | `update_for_items` with the deterministic `{itemId}-{frequency}` item price the checkout builds |
| **PayPal** | `revise` — PayPal's first-class plan change, prorated by its own rules |

The webhook that follows fires the existing `plan-changed` transition.

### Capability gating

Both routes are capability-gated the same way: **a processor module that supports the operation exports it; one that cannot lacks the export.** PayPal's `uncancel/processors/paypal.js` is deliberately empty for exactly this reason (the file still has to exist, or the route would answer "Unknown processor" — a different and wrong statement).

The route checks the export and refuses **before dispatch**, so the caller never discovers the limit as a provider error:

- HTTP **400**, with a sentence pointing at the billing portal
- `not-supported-by-processor` on the response's `omega-properties` header under `additional.code` — @omega.js/client surfaces it as `error.properties.additional.code`, so a client branches on the code, not the sentence

The billing portal (`POST /payments/portal`) stays the fallback for anything a processor will not do here.

## Refunds

`POST /payments/refund` has **two subjects, one endpoint** — which one is decided by whether `orderId` is present. Both store the reason/feedback on `payments-orders/{orderId}.requests.refund` in one shape, and both let the resulting webhook drive the pipeline.

| Input | Subject | Guards |
|---|---|---|
| No `orderId` | The caller's **subscription** — refunds the latest payment and cancels immediately | Authenticated, `confirmed`, a paid subscription, already cancelled or pending cancellation, inside the 6-month window |
| With `orderId` | A **one-time purchase**, named by its `payments-orders` doc | Authenticated, `confirmed`, the order is the caller's own, `type: 'one-time'`, not already refunded, inside the 6-month window |

Notes on the one-time branch:

- A one-time purchase writes nothing to `users/{uid}.subscription`, so the order IS the subject — there is no subscription state to check and nothing to cancel.
- A missing order and somebody else's order answer **identically** ("Order not found"): an order id must never be a probe for whether another user's purchase exists.
- "Already refunded" covers both paths — `requests.refund` (the in-app path) and `unified.status === 'refunded'` (a refund issued from the processor dashboard, which arrives by webhook and writes no request).
- One-time refunds are always **FULL**. All four processors implement `processOneTimeRefund` ([Processor Interface](#processor-interface)).

The refund window is 6 months on both subjects, measured from the subscription's `payment.startDate` or the order's created timestamp; an absent date cannot disqualify a refund.

What the pipeline then does with the refund webhook is in [A refund merges into the purchase](#a-refund-merges-into-the-purchase).

## Processor Interface

Each processor implements three modules:

**Intent processor** (`routes/payments/intent/processors/{processor}.js`):

```javascript
module.exports = {
  async createIntent({ uid, orderId, product, productId, frequency, trial, confirmationUrl, cancelUrl, Manager, ctx }) {
    return { id, url, raw };
  },
};
```

**Webhook processor** (`routes/payments/webhook/processors/{processor}.js`):

```javascript
module.exports = {
  isSupported(eventType) { return boolean; },
  parseWebhook(req) { return { eventId, eventType, category, resourceType, resourceId, raw, uid }; },
  // Optional — the processor's native signature, checked over the raw bytes
  verifySignature(req) { return { status: 'verified' | 'invalid' | 'unconfigured', reason }; },
};
```

**Cancel processor** (`routes/payments/cancel/processors/{processor}.js`):

```javascript
module.exports = {
  async cancelAtPeriodEnd({ resourceId, uid, subscription, ctx }) { /* cancel at end of period */ },
};
```

**Refund processor** (`routes/payments/refund/processors/{processor}.js`):

```javascript
module.exports = {
  async processRefund({ resourceId, uid, subscription, ctx }) {
    return { amount, currency, full };
  },
  // The ONE-TIME half. All four processors implement it, and a one-time refund is
  // always FULL: Stripe refunds the session's payment_intent, PayPal refunds the
  // completed capture, Chargebee refunds the invoice, test fabricates the webhook.
  async processOneTimeRefund({ resourceId, uid, order, ctx }) {
    return { amount, currency, full };
  },
};
```

**Uncancel processor** (`routes/payments/uncancel/processors/{processor}.js`) — optional; a missing export IS the capability declaration ([Capability gating](#capability-gating)):

```javascript
module.exports = {
  async uncancel({ resourceId, uid, subscription, ctx }) { /* clear the scheduled cancellation */ },
};
```

**Plan processor** (`routes/payments/plan/processors/{processor}.js`) — optional, same gate:

```javascript
module.exports = {
  async switchPlan({ resourceId, uid, subscription, product, productType, frequency, ctx }) { /* move the subscription */ },
};
```

**Portal processor** (`routes/payments/portal/processors/{processor}.js`):

```javascript
module.exports = {
  async createPortalSession({ resourceId, uid, returnUrl, ctx }) {
    return { url };
  },
};
```

**Shared library** (`libraries/payment/processors/{processor}.js`):

```javascript
module.exports = {
  init() { /* return SDK instance */ },
  async fetchResource(resourceType, resourceId, rawFallback, context) { /* return resource */ },
  extractResource(raw) { /* return the resource this processor's webhook envelope carries */ },
  getOrderId(resource) { /* return orderId string or null */ },
  toUnifiedSubscription(rawSubscription, options) { /* return unified object */ },
  toUnifiedOneTime(rawResource, options) { /* return unified object */ },
};
```

**Every library names its own envelope.** `extractResource(raw)` is how on-write builds the **stale fallback** — the payload `fetchResource()` degrades to when the processor API is unreachable. Each processor nests the resource somewhere else, so reading Stripe's shape for everyone degraded every other processor's fallback to nothing, and a Chargebee or PayPal API failure threw instead of falling back at all:

| Processor | Envelope |
|---|---|
| **Stripe** | `data.object` |
| **Chargebee** | `content.<type>` — `content.subscription` first, then `content.invoice` (the same precedence its webhook parser categorizes on) |
| **PayPal** | `resource` |
| **Test** | delegates to Stripe's (it generates Stripe-shaped payloads) |

Stripe's `fetchResource()` also handles `'charge'`, the resource a one-time refund arrives as. It expands the `payment_intent`, because a charge inherits its metadata from the PaymentIntent that created it — when the charge itself carries none, the intent is the only place `uid`/`orderId`/`productId` live. (The checkout sets them there for exactly this reason: `payment_intent_data.metadata`, not the session's.)

## Product Resolution

Products are resolved differently per processor, but always end up matching a product in `config.payment.products`:

| Processor | Resolution chain | Stable ID |
|-----------|-----------------|-----------|
| **Stripe** | `sub.items.data[0].price.product` or `raw.plan.product` → match `product.stripe.productId` or `legacyProductIds` | `prod_xxx` |
| **PayPal** | `sub → plan_id → plan → product_id` → match `product.paypal.productId` | PayPal catalog product ID |
| **Test** | Uses `product.stripe.productId` in Stripe-shaped data | Same as Stripe |

Falls back to `{ id: 'basic' }` if no match found.

## Processor-Specific Details

**Stripe:** Uses `metadata.uid` and `metadata.orderId` on subscriptions for UID/order resolution.

**PayPal:** Uses `custom_id` field on subscriptions with format `uid:{uid},orderId:{orderId}`. Product resolution fetches the plan from the subscription, then gets `product_id` from the plan. Plans are scoped by `product_id` query param to avoid cross-brand matches on shared PayPal accounts.

### Subscriptionless refunds are one-time

A refund with no subscription behind it is the refund of a **one-time purchase**, and all three webhook parsers now categorize it as `one-time` instead of dropping it (`category = null`, which meant such a refund never entered the pipeline at all):

| Processor | Event | Resource it resolves to |
|---|---|---|
| **Stripe** | `charge.refunded` with no subscription and no invoice | `charge` — the charge itself (`data.object.id`) |
| **PayPal** | `PAYMENT.SALE.REFUNDED` with no billing agreement | `sale` — the sale it reversed (`resource.sale_id` or `resource.id`) |
| **Chargebee** | `payment_refunded` with no subscription in `content` | `invoice` — the invoice it refunded |

PayPal has no `sale` branch in its library's `fetchResource()` yet, so a PayPal one-time refund rides the flagged **stale fallback** (the webhook's own `resource`) rather than a fresh API read — tracked as a follow-up ([#224](https://github.com/Omega-JS-Stack/omega/issues/224)).

## Product Configuration

Products are defined in `config/omega.json5` under `payment.products` (a shared top-level section):

```javascript
payment: {
  processors: {
    stripe: { publishableKey: 'pk_live_...' },
    paypal: { clientId: 'ARvf...' },
  },
  products: [
    {
      id: 'basic',           // Free tier (no prices, no processor keys)
      name: 'Basic',
      type: 'subscription',
      limits: { requests: 100 },
    },
    {
      id: 'premium',         // Paid subscription
      name: 'Premium',
      type: 'subscription',
      limits: { requests: 1000 },
      trial: { days: 14 },
      prices: { monthly: 4.99, annually: 49.99 },       // Flat numbers; also supports 'weekly' and 'daily'
      stripe: { productId: 'prod_xxx', legacyProductIds: ['prod_OLD'] },
      paypal: { productId: 'PROD-abc123' },
    },
    {
      id: 'credits-100',     // One-time purchase
      name: '100 Credits',
      type: 'one-time',
      prices: { once: 9.99 },
      stripe: { productId: 'prod_yyy' },
      paypal: { productId: null },
    },
  ],
}
```

Key rules:
- `prices` contains **flat numbers only** — no processor-specific IDs
- Processor IDs live at the product level: `stripe: { productId }`, `paypal: { productId }`
- `stripe.productId` is stable — never changes even when prices change
- `stripe.legacyProductIds` maps old pre-migration Stripe products to this product
- Price IDs (Stripe `price_xxx`, PayPal plan IDs) are **resolved at runtime** by matching amount + interval against active prices on the processor's product
- `basic` product has no `prices` and no processor keys — it's the free tier
- `archived: true` stops offering a product to new subscribers while keeping it resolvable for existing ones

## Firestore Collections

| Collection | Key | Purpose |
|---|---|---|
| `payments-intents/{orderId}` | Order ID | Intent metadata (processor, product, status) |
| `payments-webhooks/{eventId}` | Processor event ID | Webhook processing state + transition result |
| `payments-orders/{orderId}` | Order ID | Unified order data (single source of truth for orders) |
| `users/{uid}.subscription` | User UID | Current subscription state (subscriptions only) |

### payments-webhooks retry state

Two fields on the event doc carry the retry ladder:

| Field | Meaning |
|---|---|
| `retryCount` | How many times processing this event has failed. The on-write trigger increments it every time it marks the doc `failed`. |
| `deadLetter` | Terminal latch. `true` means the doc has burned its retries and will never be re-flipped. |

The webhook route answers the processor `200` the moment the event is stored, so a doc the trigger marked `failed` is never delivered again — a transient fault (a processor API blip, a lost Firestore write) would drop the payment silently. The frequent cron `events/cron/frequent/retry-failed-webhooks.js` closes that: it re-flips `failed` docs back to `pending` (which is exactly what the trigger picks up) under a ceiling of **5** attempts, then stamps `deadLetter: true` **once, loudly**, and leaves the doc alone — something permanent is wrong with it and it needs a human, not another pass.

Reprocessing is safe by construction: the trigger's staleness guard and its `previouslyCompleted` guard make a second pass a no-op rather than a second charge or a second email.

**The escape hatch is a redelivery.** The webhook route's claim transaction treats `failed` as the one reclaimable state, and its write replaces the doc — so a processor redelivering the event resets the ladder (`retryCount` and `deadLetter` both go), and the dead-lettered doc gets a fresh set of attempts. That is the documented way back for an event that was dead-lettered for a fixable reason ([#220](https://github.com/Omega-JS-Stack/omega/issues/220)).

## Payment Cron Jobs

| Job | Cadence | What it does |
|---|---|---|
| `cron/frequent/retry-failed-webhooks.js` | Frequent (10 min) | Re-flips failed webhook events to `pending` under the retry ceiling, then dead-letters ([above](#payments-webhooks-retry-state)) |
| `cron/daily/trial-lapse-sweep.js` | Daily | Confirms expired trials with the processor and lapses the abandoned ones |
| `cron/daily/expire-paypal-cancellations.js` | Daily | Closes out PayPal pending cancellations whose term has ended |

### Trial lapse sweep

A trial that ends without converting should leave the user on `basic`. The processors say so with a webhook — and when that webhook is missed or never fires, the user keeps a paid product they never paid for, with nothing to notice it: `trial.claimed` means "this subscription HAD a trial", never "it converted".

So the sweep **asks the processor**. It never infers a lapse from dates:

1. **Windowed candidate query** — trial claimed, subscription still `active`, and `trial.expires.timestampUNIX` between 30 days ago and 24 hours ago. The 24-hour grace exists because webhook lag at trial end is normal and PayPal's stored trial expiry is a computed estimate (PayPal fires no trial-end event); the 30-day floor keeps this a backstop for missed webhooks rather than a re-examination of every trial ever claimed.
2. **Skip** the ones already stamped, already on `basic`, or with no processor to ask.
3. **Fetch the live subscription** — with an empty fallback, deliberately: a stale webhook payload is exactly what this sweep must not act on, so a fetch that cannot answer waits for the next run instead of fabricating a cancellation. Only "no such subscription" counts as gone.
4. **Decide.** Processor says active → the trial `converted`: stamp `trial.outcome` and touch nothing else. Gone or cancelled → the trial `lapsed`: the same end state the cancel route writes (status `cancelled`, back on `basic`, nothing pending) plus the stamp. Anything else (a suspended subscription still in dunning) → neither outcome is true yet, nothing is stamped, and the next run asks again.
5. **Re-read before writing**, so a webhook that landed since the query is never clobbered.

No email is sent from here — the sweep is state correction.

The candidate query needs a composite index on `users`, registered in `src/cli/commands/setup-tests/helpers/required-indexes.js` (the SSOT for required indexes).

### PayPal cancellation expiry

PayPal has no cancel-at-period-end, so a cancelled PayPal subscription serves out its paid term as `cancellation.pending` and this cron closes it once `expires` passes. It writes the user's subscription **and** the order doc's `unified` mirror — the mirror is what handlers and the UI read, and leaving it behind meant an expiry produced a stale order. Both land in one batch, as the delta this cron owns (never a whole map read from a snapshot, which would restore every other field to its read-time value).

It takes the pipeline's staleness discipline too: each candidate is re-read at its turn, and anything a webhook has since written — a newer `payment.updatedBy` stamp on the subscription, a newer `metadata.updated` on the order, a status that is no longer a pending cancellation — makes the cron stand down rather than overwrite the newer truth.

## Webhook Verification

Two layers gate `POST /payments/webhook`:

1. **The shared key** — `?key=<OMEGA_WEBHOOK_KEY>`, compared in constant time. Every processor rides it, and a mismatch is a 401 before anything else runs.
2. **The processor's native signature** — a webhook processor may export `verifySignature(req)`, which the route runs before the payload is parsed or stored.

| Processor | Native verification | Secret |
|---|---|---|
| `stripe` | The `stripe-signature` header checked against the raw bytes (`constructEvent`, which also enforces Stripe's timestamp tolerance, so a captured event cannot be replayed) | `STRIPE_WEBHOOK_SECRET` |
| `paypal` | None yet — PayPal's scheme needs the endpoint's webhook ID, and nothing carries it into the backend | — |
| `chargebee` | None — Chargebee does not sign payloads; credentials on the webhook URL are its mechanism, which the shared key already is | — |
| `test` | None by design — its events are fabricated locally, and the route answers 403 in production | — |

The dispute-alert route runs the same layer: its Chargeblast processor verifies the Svix headers (`svix-id`/`svix-timestamp`/`svix-signature`, HMAC over the raw bytes, 5-minute replay tolerance) when its secret is set.

| Processor | Native verification | Secret |
|---|---|---|
| `chargeblast` (dispute-alert) | Svix signature over the raw bytes | `CHARGEBLAST_WEBHOOK_SECRET` |

The fail mode is per processor, per configuration:

- **Secret configured** → strict. A missing signature, a payload the signature does not cover, or a request that arrived without its raw bytes (only delivered bytes can be verified — re-serializing the parsed body would check a guess) is a 401, logged with the reason.
- **Secret not configured** → the key-only path, with one warn per processor per instance naming the variable to set.

Verification never needs the processor's API key: `STRIPE_WEBHOOK_SECRET` is the endpoint's signing secret from the Stripe Dashboard, or the one `stripe listen --print-secret` prints for a locally forwarded run ([stripe-webhook-forwarding.md](stripe-webhook-forwarding.md)).

## Test Processor

The `test` processor generates Stripe-shaped data and auto-fires webhooks to the local server. Only available in non-production environments. Use `processor: 'test'` in intent requests during testing. The test webhook processor delegates to Stripe's parser since it generates Stripe-shaped payloads.

Both doors enforce that: the intent side throws inside `intent/processors/test.js`, and `POST /payments/webhook?processor=test` answers 403 in production (the webhook processors receive only the raw request, so the route's dispatch layer carries the guard). Real processors are unaffected — a provider dashboard points at `POST /omega/payments/webhook?processor=<processor>&key=<OMEGA_WEBHOOK_KEY>`, where the shared key is the outer layer and the processor's own signature is the boundary ([Webhook Verification](#webhook-verification)).

### Simulating a declined checkout

`POST /payments/intent` takes a `simulate` field — allow-listed to `'decline'` by the schema, honored **only** by the test processor (itself non-production), inert on real processors, and **never persisted** onto the intent or the order. It is how the dunning journey (decline → suspended → recovery) is proven end-to-end.

A decline mirrors what a real processor does, per product type:

| Product type | What the test processor fabricates |
|---|---|
| **subscription** | The subscription is born `past_due` (→ `suspended`) with no trial claimed, then a sequenced `invoice.payment_failed` with `billing_reason: 'subscription_create'`. The two events go out **in order** — the failed invoice names the subscription, and the pipeline resolves it from the order the first event wrote. |
| **one-time** | The session is still created; the payment is what fails, so a failed `manual` invoice (`invoice.payment_failed`) goes out in place of the completed session. |

A decline's `payments-intents` doc still ends `completed`. The intent status means "the pipeline processed this", not "the customer paid" — the payment outcome lives on the order and the subscription.
