# Stripe Webhook Forwarding

@omega.js/backend auto-starts Stripe CLI webhook forwarding when running `npx omega serve` or `npx omega emulator`. This forwards Stripe test webhooks to the local server so the full payment pipeline works end-to-end during development.

**Requirements:**
- `STRIPE_SECRET_KEY` set in `functions/.env`
- `BACKEND_MANAGER_WEBHOOK_KEY` set in `functions/.env` (`BACKEND_MANAGER_KEY` also accepted as a legacy fallback)
- [Stripe CLI](https://stripe.com/docs/stripe-cli) installed

**Standalone usage:**

```bash
npx omega stripe
```

If any prerequisite is missing, webhook forwarding is silently skipped with an info message.

The forwarding URL is: `http://localhost:{hostingPort}/backend-manager/payments/webhook?processor=stripe&key={BACKEND_MANAGER_WEBHOOK_KEY}`
