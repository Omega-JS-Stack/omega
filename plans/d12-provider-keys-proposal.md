# D12 provider-discriminated config keys — exact-shape proposal (N4)

> Status: **IMPLEMENTED (checkpoint 74, 2026-07-10)** — the sweep below shipped exactly as approved; see CHANGELOG [Unreleased] "D12 shipped" for the blast-zone list + proofs (full matrix, sandbox corpus 1208/44/0, pack-smoke ×4). One survey correction found at implementation: **R3c is vacuous in the monorepo** — the `anthropic`/`openai` top-levels were legacy omega-manager keys that were never ported (zero readers in packages/manager or packages/backend; the AI library resolves keys from `.env`), so `ai.providers.*` has nothing to rename until the pinned migration tooling meets a legacy brand config that carries them.
>
> Approval record: **APPROVED (Ian 2026-07-10)** — exact key names for D12 ("keys name a ROLE with a `provider` discriminator; shape-only future-proofing, no alternative providers built"). Ian locked the names: **`cloud`** (was `firebaseConfig`) and **`monitoring`** (was `sentry`; his call — "i like single words", which is now the naming convention for future roles). Survey: cp73c D12 agent.

## Reality found: THREE patterns coexist, and one D12 shape can't fit all

1. **Provider-named top-levels** (what D12 kills): `firebaseConfig`, `sentry`; manager-side `firebase`, `cloudflare`, `recaptcha`, `adsense`, `searchConsole`, `slapform`, `chatsy`, `replyify`, `anthropic`, `openai`.
2. **Role + provider-keyed MAP** (several providers active at once): `analytics.providers.{google,meta,tiktok}`, `payment.processors.{stripe,paypal,chargebee,coinbase}`, `payment.products[].{stripe,paypal,chargebee}`, `oauth2.{providerId}`. A single `provider` field does NOT fit these — the map IS the right shape and stays.
3. **Already discriminated, inconsistent field name**: `marketing.campaigns.platform`, `marketing.newsletter.platform`, `blog.platform`, `devlog.platform` (all `platform`); `domain.provider`, `domain.email.provider`, desktop `platforms.win.signing.cloud.provider` (already `provider`).

**Load-bearing wrinkle**: the browser client reads a FLAT legacy shape (`config.analytics.google`, `config.sentry.enabled/config`, flat `firebaseConfig`), produced by build-time bridges — `web/src/engine.js:80-86` and `extension/src/gulp/tasks/package.js:79-107`. Every rename has three blast zones: schema, direct readers, bridges. All in-repo.

## Proposed rules (the review's verdict)

- **R1 — multi-provider roles keep the map.** `analytics.providers.*`, `payment.processors.*`, `payment.products[].*`, `oauth2.*` are already role-first and correct. No change. (D12's single-`provider` example simply doesn't apply to them.)
- **R2 — the discriminator field is `provider`, everywhere.** Rename the `platform` fields → `provider` (`marketing.campaigns`, `marketing.newsletter`, `blog`, `devlog`). Mechanical, in-repo, low risk.
- **R3 — single-provider roles get `<role>: { provider, … }`.** Names APPROVED by Ian (single words):
  - `firebaseConfig` → **`cloud: { provider: 'firebase', config: { apiKey, projectId, … } }`** — the role is the app/cloud platform (supabase would be the someday-alternative). Most-wired key in the repo (client `_resolveFirebaseConfig`, both bridges, backend runtime + `GET /brand`, analytics uuidv5 namespace seeded from `firebaseConfig.projectId`) — land as ONE sweep with bridges + fixtures + docs in lockstep.
  - `sentry` → **`monitoring: { provider: 'sentry', dsn }`** (client bridge + backend + extension webpack read it — same-sweep).
  - Manager-side AI: `anthropic`/`openai` top-levels → **`ai.providers.{anthropic,openai}`** (matches the existing `ai.request({ provider })` seam and `newsletterConfig.provider.{structure,filter,svg}` sub-task discriminators). Manager/backend-internal; medium-low risk.
- **R4 — ITW-service manager keys stay put for now** (`cloudflare`, `recaptcha`, `adsense`, `searchConsole`, `slapform`, `chatsy`, `replyify`, `certificates.apple`): single-purpose provisioning config, not consumer-facing roles; role-ifying them buys nothing until a second provider is imaginable. Revisit only if one appears.
- **R5 — already-`provider` keys are D12-done**: `domain.provider`, `domain.email.provider`, `platforms.win.signing.cloud.provider`. No change.

## Decision record (all resolved 2026-07-10)

| Change | Status |
|---|---|
| `firebaseConfig` → `cloud.{provider,config}` | **APPROVED by Ian** — blast: `GET /brand`, both bridges, 9 fixtures, migrate-codemod output, identity-namespace seed; one lockstep sweep |
| `sentry` → `monitoring.{provider,dsn}` | **APPROVED by Ian** (his pick over `errorMonitoring` — single words) |
| `payment.*` / `oauth2` internals | **NO CHANGE, permanent** (R1): product IDs match live Stripe/PayPal/Chargebee objects + Firestore subscriptions; `user.oauth2.{providerId}` mirrored in Firestore — listed so nobody "cleans them up" later |
| `platform` → `provider` field renames (R2) + `ai.providers` (R3c) | Green (in-repo, was never gated) |

**Timing**: D12's own note — "cheap pre-dogfood, expensive after brands migrate" — and brands haven't migrated: implement the whole sweep now (next checkpoint).
