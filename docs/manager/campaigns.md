# The campaigns service — the brand's email marketing (SendGrid)

The `campaigns` service reconciles the brand's email-marketing infrastructure on SendGrid:
domain authentication, a verified sender for Single Sends, the brand's marketing list, the
unsubscribe groups the backend sends through, `@omega.js/backend`'s custom fields and
segments, and the account-global Event Webhook. It runs after `edge`, because the DKIM records
are written into the Cloudflare zone.

The whole service reconciles ONE SendGrid account per brand-or-company: the
groups/fields/segments/webhook operations converge on the same result when sibling brands
share the account.

## What it reconciles

| Operation | What it does |
|---|---|
| `domain-auth` | SendGrid domain authentication for `brand.url`'s domain. Missing → authenticate (`automatic_security` returns three CNAMEs under `emailauth.`), diff-sync those records into the Cloudflare apex zone, then validate — an interactive run polls until DNS propagates and SendGrid confirms. |
| `sender-identity` | The verified sender Single Sends require: `offers@{contact domain}` with the brand's name. It auto-verifies because `domain-auth` ran first. |
| `list` | The brand's marketing list, resolved config id → exact-name lookup → create, with the id written back to `marketing.campaigns.providers.sendgrid.listId`. |
| `unsubscribe-groups` | The account's ASM groups (below). |
| `custom-fields` | `@omega.js/backend`'s custom fields, from its marketing SSOT, honoring each field's provider skip list (SendGrid has first/last name built in). A type mismatch cannot be patched in SendGrid, so the field is deleted and recreated. |
| `segments` | `@omega.js/backend`'s segments, each one's `query_dsl` rebuilt from its conditions and compared against the live segment; stale ones are PATCHed, falling back to delete + recreate. Orphaned `__temp_` segments (leaked by a brand-scoped campaign send that crashed) are swept. |
| `event-webhook` | The account-global Event Webhook pointed at the PARENT backend's forwarder, with the consent toggles (`bounce`, `dropped`, `spam_report`, `unsubscribe`, `group_unsubscribe`) enabled and drift patched by minimum diff. |

Fields and segments `@omega.js/backend` does not own are never touched.

## Unsubscribe groups ([#649](https://github.com/Omega-JS-Stack/omega/issues/649))

The `unsubscribe-groups` operation ensures the SendGrid ASM groups the backend's send path
names actually exist, and lands their ids in config. The KEYS come from `@omega.js/backend`'s
email SSOT (`GROUP_KEYS`); the recipient-facing NAME and description of each live here, on the
provider side:

| Key | Group name |
|---|---|
| `orders` | OMEGA - Order Updates |
| `hello` | OMEGA - Onboarding |
| `account` | OMEGA - Account |
| `marketing` | OMEGA - Marketing & Promotions |
| `security` | OMEGA - Security |
| `newsletter` | OMEGA - Newsletter |
| `internal` | OMEGA - Internal Alerts |

Groups are matched by NAME, never by id: ASM ids are per SendGrid ACCOUNT, so sibling brands
sharing one account converge on the same groups and land the same ids. Each resolved id is
written to `marketing.campaigns.providers.sendgrid.groups.<key>` — its ONE authoritative home,
through the comment-preserving editor, so a converged brand leaves omega.json5 byte-identical.
`@omega.js/backend` reads the id there and fails loudly at send time when one is missing. A
backend group key with no name+description row here throws at the top of the operation, not at
send time. A dry run names the groups it would create and writes nothing.

## Config

- `marketing.campaigns.enabled: false` — skip.
- `marketing.campaigns.providers.sendgrid` — the vendor is a KEY under `providers`
  ([#425](https://github.com/Omega-JS-Stack/omega/issues/425)): no entry means none chosen.
- `marketing.campaigns.providers.sendgrid.listId` — written back by `list`.
- `marketing.campaigns.providers.sendgrid.groups.<key>` — written back by `unsubscribe-groups`.
- `brand.address` — the physical mailing address CAN-SPAM requires on a sender. omega-manager
  stamped the company's address on every brand; this ASKS for the brand's own
  ([#635](https://github.com/Omega-JS-Stack/omega/issues/635)), five fields behind ONE gate,
  and warns only when nobody can be asked.
- `parent` — whose backend the Event Webhook points at (`'self'` when this brand IS the
  parent; `false` is a deliberate opt-out).
- `edge.providers.cloudflare.dns.sendgrid.{id,whitelabel}` — the domain-auth CNAME values the
  edge service's record set reads.

**Credentials**: `SENDGRID_API_KEY` in the brand `.env`. `OMEGA_WEBHOOK_KEY` is OMEGA's own
and is MINTED by the setup contract rather than asked for
([#635](https://github.com/Omega-JS-Stack/omega/issues/635)), so the webhook operation can
read it even when this service runs before the workspace one did.

## Gotchas

- **SendGrid supports ONE Event Webhook per account**, so it always targets the parent brand's
  forwarder and the parent fans events out to each brand's own `/marketing/webhook` endpoint.
  Only the consent toggles are managed — tracking toggles (open/click/delivered) are not ours
  to touch.
- **No Cloudflare token is survivable.** `domain-auth` prints the records to add by hand and
  still attempts validation, so a manual fix converges on the next run.
- **The sender's identity needs human input** where config has none: the address prompt is a
  genuine ask, not a wait, so a headless run legitimately warns.
- **Changing the query builder re-syncs every segment.** The generated SQL is compared against
  the live segments for staleness, so any edit to the DSL translation is a fleet-wide re-sync
  on the next run.
