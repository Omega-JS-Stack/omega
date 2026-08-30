# The analytics service — GA4 streams and the ad pixels

The `analytics` service reconciles the brand's analytics providers to `analytics: {}` in
`config/omega.json5`: one GA4 web data stream per enabled target, the GA property ↔ Firebase
project link, and the Meta and TikTok pixels. It runs after the cloud service (the Firebase
project must exist to link) and before search (which associates the GA property).

The cross-framework event contract — the catalog, the placement rule, consent gating — is
[analytics.md](../shared/analytics.md); this file is only what the manage walk provisions.

## What it reconciles

| Operation | What it does |
|---|---|
| `google-streams` | One GA4 web stream per enabled target, found BY URI (each target gets its own subdomain of the brand domain, virtual for app targets): created when missing, renamed on displayName drift, enhanced measurement diffed before patching, plus a clean Measurement Protocol secret per stream. |
| `google-firebase-link` | The GA property ↔ Firebase project link. A property holds at most one FirebaseLink and a project links to at most one property, so a project linked to the WRONG property is unlinked there and linked here — config is the source of truth. It also normalizes the stream Firebase auto-creates on linking ("Web App", often with no URI). |
| `meta-pixel` | The Meta Pixel exists on the ad account and a Conversions API token is in hand. |
| `tiktok-pixel` | The same shape for TikTok. |

## Config

- `analytics.enabled: false` — skip.
- `analytics.providers.google.propertyId` / `.accountId` — the GA4 property. Missing, with
  credentials available, an interactive run offers the account + property selection/creation
  flow and lands both ids; without a propertyId the two google operations are filtered out.
- `targets.<type>.analytics.providers.google.id` — where each stream's measurement ID lands
  ([#417](https://github.com/Omega-JS-Stack/omega/issues/417)): the per-surface override every
  framework reads through the merge chain, the same shape monitoring uses for DSNs.
- `analytics.providers.meta.{id,accountId}` and `analytics.providers.tiktok.{id,accountId}` —
  the pixel and the ad account / advertiser it lives on. Public ids, so they live in config
  beside the Google ones, never in `.env`. `analytics.providers.<provider>: false` disables
  that provider outright.

**Credentials**: `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (the `analytics.edit` scope;
tokens cache to `.omega/auth/google-analytics-tokens.json`), plus `META_ACCESS_TOKEN` and
`TIKTOK_ACCESS_TOKEN` — the names `@omega.js/backend` reads. Both pixel tokens are OPTIONAL
(`gates: false`): a pixel-only brand is never asked for a Google credential, and a Google-only
brand is never gated on a pixel token. Each stream's Measurement Protocol secret goes to the
brand `.env` as `GOOGLE_ANALYTICS_SECRET_{TARGET}`
([#434](https://github.com/Omega-JS-Stack/omega/issues/434)); the delivery step composes it
into each target's runtime env as `GOOGLE_ANALYTICS_SECRET`, so the pair travels together.

## Near-zero input

A missing pixel reconciles in ONE interactive pass (Ian 2026-08-21, the GA4 standard): acquire
the access token (an Enter-gated open of the mint page, then a paste-in), discover the ad
account the token can see — auto-selected when there is exactly one, landed in config —
create the pixel by name, land its id in omega.json5 and in the in-memory config, so the token
check in the same pass reports the pixel it just made. No token means no provisioning this
pass: warned with where-to-get guidance, never a failure.

## TikTok: the one credential OMEGA MINTS rather than asks for

TikTok is the instance where the credential is MINTED rather than pasted ([#448](https://github.com/Omega-JS-Stack/omega/issues/448)): the setup asks for the developer app's secret ONCE (masked, never persisted anywhere), opens the app's page in the developer portal (`analytics.providers.tiktok.appId`), takes the app's own "Advertiser authorization URL" pasted from there (never built, never stored: the redirect URI is the app's setting), opens it, takes the pasted redirect URL and reads its `auth_code`, exchanges it inline, and saves ONLY the long-lived `TIKTOK_ACCESS_TOKEN` — the name `@omega.js/backend` reads. A re-authorization asks for the secret again; a company-level home for it is [#446](https://github.com/Omega-JS-Stack/omega/issues/446). Nothing here can fail a walk: a headless run, a declined gate, an empty paste, or a rejected exchange all keep the warned where-to-get guidance.

## Gotchas

- **GA's "User Data Collection Acknowledgement" gates secret creation** and has no API. An
  interactive run opens the settings page and retry-polls until the acknowledgement lands, so
  ONE run finishes the job. It is per-property, so the first stream's prompt clears the gate for
  every stream after it.
- **GA holds a just-deleted link for a moment.** When the service unlinks a wrong property and
  immediately creates the right link, the create can fail as "still propagating"; since
  [#662](https://github.com/Omega-JS-Stack/omega/issues/662) an interactive run polls the create
  until GA releases it, and only a skipped or headless run reports warned.
- **A shared cloud project skips the link** — the owning brand manages it.
- **The TikTok pixel path is a scaffold.** The wiring is complete and the token is the gate, but
  no brand carries the key yet, so the create path has never run against the live API and the
  pass ends at the warned guidance.
