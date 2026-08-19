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

### A refund with no purchase behind it is refused, not minted

A refund can only UPDATE a purchase — it can never DEFINE one. When the refund event named an order that did not exist, the merge above could not run and the event was read as a fresh purchase definition instead: `payments-orders/{orderId}` was created with `unified.status: 'completed'` and the REFUND's id as the resource, so a reversal was booked as revenue while the transition trail said `one-time/purchase-refunded`. Reachable whenever the purchase write is missing — a lost or failed purchase webhook, a webhook registered after the sale, or PayPal delivering `PAYMENT.CAPTURE.REFUNDED` before the capture.

So the pipeline **refuses**, and writes nothing to `payments-orders` or `payments-intents`: no transition is detected, no analytics fire, and the webhook doc completes with `transition: null` — the trail agrees with the record. The refusal is stamped on the event's OWN doc, alongside that transition: `payments-webhooks/{eventId}.refusal` = `{ reason: 'refund-without-order', captureId }`, with a loud `REFUND WITHOUT ORDER` error line carrying the money from `getRefundDetails()`. The doc already holds the refund payload as delivered (`raw`), the owner and the order the refund named; what it adds is the id of the capture the refund reversed — read off the payload's HATEOAS `up` link, which PayPal points at the capture and other processors omit (`null`, never a guess). That capture id is the pointer a human reconciles the missing purchase from ([#335](https://github.com/Omega-JS-Stack/omega/issues/335)).

The webhook is **completed**, not failed: the event reached a terminal decision, so it must not burn the retry ladder or dead-letter. The event doc is keyed by the processor's event id, so a redelivery re-decides the same document rather than piling up duplicates — and `refusal` is written on every completion (`null` when nothing was refused), so a reprocess that now finds its order clears the flag instead of leaving a stale one behind.

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
| `checkout-declined` | cancelled paid → suspended (a win-back that declines) | `transitions/subscription/checkout-declined.js` | none — log only |
| `payment-failed` | active → suspended | `transitions/subscription/payment-failed.js` | `payment-failed` |
| `payment-recovered` | suspended → active | `transitions/subscription/payment-recovered.js` | `payment-recovered` |
| `cancellation-requested` | pending=false → pending=true | `transitions/subscription/cancellation-requested.js` | `cancellation-requested` |
| `cancellation-removed` | pending=true → pending=false, same product, still active | `transitions/subscription/cancellation-removed.js` | none — log only |
| `subscription-cancelled` | non-cancelled → cancelled | `transitions/subscription/subscription-cancelled.js` | `cancelled` |
| `plan-changed` | active product A → active product B | `transitions/subscription/plan-changed.js` | `plan-changed` |

**Order is behavior.** `payment-refunded` is checked first, from the event type alone (a refund may not move the subscription's state at all). The rest are an ordered ladder — most specific first — and the table lists them in that order (`checkout-declined` is reached by two rules, hence two rows). Two placements carry the weight:

- `subscription-winback` and both `checkout-declined` rules sit **ahead of** `payment-failed`. Users are born active on `basic`, and a full cancellation leaves the paid product id in place, so without them a returning subscriber matched nothing (no confirmation email, and analytics read the checkout as a renewal) and a declined FIRST checkout read as active → suspended and sent renewal-dunning copy to someone who never had access to lose. The cancelled-paid → suspended rule closes the last branch of that pair: a win-back whose payment declines used to match no rule at all, so the webhook completed with no transition, no log and no analytics ([#223](https://github.com/Omega-JS-Stack/omega/issues/223)).
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

Owned, cross-provider endpoints for managing a live subscription. They write **no subscription state** — they delegate to the processor and let the resulting webhook drive the pipeline.

### POST /payments/cancel

Ends the caller's subscription: at the close of the current billing period normally, **immediately when the subscription is still in its free trial** (Ian's ruling, 2026-08-15 — we do not keep serving a trial we know will not convert). Input: `reason`, `feedback`, `confirmed`, and the privileged `skipGuards`.

Guards: authenticated, `confirmed: true`, an active or suspended paid subscription, no cancellation already pending, a known processor and resource id, and the **24-hour young-subscription guard**. `skipGuards` is honored only for an admin or outside a real deployment (the suites and the dev palette cancel seeded subscriptions minutes old); every other caller is ignored, loudly.

**A trial is exempt from the 24-hour guard.** That guard exists to stop a cancellation racing a PAID checkout that is still settling, and a trial has no payment to settle — blocking it told the most common trial behavior there is, cancelling the same day you started, that the subscription "is still being set up" ([#267](https://github.com/Omega-JS-Stack/omega/issues/267)).

**"Still inside the trial" has ONE definition**, `routes/payments/cancel/_is-trialing.js` — the trial is claimed, the subscription is `active`, and `expires` still equals `trial.expires` (conversion moves `expires` out to the end of the first paid period while `trial.expires` stays put, so the two stop matching the moment real money is involved; an expiry missing on both sides reads false, because a guard must never be waived by absent data). The route and all four cancel processors consult that one function, which is what keeps the guard waiver and the cancel mode from disagreeing — they were three per-processor copies of the same comparison before.

How each processor performs the immediate half:

| Processor | Trial cancel | Paid cancel |
|---|---|---|
| **Stripe** | `subscriptions.cancel()` — the subscription ends now | `subscriptions.update({ cancel_at_period_end: true })` |
| **Chargebee** | `cancel_for_items` with `cancel_option: 'immediately'` | the same call with `end_of_term` |
| **PayPal** | the one cancel endpoint, with a trial `reason` — immediacy is enforced on OUR side (below) | the same endpoint; the remaining paid term rides as `cancellation.pending` |
| **test** | fabricates `customer.subscription.deleted` | fabricates `customer.subscription.updated` with `cancel_at_period_end` |

**PayPal has no second cancel mode**, so the immediacy lives in the unified transform: `calculatePeriodEnd()` returns null for a subscription still inside its trial WINDOW (the trial end computed from `start_time` + the plan's `TRIAL` cycle is still ahead), so the cancellation webhook resolves it to `cancelled` with nothing pending and no future expiry. Reading the payment record instead handed a cancelled trialer a full paid period whenever the plan charged a setup fee on day zero — `billing_info.last_payment` exists during a trial, and it is not a billing period.

### POST /payments/uncancel

Withdraws a scheduled cancellation, so the subscription renews as normal instead of ending at the close of the current billing period. Input: `confirmed`.

Guards: authenticated, `confirmed: true`, an ACTIVE paid subscription whose `cancellation.pending === true`, and a known processor.

Delegates to the processor — Stripe clears `cancel_at_period_end`, Chargebee calls `remove_scheduled_cancellation` — and the webhook that follows fires the `cancellation-removed` transition. The only thing the route writes is the withdrawal of the request itself: `payments-orders/{orderId}.requests.cancellation` is cleared, because leaving the reason/feedback behind would misreport the order's state.

**PayPal is not supported.** PayPal cannot resume a cancelled subscription — its only reactivation verb (`/v1/billing/subscriptions/{id}/activate`) works on a SUSPENDED subscription, and a cancelled one is terminal. PayPal also has no cancel-at-period-end: our cancel route cancels the PayPal subscription outright and the pipeline represents the remaining paid term as `cancellation.pending`, so a PayPal subscriber reading "pending cancellation" is already cancelled at PayPal.

### POST /payments/plan

Moves a live subscription to another product and/or billing frequency without cancel-and-resubscribe. Input: `productId`, `frequency`, `confirmed`.

Guards: authenticated, `confirmed: true`, an active paid subscription with no cancellation scheduled, and a target that is a subscription product the brand sells at that frequency and is not the plan the caller is already on.

Two of those refusals carry a **machine-readable code** on the `omega-properties` header's `additional.code`, the same shape the [capability gate](#capability-gating) ships under — the client branches on the code, never on the sentence:

| Code | When | Why it is a refusal |
|---|---|---|
| `already-on-plan` | Same product AND same frequency — **or** the same product when `payment.frequency` is unrecorded | A no-op costs a real processor call and a real webhook. Same product at a DIFFERENT *recorded* frequency is a real switch and stays allowed; with nothing recorded to compare, `'monthly' === undefined` is false and the no-op would sail through, so every cadence of the current product is refused until the backend records one. |
| `cancellation-pending` | `cancellation.pending === true` | The processors swap the PRICE, never the schedule — a switch here would land the caller on a new plan still set to end at period end, silently. Undo the cancellation first. |

**The guards never lean on the client's filtering.** The billing page hides Change while a cancellation is pending and renders the current plan disabled, but that is courtesy: the modal's own filter silently missed whenever `payment.frequency` was unrecorded, which is how a same-plan switch reached the processor in the first place ([#237](https://github.com/Omega-JS-Stack/omega/issues/237)).

**A switch never grants, resets, or extends a trial** (Ian 2026-08-14). A mid-trial switch CARRIES the trial over — same original end date, new plan — and `trial.claimed` stays claimed. The route writes no state, so each processor's `switchPlan()` preserves it through the swap — and each one restates the date from the **live provider object**, never from our own user doc, which can lag the provider and would make the preserving route the thing that MOVED the trial: Stripe restates `trial_end` off the subscription it already retrieved to find the item, and Chargebee GETs `/subscriptions/{id}` and restates that object's `trial_end` when its status is `in_trial`. A trial already over is left alone in both (Stripe rejects a past `trial_end`, and its dates stay on the object anyway). The test processor carries `trial_start`/`trial_end` onto the event it fabricates — and, while the trial is live, sets the current period TO the trial period, the way Stripe reports a trialing subscription: the cancel flow's shared classifier ([`_is-trialing.js`](#post-paymentscancel), read by the route and every processor) decides a cancellation is immediate on that `trial.expires === expires` equality, so a fabricated 30-day period would have broken trial-cancel immediacy after a switch. Fabricating the trial dates as null is exactly what ended a live trial on switch: the unified transform reads `trial.claimed` straight off the event. PayPal's `revise` takes no trial parameter — its trial is derived from the plan's `TRIAL` billing cycle anchored to the original `start_time`, so a revise cannot extend a trial past what it would have been from day one, but an unequal trial LENGTH on the target plan can still shift the end date.

| Processor | How it switches |
|---|---|
| **Stripe** | Updates the existing subscription ITEM with the new price, `proration_behavior: 'create_prorations'` (the item's id must be sent or Stripe adds a second item instead of replacing the first) |
| **Chargebee** | `update_for_items` with the deterministic `{itemId}-{frequency}` item price the checkout builds |
| **PayPal** | `revise` — PayPal's first-class plan change, prorated by its own rules |

The webhook that follows fires the existing `plan-changed` transition.

### POST /payments/winback

Applies the cancel-flow **save offer** to a live subscription, so the cancel the customer started never happens ([#268](https://github.com/Omega-JS-Stack/omega/issues/268)). The billing card pitches it before the cancellation questionnaire; accepting calls this route, declining opens the questionnaire unchanged. Input: `confirmed`.

The offer is the **brand's**, not this route's: `payment.winback` in omega.json5, resolved by `@omega.js/config`'s `resolveWinbackOffer()` — 50% off the next cycle when a brand configures nothing, `enabled: false` to turn it off entirely ([docs/shared/config.md](../../../docs/shared/config.md#the-cancel-flow-save-offer-paymentwinback--268)). The web build resolves the same section through the same function into its client blob, so the dialog and the coupon can never name different numbers.

Guards: authenticated, `confirmed: true`, the offer enabled for this brand, an ACTIVE paid subscription that is **not** inside its free trial (`_is-trialing.js` — a trial cancel is immediate and nothing has been paid, so there is no next cycle to discount) and has no cancellation scheduled, a known processor, and **an order doc carrying no claim yet**.

The offer reaches the processor as a discount-codes `validate()` result (`libraries/payment/winback.js`), so the coupon plumbing is the checkout's: Stripe's `StripeLib.resolveCoupon()` builds the same deterministic, reused coupon a discount code does, and `subscriptions.update({ discounts: [...] })` attaches it. Stripe's `discounts` parameter **replaces** every discount already on the subscription rather than adding to them, so an existing coupon is dropped when the offer's lands. The subscription itself is untouched — same plan, same cadence, same renewal date — and the route writes no subscription state.

**Claimed once.** `payments-orders/{orderId}.requests.winback` records the discount and when it was taken, and a second call is refused against that same document — an offer takeable every time the cancel dialog opens is a permanent discount nobody agreed to. That refusal carries `offer-already-claimed` on `omega-properties` (`additional.code`), because the client reads the ACCOUNT and the claim lives on the order doc, so a past claimant is pitched the offer again and the billing card needs a code to retire it on ([#310](https://github.com/Omega-JS-Stack/omega/issues/310)). A subscription carrying no `payment.orderId` has nowhere to record the claim, so it is refused before dispatch with `offer-not-claimable` on `omega-properties` (`additional.code`) instead of being handed an offer this route cannot remember. The accept is also recorded server-side (`ctx.analytics.event('payments/winback', …)`), which is what the experiment is measured with against the existing `subscription-winback` transition baseline; the client counts offer-shown and offer-declined, which never reach a server.

**Every refusal is named.** Each 400 this route returns carries a machine-readable code on `omega-properties` (`additional.code`), in refusal order: `confirmation-required`, `offer-disabled`, `no-active-subscription`, `trial-not-eligible`, `cancellation-pending`, `missing-payment-details`, `unknown-processor`, `not-supported-by-processor`, `offer-not-claimable`, `offer-already-claimed` ([#311](https://github.com/Omega-JS-Stack/omega/issues/311)). The client pitches the offer off the ACCOUNT alone, so a state it cannot see reaches accept — and a refusal it cannot name leaves the customer in a dialog arming a retry that can never succeed. All but `confirmation-required` are dead ends for that account (the billing card's `deadEndCodes`): it retires the offer and opens the questionnaire on them, while an unconfirmed request — which the same button sending it again fixes — leaves the offer armed. The card also gates the PITCH on `subscription.payment.processor` and `payment.resourceId`, so an admin-granted or imported subscription with no processor details is never offered a discount the route could only refuse.

**Only Stripe and the test processor apply it.** PayPal has no coupon or discount object at all, and Chargebee has coupons but no existing plumbing that reaches a LIVE subscription with one (`update_for_items` REPLACES the subscription's items, so carrying a coupon through it would mean restating the live item set on every offer — a re-pricing risk taken for a discount). Both declare that by exporting nothing, and the billing card retires the offer for the session and opens the questionnaire on the refusal, so a subscriber on either can always still cancel.

### Capability gating

All three routes are capability-gated the same way: **a processor module that supports the operation exports it; one that cannot lacks the export.** PayPal's `uncancel/processors/paypal.js` and both `winback/processors/{paypal,chargebee}.js` are deliberately empty for exactly this reason (the file still has to exist, or the route would answer "Unknown processor" — a different and wrong statement).

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

**Winback processor** (`routes/payments/winback/processors/{processor}.js`) — optional, same gate; `discount` is a discount-codes `validate()` result built from the brand's `payment.winback`:

```javascript
module.exports = {
  async applyOffer({ resourceId, uid, subscription, discount, ctx }) { /* discount the next cycle */ },
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

PayPal's `fetchResource()` handles `'sale'` the same way, and it is a two-step read: it GETs the v1 sale (`/v1/payments/sale/{id}`) the refund reversed, and a v1 sale carries **no `custom_id`** — so when the sale names a `parent_payment`, that payment is fetched too and its transaction's `custom` (or `custom_id`) is folded onto the sale, which is the only place `uid`/`orderId`/`productId` live. The fold is best-effort, the way the subscription case's plan fetch is: an unreadable parent payment still returns the LIVE sale rather than demoting the event to the stale payload. Before this branch existed, every PayPal one-time refund threw "Unknown resource type" and rode the flagged **stale fallback**, logging a processor-unreachable error for a fetch that was never attempted ([#224](https://github.com/Omega-JS-Stack/omega/issues/224)).

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
| `payments-webhooks/{eventId}` | Processor event ID | Webhook processing state + transition result + `refusal`, the flag on an event the pipeline REFUSED to act on ([above](#a-refund-with-no-purchase-behind-it-is-refused-not-minted)) |
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

Its candidate query (`subscription.payment.processor` + `subscription.cancellation.pending`) needs a composite index on `users`, registered in the same SSOT — it shipped without one, so the cron worked only in brands where the index had been hand-created ([#225](https://github.com/Omega-JS-Stack/omega/issues/225)).

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

### Discounts and the first charge

`discountCodes.applyToAmount(amount, discount)` is the one home of the **discounted-charge** computation — `percent` maps to Stripe's `percent_off`, `amount` to its `amount_off` (dollars here, cents there) — and every place that needs "what is the customer charged today" calls it: the intent route's confirmation URL, the test processor's fabricated payloads, the analytics value resolver, and the `new-subscription` / `purchase-completed` email totals. (Promo *savings* — the amount taken off, not the amount charged — is a different quantity and stays inline at its two email sites.)

Only the FIRST charge moves. Every code is `duration: 'once'`, so `users/{uid}.subscription.payment.price` keeps the full renewal price from config; the discount itself is recorded on the order (`order.discount`), which is what analytics reads.

**The confirmation URL's `amount` is the ROUTE's job, not a processor's** ([#239](https://github.com/Omega-JS-Stack/omega/issues/239)). `buildConfirmationUrl()` in `routes/payments/intent/post.js` applies the validated discount, so the number is right on every processor. That placement is load-bearing: a real processor applies its coupon on its own hosted page and never revisits this URL, so doing the math processor-side left a discounted Stripe checkout landing on the confirmation page quoting the LIST price — and the client's tracking modules read that param straight into GA4/pixel revenue. A trial quotes `$0` and a coupon takes its cut off nothing.

The test processor's remaining share is the **payload it fabricates**, carrying the coupon the way Stripe reports it: a Stripe-shaped `discount` on the subscription, `amount_total` + `total_details.amount_discount` on a one-time session, and the discounted `amount_due` on a declined checkout's failed first invoice.

**Both coupon shapes reach the real processors.** A code in `discount-codes.js` carries either `percent` or `amount` (flat dollars), and each processor builds its provider's own form: Stripe gets `percent_off`, or `amount_off` in CENTS with the `currency` beside it (Stripe rejects an amount coupon without one); Chargebee gets `discount_type: 'percentage'` + `discount_percentage`, or `'fixed_amount'` + `discount_amount` in the currency's minor unit + `currency_code`. Currency is `payment.currency` (default `USD`). The deterministic coupon id differs per shape (`BEM_{CODE}_{n}OFF_ONCE` vs `BEM_{CODE}_{n}AMTOFF_ONCE`) so one code can never collide with the other form, and the percent id is unchanged, so coupons already live in a brand's provider account keep resolving. Both builders are proven on the params they ask the provider to create; live-provider verification is a Stage 3 item ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).

**A `validate()` result OMITS the shape a code does not have** — it never carries `amount: undefined` — because the result is not just read, it is WRITTEN: `POST /payments/intent` persists it as `payments-intents/{orderId}.discount`, and firebase-admin refuses a document containing an undefined value, throwing synchronously *after* the processor has already created the real checkout session. Readers branch with `discountCodes.promoShape(discount)` → `'percent' | 'amount' | null`. The `null` arm is not defensive padding: a discount read back off an order written before the amount field existed is `valid` with neither shape, and the confirmation-email transitions are dispatched fire-and-forget, so reading a missing shape there costs the customer their receipt silently.

The order email quotes the shape it was given: `promoPercent` renders "15% off", `promoAmount` renders "$10.00 off", `promoSavings` is what the code actually took off (floored at the charge — a $10 code against a $4.99 charge saves $4.99, not $10), and a shapeless discount renders no promo line at all while the totals stand at full price.

### Simulating a declined checkout

`POST /payments/intent` takes a `simulate` field — allow-listed to `'decline'` by the schema, honored **only** by the test processor (itself non-production), inert on real processors, and **never persisted** onto the intent or the order. It is how the dunning journey (decline → suspended → recovery) is proven end-to-end.

A decline mirrors what a real processor does, per product type:

| Product type | What the test processor fabricates |
|---|---|
| **subscription** | The subscription is born `past_due` (→ `suspended`) with no trial claimed, then a sequenced `invoice.payment_failed` with `billing_reason: 'subscription_create'`. The two events go out **in order** — the failed invoice names the subscription, and the pipeline resolves it from the order the first event wrote. |
| **one-time** | The session is still created; the payment is what fails, so a failed `manual` invoice (`invoice.payment_failed`) goes out in place of the completed session. |

A decline's `payments-intents` doc still ends `completed`. The intent status means "the pipeline processed this", not "the customer paid" — the payment outcome lives on the order and the subscription.
