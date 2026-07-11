# D12 provider-discriminated config keys — exact-shape proposal (N4)

> Status: PROPOSAL — exact key names for D12 ("keys name a ROLE with a `provider` discriminator, e.g. `firebaseConfig` → `<role>: { provider: 'firebase', … }`; shape-only future-proofing, no alternative providers built"). D12 itself says the exact names land in N4's config review — this is that review. Survey: cp73c D12 agent. **The four ⚠-flagged renames touch live surfaces and wait for Ian's OK (data-shape preservation rule).**

## Reality found: THREE patterns coexist, and one D12 shape can't fit all

1. **Provider-named top-levels** (what D12 kills): `firebaseConfig`, `sentry`; manager-side `firebase`, `cloudflare`, `recaptcha`, `adsense`, `searchConsole`, `slapform`, `chatsy`, `replyify`, `anthropic`, `openai`.
2. **Role + provider-keyed MAP** (several providers active at once): `analytics.providers.{google,meta,tiktok}`, `payment.processors.{stripe,paypal,chargebee,coinbase}`, `payment.products[].{stripe,paypal,chargebee}`, `oauth2.{providerId}`. A single `provider` field does NOT fit these — the map IS the right shape and stays.
3. **Already discriminated, inconsistent field name**: `marketing.campaigns.platform`, `marketing.newsletter.platform`, `blog.platform`, `devlog.platform` (all `platform`); `domain.provider`, `domain.email.provider`, desktop `platforms.win.signing.cloud.provider` (already `provider`).

**Load-bearing wrinkle**: the browser client reads a FLAT legacy shape (`config.analytics.google`, `config.sentry.enabled/config`, flat `firebaseConfig`), produced by build-time bridges — `web/src/engine.js:80-86` and `extension/src/gulp/tasks/package.js:79-107`. Every rename has three blast zones: schema, direct readers, bridges. All in-repo.

## Proposed rules (the review's verdict)

- **R1 — multi-provider roles keep the map.** `analytics.providers.*`, `payment.processors.*`, `payment.products[].*`, `oauth2.*` are already role-first and correct. No change. (D12's single-`provider` example simply doesn't apply to them.)
- **R2 — the discriminator field is `provider`, everywhere.** Rename the `platform` fields → `provider` (`marketing.campaigns`, `marketing.newsletter`, `blog`, `devlog`). Mechanical, in-repo, low risk.
- **R3 — single-provider roles get `<role>: { provider, … }`.** Proposed names:
  - `firebaseConfig` → **`cloud: { provider: 'firebase', config: { apiKey, projectId, … } }`** — the role is the app/cloud platform (supabase would be the someday-alternative). `platform` as the key collides with desktop's `platforms`; `app`/`backend` are overloaded. ⚠ WAIT FOR IAN — most-wired key in the repo (client `_resolveFirebaseConfig`, both bridges, backend runtime + `GET /brand`, analytics uuidv5 namespace seeded from `firebaseConfig.projectId`).
  - `sentry` → **`errorMonitoring: { provider: 'sentry', dsn }`** ⚠ flag (client bridge + backend + extension webpack read it).
  - Manager-side AI: `anthropic`/`openai` top-levels → **`ai.providers.{anthropic,openai}`** (matches the existing `ai.request({ provider })` seam and `newsletterConfig.provider.{structure,filter,svg}` sub-task discriminators). Manager/backend-internal; medium-low risk.
- **R4 — ITW-service manager keys stay put for now** (`cloudflare`, `recaptcha`, `adsense`, `searchConsole`, `slapform`, `chatsy`, `replyify`, `certificates.apple`): single-purpose provisioning config, not consumer-facing roles; role-ifying them buys nothing until a second provider is imaginable. Revisit only if one appears.
- **R5 — already-`provider` keys are D12-done**: `domain.provider`, `domain.email.provider`, `platforms.win.signing.cloud.provider`. No change.

## Ian-decision list (⚠ = touches live surfaces; flag with migration story, don't build)

| Change | Why it needs Ian | Blast |
|---|---|---|
| `firebaseConfig` → `cloud.{provider,config}` | `GET /brand` re-emits it verbatim (wire contract for deployed clients once brands migrate); 9 fixture configs; migrate-codemod output; identity-namespace seed | HIGH |
| `sentry` → `errorMonitoring.{provider,dsn}` | client flat-contract bridge; `GET /brand` adjacency | MED |
| `payment.*` / `oauth2` internals | product IDs match live Stripe/PayPal/Chargebee objects + Firestore subscriptions; `user.oauth2.{providerId}` mirrored in Firestore — R1 says DON'T touch, listed so nobody "cleans them up" later | HIGH (that's why: no change) |
| `platform` → `provider` field renames (R2) + `ai.providers` (R3c) | none really — in-repo; listed for the veto window | LOW |

**Timing**: D12's own note — "cheap pre-dogfood, expensive after brands migrate." R2 + R3c can ship in the next config checkpoint under the standing veto-window convention; R3a/R3b (`cloud`, `errorMonitoring`) wait for Ian's explicit OK on the names AND the go-ahead, then land as one sweep with both bridges + fixtures + docs in lockstep.
