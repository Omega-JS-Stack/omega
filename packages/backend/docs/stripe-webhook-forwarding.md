# Stripe Webhook Forwarding

@omega.js/backend auto-starts Stripe CLI webhook forwarding when running `npx omega serve` or `npx omega emulator`. This forwards Stripe test webhooks to the local server so the full payment pipeline works end-to-end during development.

**Requirements:**
- `STRIPE_SECRET_KEY` set in `functions/.env`
- `OMEGA_WEBHOOK_KEY` set in `functions/.env` (`OMEGA_ADMIN_KEY` also accepted as a legacy fallback)
- [Stripe CLI](https://stripe.com/docs/stripe-cli) installed

**Standalone usage:**

```bash
npx omega stripe
```

If any prerequisite is missing, webhook forwarding is silently skipped with an info message.

The forwarding URL is: `http://localhost:{hostingPort}/omega/payments/webhook?provider=stripe&key={OMEGA_WEBHOOK_KEY}`

## Signature verification locally

`STRIPE_WEBHOOK_SECRET` turns on the route's Stripe signature check ([payment-system.md](payment-system.md#webhook-verification)). The Stripe CLI signs forwarded events with **its own** secret, not the Dashboard endpoint's, so a local run sets:

```bash
stripe listen --print-secret
```

and puts that `whsec_…` value in `functions/.env`. Leaving `STRIPE_WEBHOOK_SECRET` unset keeps the route on the key-only path (a warn per provider per instance) — the right setting for a brand not yet migrated.
