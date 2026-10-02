# The domain service — the registrar points at Cloudflare

The `domain` service does one thing: make the registrar's nameservers point at the brand's
Cloudflare zone. It runs right after the `edge` service, because the values it writes are the
nameservers that zone was assigned.

## What it reconciles

One operation, `nameservers`:

1. Read the Cloudflare zone to learn its assigned nameservers.
2. **API registrars** (a registry entry with an `api` client; `namecheap`): read the current
   nameservers and set them when they mismatch.
3. **Manual registrars** — an ACTIVE zone proves the nameservers are already set (success); a
   pending zone prints the exact values to set and returns warned.

Since [#662](https://github.com/Omega-JS-Stack/omega/issues/662) a brand-new zone that has no
nameservers assigned yet is WAITED on rather than deferred: a bounded poll (six reads, 5s
apart) gives Cloudflare the seconds it needs, and only a zone still bare after that — or a run
with no TTY — reports warned with the rerun message.

## Config

`domain` carries TWO roles, each with its own providers block
([#425](https://github.com/Omega-JS-Stack/omega/issues/425)):

- `domain.providers.<registrar>`: the registrar, `namecheap` (reconciled via API) or
  `squarespace` (manual guidance). Presence picks one; no entry means nothing chosen and this
  service skips.
- `domain.email.providers.<provider>` and `domain.email.forwarding`: the MAILBOX provider,
  `cloudflare`, `squarespace` or `privateemail`. This service does not read them: the `edge`
  service's `dns-records` and `email-routing` operations do.

Both sets are exactly the rows of ONE registry, `packages/manager/src/services/domain/lib/providers.js`,
the one place a registrar or mailbox provider is added. A registrar entry carries its API
client (`api`, null for manual) and its dashboard nameserver page (`nameserverUrl`). Its
credentials are not here: each key's `askedWhen` in the env schema says which registrar
asks for it (`chosen('domain.providers', 'namecheap')`), and the domain service asks for
what `missingEnvKeys` says it owes ([config.md](../shared/config.md)); a mailbox entry carries its MX records and match domain (`mx`,
`mxDomain`), its SPF include (`spf`), its MX comment (`label`) and whether Email Routing
forwards its mail (`routing`). The config schema declares one row per entry
(`packages/config/src/schema-domain.js`) and `test/domain-providers.test.js` holds the two
equal, so a new provider is a registry entry plus its schema row; any other key fails the
load naming `npx omega migrate`.

`domain.enabled: false` skips the service.

## Credentials

- `CLOUDFLARE_TOKEN` — always, even for a manual registrar: the required nameserver values
  come off the zone.
- `NAMECHEAP_USERNAME` + `NAMECHEAP_API_KEY` — only when the registrar is namecheap (their
  registry entries carry a `when` that drops them otherwise).

## Gotchas

- **Namecheap's API is IP-whitelisted.** The client detects its own public IP via
  `api.ipify.org`; that address must be whitelisted in the Namecheap dashboard or every call
  is refused. Since [#698](https://github.com/Omega-JS-Stack/omega/issues/698) a refusal is
  walked rather than warned: an interactive run names the IP to add, gates on Enter to open
  the [API access page](https://ap.www.namecheap.com/settings/tools/apiaccess/) (enable, key
  reset and whitelist all live there), and rechecks the refused call until it passes — ENTER
  checks now, `s` steps aside. Non-interactive and dry runs warn and continue as before.
  There is no JSON variant of the API — it is the XML query API.
- **Nameservers live at the REGISTRABLE domain.** For a subdomain project
  (`playground.omegajs.dev`) that is the parent (`omegajs.dev`) — the zone the edge service
  manages and the domain the registrar actually holds. The split uses the public suffix list,
  not a last-dot-label pop, so `mybrand.co.uk` resolves correctly.
