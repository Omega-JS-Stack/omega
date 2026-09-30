# Key Files Reference

| Purpose | File |
|---------|------|
| The `Omega` class and its one instance | `src/omega/index.js` |
| `Context` (the `ctx` every handler receives) | `src/omega/context.js`, `src/omega/context/` |
| Request pipeline (the ordered steps) | `src/omega/pipeline.js` |
| `omega_api` dispatch (MCP, framework route) | `src/omega/router.js` |
| Event dispatcher (`omega.events.run()`) | `src/omega/events.js` |
| Cron runner | `src/omega/cron.js` |
| Custom-server mode | `src/omega/server.js` |
| Schema adapter (the one schema system) | `src/omega/helpers/schema.js` |
| Schema loading and validation into `ctx.data` | `src/omega/services/settings.js` |
| Counted-feature gate (`ctx.usage`) | `src/omega/services/usage.js` |
| `User` id generators | `src/omega/services/user.js` |
| Shared utilities (`omega.utilities`) | `src/omega/services/utilities.js` |
| Auth: before-create | `src/omega/events/auth/before-create.js` |
| Auth: before-signin | `src/omega/events/auth/before-signin.js` |
| Auth: on-create | `src/omega/events/auth/on-create.js` |
| Auth: on-delete | `src/omega/events/auth/on-delete.js` |
| Auth: shared utilities | `src/omega/events/auth/utils.js` |
| Config template | `templates/config/omega.json5` |
| CLI entry | `src/cli/index.js` |
| CLI command table (dispatch order + generated help) | `src/cli/command-table.js` |
| Stripe webhook forwarding | `src/cli/commands/stripe.js` |
| Firebase init helper (CLI) | `src/cli/commands/firebase-init.js` |
| Firestore CLI commands | `src/cli/commands/firestore.js` |
| Auth CLI commands | `src/cli/commands/auth.js` |
| Logs CLI commands | `src/cli/commands/logs.js` |
| Intent creation | `src/omega/routes/payments/intent/post.js` |
| Webhook ingestion | `src/omega/routes/payments/webhook/post.js` |
| Webhook processing (on-write) | `src/omega/events/firestore/payments-webhooks/on-write.js` |
| Payment analytics | `src/omega/events/firestore/payments-webhooks/analytics.js` |
| Transition detection | `src/omega/events/firestore/payments-webhooks/transitions/index.js` |
| Payment provider libraries | `src/omega/libraries/payment/providers/` |
| Stripe library | `src/omega/libraries/payment/providers/stripe.js` |
| PayPal library | `src/omega/libraries/payment/providers/paypal.js` |
| Order ID generator | `src/omega/libraries/payment/order-id.js` |
| Required Firestore indexes (SSOT) | `src/cli/commands/setup-tests/helpers/required-indexes.js` |
| Test accounts | `src/test/test-accounts.js` |
