# PayPal sandbox QA drives (live sale + refund fixtures)

The repeatable recipe for driving a REAL PayPal sandbox payment through the deployed
playground backend, proven 2026-08-17 on the [#240](https://github.com/Omega-JS-Stack/omega/issues/240)
v1 sale fixture drive. Use it whenever a webhook change needs a live delivery instead
of a fixture replay. [#348](https://github.com/Omega-JS-Stack/omega/issues/348) precreated
what it could: the QA product's provider objects exist on every provider. The BUYER
stays hand-made — PayPal retired the sandbox-accounts API (see below).

## The standing fixtures

- **Merchant / API creds** — the sandbox business account (display name
  "test facilitator's Test Store", PayPal's default; rename in the developer
  dashboard if the checkout header matters). Creds: `PAYPAL_CLIENT_ID` +
  `PAYPAL_CLIENT_SECRET` in the playground backend's `.env`
  (`brands/playground-omega/targets/backend/.env`). The manager wants the client id in
  config (`payment.providers.paypal.clientId`) and only the secret in `.env`;
  the backend wants both as env vars.
- **Webhook** — registered by the manager payment walk, pointing at the deployed
  playground backend (`api.playground.omegajs.dev/omega/payments/webhook`).
  Deliveries arrive with real signature headers; the deployed backend is the
  verification surface (a local emulator receives nothing — no forwarding path).
- **QA product** — `proof-press` ("Proof Press", $5 monthly, NO trial)
  in `brands/playground-omega/config/omega.json5`. Trial-free ON PURPOSE: every public
  tier carries a 14-day trial, which defers a subscription's first sale two weeks.
  It lists on the playground /pricing page on purpose (Ian 2026-08-19, #348) so
  real checkouts can be run against it by hand; the `hidden: true` mechanism
  remains available for products that should stay off /pricing.
  The manager payment walk owns the provider objects
  (`npx mgr manage --service=payment` at the playground root); read the current
  ids from the config write-backs (`stripe.productId`, `paypal.productId`) and
  list plans via `GET /v1/billing/plans?product_id=<paypal.productId>`.
- **Sandbox buyer** — `qa-fixture-buyer@playground.omegajs.dev`, created by hand
  through PayPal's guest checkout during the 2026-08-17 drive. Its wallet holds a
  working generator-BIN Visa. It is DURABLE — the hoops are one-time, not per
  drive. If the login is lost, recreate it through the guest flow below, or from
  the Developer Dashboard (Sandbox → Accounts → Create Account).
  **There is no API for this** (probed 2026-08-18, #348): the app-credential token
  carries no sandbox-account scope (asking for one downgrades the token to
  `openid`), the legacy `/v1/customer/partners/{merchant_id}/accounts` route 404s
  even with our real merchant id, and every `developer.paypal.com` account path
  redirects to an interactive login. Don't spend time re-probing it. Because the
  walk cannot precreate the buyer, it REMINDS instead: a payment walk whose PayPal
  credentials resolve to sandbox closes `paypal-products` with the buyer note and
  the Sandbox → Accounts deep link (silent in live mode).

## Two lanes — pick deliberately (Ian's ruling, 2026-08-17)

- **Default: through omega's checkout.** Drive the deployed playground site's
  checkout page as a user. That exercises the FULL pipeline — payments-intent,
  cart, provider object, confirmation redirect — and the webhook folds onto an
  existing trail. Any "does the pipeline work" drive belongs here.
- **Exception: raw API, only when the test target is the recovery path.** A
  subscription created straight through PayPal's API arrives at the webhook with
  no intent and no order, which is precisely what the uid-recovery code
  (fetchResource + custom_id fold, #224) exists for. Know that this lane mints
  the order FROM the webhook — the #335 refund-before-order shape — so never
  mistake its result for proof of the checkout lane.

## The drive (subscription sale → refund, raw-API lane)

All API calls go to `https://api-m.sandbox.paypal.com` with an OAuth token from the
`.env` creds. A staged helper script from the 2026-08-17 run is described in the
#240 trail; rebuild it from this sequence if needed.

1. `POST /v1/billing/subscriptions` with the QA plan id,
   `custom_id: "uid:{uid},orderId:{orderId}"` (the pipeline's parse format —
   uid must exist on the LIVE project; export one with
   `npx firebase auth:export --project omegajs-playground`), and an
   `application_context` carrying `return_url`/`cancel_url` (omit it and PayPal
   shows its own confirmation page instead of redirecting back).
2. Open the returned `approve` link in a browser, log in as the sandbox buyer,
   pick the working card, Agree. Status flips `APPROVAL_PENDING → ACTIVE` and the
   first REGULAR cycle charges immediately (no trial).
3. `GET /v1/billing/subscriptions/{id}` for `billing_info.last_payment`, then
   `GET /v1/billing/subscriptions/{id}/transactions?start_time&end_time` for the
   sale id. `PAYMENT.SALE.COMPLETED` arrives at the deployed backend.
4. Refund: `POST /v1/payments/sale/{saleId}/refund` with `{}` (full refund).
   `PAYMENT.SALE.REFUNDED` arrives; the worker runs `fetchResource('sale')`,
   resolves the uid, and folds the order to `status=refunded`.
5. Verify: `GET /v1/notifications/webhooks-events?event_type=...` for deliveries;
   `npx firebase functions:log --project omegajs-playground` for the parse,
   fetch, and transition lines.
6. Cleanup: `POST /v1/billing/subscriptions/{id}/cancel`. Leave the plan and
   product alone — the manager owns them.

## Gotchas (each cost real time on the first drive)

- `PAYMENT.SALE.*` (v1) events come ONLY from subscription billing. One-time card
  orders emit `PAYMENT.CAPTURE.*` (v2). Pick the lane for the event you need.
- The classic 4111/4012 test Visas fail: 4111… is declined at commit, 4012… is
  claimed by another sandbox account. A Luhn-valid number on PayPal's generator
  BIN (4032…) works — the buyer's saved card is one.
- Guest checkout hoops: the expiry mask wants `MM/YY`; the SMS gate accepts any
  6-digit code in sandbox; a fake street address hard-rejects until PayPal's
  normalizer can match it (a real street like `2211 N 1st St, San Jose` passes).
- A subscription created with `payment_source.card` does NOT auto-activate; it
  still returns an approval link.
- A real v1 subscription sale carries `custom` + `billing_agreement_id` and no
  `parent_payment`; the legacy one-time shape (uid via the `parent_payment`
  fold) is covered by `test/fixtures/paypal/sale-refunded.json`. Both uid paths
  stay pinned.
- v1 resources spell status `state`; the pipeline reads both
  (`resource.status ?? resource.state`, [#347](https://github.com/Omega-JS-Stack/omega/issues/347)),
  so a successful v1 fetch logs its real status (`status=refunded`).
