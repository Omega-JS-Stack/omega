# The payment service — products, prices, and webhooks

The `payment` service reconciles the brand's payment providers to `payment.products`: Stripe
(account profile, products + prices, webhook, plus the two Dashboard-only guidance checks),
PayPal (catalog products + billing plans, webhook), and Chargebee (item family → items → item
prices, webhook). Product ids are written back into omega.json5 and mirrored in state.

## What it reconciles

**Stripe** — `stripe-account` (business profile diffed to brand config),
`stripe-radar` and `stripe-disputes` (Dashboard-only, so: guidance + an interactive confirm),
`stripe-webhook`, `stripe-products` (config id → state → metadata match → create; stale
prices ARCHIVED, since Stripe cannot delete a price).

**PayPal** — `paypal-account` (an auth probe that also resolves live vs sandbox),
`paypal-webhook`, `paypal-products` (catalog products + billing plans; plans matched by
interval + amount + trial-cycle presence, duplicates and stale plans deactivated, legacy
products' active plans deactivated so no new subscription lands on them). A product with
`trial.days` gets TWO plans per paid interval — the trial twin and the skip-trial twin,
named `<Display> (Monthly)` and `<Display> (Monthly, no trial)` — because PayPal puts a
trial on the PLAN, so a buyer who is not owed one needs a plan with no free cycle on it
([#761](https://github.com/Omega-JS-Stack/omega/issues/761)). Neither twin is a duplicate
or a stale copy of the other, so a rerun creates and deactivates nothing; a brand that
already ships trials needs ONE manage run to mint the new twins.

**Chargebee** — `chargebee-account` (an API-access probe), `chargebee-webhook`,
`chargebee-products` (fully deterministic ids — family `{brandId}`, item
`{brandId}-{productId}`, price `{brandId}-{productId}-{interval}` — so resolution needs no
stored state at all: a 404 on the deterministic id means "create it").

**Coinbase Commerce** — **nothing**, and that is the whole design
([#642](https://github.com/Omega-JS-Stack/omega/issues/642)). A crypto charge is created ad
hoc at checkout, so there is no catalog to reconcile, and its webhook endpoint is set by hand
in the Coinbase dashboard (the API manages none). Its entire manage-time surface is the
CREDENTIAL, which the setup contract asks for in `setup` — gated on
`payment.providers.coinbase.enabled` being explicitly `true`, so a brand that never turned
crypto on is never asked for a key it has no use for. `--provider=coinbase` therefore asks for
the key and then skips, saying so.

Every webhook operation matches by exact URL, deletes every OTHER endpoint on the brand's API
host (stale twins — endpoints on other hosts are never touched), re-enables an endpoint the
provider auto-disabled, and diffs the event set.

## Config

- `payment.enabled: false` — skip. The service also skips when `payment.products` has no paid,
  non-archived entry.
- `payment.products[]` — the SSOT. Free tiers have no prices; an archived product keeps its
  provider objects but stops being reconciled.
- `payment.products[id=…].{stripe,paypal}.productId` — written back on create/match.
- `payment.providers.stripe.{publishableKey,updateAccountInfo,radar,radarConfirmed,disputesConfirmed}`,
  `payment.providers.paypal.clientId`, `payment.providers.chargebee.site` — the public halves
  live in config; each provider can be disabled with `payment.providers.<name>: false`.
- `payment.providers.coinbase.enabled` — the exception, because Coinbase Commerce has NO public
  half: its API key is the entire credential, so `enabled` (default OFF) is both the switch and
  the opt-out, and the setup flow's "Disable permanently" lands `false` THERE rather than on the
  provider block.
- `brand.images.brandmark` — the product image the providers show (omega-manager hardcoded a
  company CDN).

**Credentials**: `STRIPE_SECRET_KEY`, `PAYPAL_CLIENT_SECRET`, `CHARGEBEE_API_KEY`,
`COINBASE_COMMERCE_API_KEY` — each OPTIONAL (`gates: false`), so a missing Stripe key never
gates a PayPal brand and each entry's "Disable permanently" writes only its own provider's
`false` (coinbase's lands on `payment.providers.coinbase.enabled`). `OMEGA_WEBHOOK_KEY` is
OMEGA's own and is minted, not asked for. `--provider=stripe|paypal|chargebee|coinbase`
narrows a run to one provider's operations.

## Gotchas

- **A shared Firebase project has no `api.{domain}` backend** to receive events, so every
  webhook operation is skipped there.
- **Stripe account updates are not supported on every account type** (org sub-accounts): a
  failed update warns rather than errors, and `payment.providers.stripe.updateAccountInfo:
  false` turns the whole profile sync off.
- **Radar rules and Enhanced Dispute Protection have no API.** They print the desired rules
  plus a Dashboard deep-link and stay warned until confirmed; the confirmation is one of the
  few reconcile flags config keeps ([#434](https://github.com/Omega-JS-Stack/omega/issues/434)).
- **Chargebee does not return `enabled_events`**, so event drift cannot be diffed: events are
  set on CREATE only, and changing them means delete + recreate.
- **Chargebee has no daily billing cycle**, and its one-time `once` prices are not managed yet
  (a visible note, not a silent skip).
- **PayPal sandbox mode** reconciles the payments-QA fixtures, so the step closes with the
  sandbox-buyer reminder.
