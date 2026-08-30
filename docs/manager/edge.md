# The edge service — the brand's Cloudflare zone

The `edge` service reconciles the brand's zone to `edge.providers.cloudflare` in
`config/omega.json5`: the zone itself, DNS records, email routing, zone settings, the five
rulesets, scheduled speed tests, and workers. It runs early — third in the walk — because
every DNS-dependent service after it needs the zone to exist. Every handler follows
read → diff → write (Cloudflare requires fetching current state before patching), and each
read step is cached to `.omega/cache/cloudflare/{op}.json` as a debugging aid.

## What it reconciles

| Operation | What it does |
|---|---|
| `zone` | The zone exists; created when missing. A pending zone reports its nameservers, and an interactive run on a manual registrar opens the registrar's nameserver page and polls until the zone activates. The resolved id lands in `edge.providers.cloudflare.zone` ([#434](https://github.com/Omega-JS-Stack/omega/issues/434)) — the id `omega purge` targets from a build, where no Cloudflare token is in play — and rides the run as state for every later operation. |
| `dns-records` | The required platform record set (GitHub Pages, `www`, the email provider's MX/SPF, DMARC; BIMI and the SendGrid CNAMEs only when configured) plus `dns.records` custom entries, diff-synced: create, update, delete. |
| `email-routing` | Cloudflare Email Routing, only when `domain.email.providers` names cloudflare; rules come from `domain.email.forwarding` (`[{ from: 'support' \| '*', to: 'inbox@…' }]`). |
| `zone-settings` | A flat map matching Cloudflare's own setting IDs, diffed in one bulk read and patched per changed setting (Cloudflare has no bulk PATCH). Addon settings (`speed_brain`, `fonts`) need their own GET each. Read-only and absent settings are skipped, and one setting's failure never blocks the rest. |
| `cache-rules` | The `http_request_cache_settings` entrypoint ruleset, rules matched by description. |
| `rules-managed-transforms` | Cloudflare's managed request/response headers, enabled or disabled per config name, PATCHed in one call. |
| `rules-redirect` | The `http_request_dynamic_redirect` ruleset. |
| `rules-configuration` | The `http_config_settings` ruleset. |
| `rules-response-headers` | The `http_response_headers_transform` ruleset (always PUT — at the ruleset's id when it exists, at the phase entrypoint when it does not). |
| `rules-security` | Custom firewall rules in `http_request_firewall_custom`. |
| `speed-scheduled-tests` | The homepage's Speed Test schedule (a create-or-replace POST on the custom Speed API endpoint). |
| `workers` | Worker scripts + routes from `edge.providers.cloudflare.workers` — `script` names a file in the service's own `workers/` dir, `route` supports `{ domain }` templating. Unconfigured workers and routes are removed. |

## Config

Everything sits under `edge.providers.cloudflare`:

- `enabled: false` — the tri-state opt-out; the whole service skips.
- `zone` — the resolved zone id, written back by the `zone` operation.
- `dns` — `spf` (`'strict'`/`'soft'`), `dmarcPolicy`, `spfIncludes`, `dmarcReports.{rua,ruf}`,
  `bimiLogo`, `sendgrid.{id,whitelabel}` (the campaigns service owns those values), and
  `records[]` for custom entries such as verification TXTs.
- `settings` — the zone-settings map, keyed by Cloudflare's setting IDs exactly.
- `cacheRules[]`, `rules.{managedTransforms,redirect,configuration,responseHeaders,security}`,
  `speedTest.{frequency,region}`, `workers[]`.

The manager's defaults hold PLATFORM answers only; company-specific values (DMARC report
addresses, the BIMI logo, extra CSP hosts) belong in the company or brand layer.

**Credential**: `CLOUDFLARE_TOKEN` in the brand `.env`, asked for through the shared setup
contract. No `brand.url` → the service skips.

## Subdomain projects use the parent zone

When `brand.url` is not an apex (`playground.omegajs.dev`), the service works on the PARENT
zone (`omegajs.dev`) and runs only `zone` and `dns-records` — zone-level settings, rules and
workers belong to the parent brand. `dns-records` then only touches records belonging to the
subdomain. Creating the parent zone is inert until the registrar's nameservers point at it,
which the `domain` service handles right after.

## Gotcha: a subdomain project's API host stays DNS-only, so it gets no Cloudflare geo headers

Cloudflare's Universal SSL — every plan, free included — covers the apex and exactly ONE
label below it (`*.omegajs.dev`). A subdomain project's API host is two labels deep
(`api.playground.omegajs.dev`), so no certificate at the proxy can terminate TLS for it, and
the `cloud` service's hosting ensure leaves that CNAME **DNS-only** (grey cloud) with
Firebase serving the certificate instead (`packages/manager/src/services/cloud/ensure/hosting.js`,
`zoneTlsCoverage`). Traffic therefore never passes through Cloudflare, and Cloudflare's
visitor-location headers — the ones the `addVisitorLocationHeaders` managed transform turns
on — never reach that API. Region and city read null in the backend
([#638](https://github.com/Omega-JS-Stack/omega/issues/638)) and no edge setting fixes it:
nothing is missing, the name is simply outside the certificate.

- **Top-level brands are unaffected**: `api.brand.com` is one label under the zone, Universal
  SSL covers it, the record is proxied, and the geo headers arrive.
- **The fix for a subdomain project is the paid Cloudflare add-on** — Advanced Certificate
  Manager / Total TLS on the zone. The gate already recognizes it: the hosting ensure asks the
  zone for its ACTUAL coverage (`/acm/total_tls`, then active certificate packs) and proxies
  the name the moment a certificate covers it, printing which coverage let it through. A
  lookup failure falls back to not-covered — a DNS-only record works on every plan, a wrongly
  proxied one never does.
- **The log line names it either way**: verified-but-uncovered prints "Universal SSL stops at
  `*.<zone>`; no Total TLS or deeper cert pack on this zone — CNAME stays DNS-only, Firebase
  serves the certificate".

## Gotcha: the branded-link CNAME is grey until SendGrid validates it

`emailurl.<domain>` is the one record whose desired shape is not config at all. SendGrid
validates a branded link by resolving that host as a CNAME to `sendgrid.net`, and a
Cloudflare-PROXIED record answers with the edge's own addresses instead — so proxying it
before validation locks the branding out of ever validating and every emailed link stays
broken ([#646](https://github.com/Omega-JS-Stack/omega/issues/646)). The handler therefore
asks SendGrid first (`GET /v3/whitelabel/links`) and only proxies once that host reports
`valid: true`.

Since [#662](https://github.com/Omega-JS-Stack/omega/issues/662) the walk WAITS for that
answer instead of leaving the flip to a later run: `pollWithSpinner` re-asks SendGrid every
10s (ENTER checks now, `s` skips) and the same pass proxies the CNAME. A skipped wait, or a
run with no TTY, keeps the record grey and returns **warned** with the reason — "SendGrid has
not validated the branded link — the emailurl CNAME stays unproxied" — so the run summary
names what is still owed. No API key, no branding entry, an unreachable SendGrid, or a
subdomain project all answer NO: the unproxied record is the safe half of the pair.

## Other gotchas

- **The Speed API rejects a zone that is not active yet** (`speed.errors.zone_not_active`) —
  the operation skips until activation instead of failing.
- **A never-used ruleset phase** answers "could not find entrypoint ruleset"; that is detected,
  and the first write POSTs a new ruleset rather than PUTting a missing one.
- **Rules are matched by their `name`** (Cloudflare's `description`): rename a rule in config
  and the old one is removed and a new one created.
- **`omega-api-proxy.js`** is for a brand whose api host fronts a dedicated non-Firebase
  backend: the worker carves `/omega` (and the legacy `/backend-manager` alias) out at the
  edge and proxies it to the brand's Cloud Functions, passing everything else through.
