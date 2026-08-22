# Suspended Subscription Dead Zone

## Issue

A user with a `suspended` subscription was trapped in a loop:
- **Trying to subscribe** → "You already have a subscription. Please cancel your existing subscription before purchasing a new one." (400)
- **Trying to cancel** → "No active paid subscription found" (400)

No way out.

## Affected User

- **UID:** `t9AeAe7QUhNXAUYRV1vUbOU0QVV2`
- **Brand:** Somiibo

The user had two stale subscriptions from different providers:

| Field | Provider | Status | Resource ID | Last Webhook |
|---|---|---|---|---|
| `subscription` | PayPal | `suspended` | `I-Y41DMAGNWGP1` | `BILLING.SUBSCRIPTION.SUSPENDED` (2026-04-19) |
| `plan` (legacy) | Chargebee | `suspended` | `169xhEU1pYXAt3dsj` | `subscription-profile-fixer` (2024-02-28) |

PayPal suspended the subscription (likely failed payment) but never sent a `BILLING.SUBSCRIPTION.CANCELLED` webhook. PayPal doesn't auto-cancel suspended subscriptions — it leaves them in limbo until the user resolves payment or manually cancels in PayPal. The local status stayed `suspended` forever.

## Root Cause

Asymmetric status gates between the intent and cancel endpoints:

### Intent gate (`POST /payments/intent`)
```js
// Blocked if product is NOT basic AND status is NOT cancelled
if (subProductId !== 'basic' && subStatus !== 'cancelled') { ... }
```
- `active` → blocked (correct)
- `suspended` → blocked (correct — user should cancel first)
- `cancelled` → allowed (correct)

### Cancel gate (`POST /payments/cancel`)
```js
// Blocked if status is NOT active
if (subscription.status !== 'active') { ... }
```
- `active` → allowed (correct)
- `suspended` → **blocked** (the bug)
- `cancelled` → blocked (correct — nothing to cancel)

The intent gate treats `suspended` as "has a subscription" (must cancel first), but the cancel gate treats `suspended` as "no subscription to cancel." Dead zone.

## The Fix

### 1. Cancel gate now accepts `suspended`

```js
// Before
if (!subscription || subscription.status !== 'active' || ...)

// After
if (!subscription || (subscription.status !== 'active' && subscription.status !== 'suspended') || ...)
```

### 2. Fallback for dead provider subscriptions

When cancelling a `suspended` subscription, the provider API call might fail — the subscription could be expired/deleted on the provider's side while our local state is stale. The cancel endpoint now catches provider errors for suspended subscriptions and directly resets the user doc:

```js
if (subscription.status === 'suspended') {
  // Provider rejected — subscription is already dead on their end
  // Directly reset the user doc to cancelled
  await admin.firestore().doc(`users/${uid}`).set({
    subscription: {
      status: 'cancelled',
      product: { id: 'basic', name: 'Basic' },
      cancellation: { pending: false, date: { timestamp, timestampUNIX } },
    },
  }, { merge: true });
}
```

### 3. New test coverage

- Test account `cancel-suspended` with `status: 'suspended'` and test provider payment details
- Test `allows-suspended-subscription` verifying the cancel endpoint accepts and processes suspended subscriptions

## Status Matrix (after fix)

| Status | Can subscribe? | Can cancel? | Can delete account? |
|---|---|---|---|
| `active` (basic) | Yes | No (nothing to cancel) | Yes |
| `active` (paid) | No (cancel first) | Yes | No |
| `suspended` | No (cancel first) | **Yes** (fixed) | No |
| `cancelled` | Yes | No (already cancelled) | Yes |

## Files Changed

- `src/manager/routes/payments/cancel/post.js` — gate + fallback
- `src/test/test-accounts.js` — `cancel-suspended` account
- `test/routes/payments/cancel.js` — `allows-suspended-subscription` test
