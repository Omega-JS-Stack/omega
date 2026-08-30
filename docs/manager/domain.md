# The domain service — the registrar points at Cloudflare

The `domain` service does one thing: make the registrar's nameservers point at the brand's
Cloudflare zone. It runs right after the `edge` service, because the values it writes are the
nameservers that zone was assigned.

## What it reconciles

One operation, `nameservers`:

1. Read the Cloudflare zone to learn its assigned nameservers.
2. **namecheap** (the one API registrar today) — read the current nameservers and set them
   when they mismatch.
3. **Manual registrars** — an ACTIVE zone proves the nameservers are already set (success); a
   pending zone prints the exact values to set and returns warned.

Since [#662](https://github.com/Omega-JS-Stack/omega/issues/662) a brand-new zone that has no
nameservers assigned yet is WAITED on rather than deferred: a bounded poll (six reads, 5s
apart) gives Cloudflare the seconds it needs, and only a zone still bare after that — or a run
with no TTY — reports warned with the rerun message.

## Config

`domain` carries TWO roles, each with its own providers block
([#425](https://github.com/Omega-JS-Stack/omega/issues/425)):

- `domain.providers.<registrar>` — the registrar. Presence picks one; no entry means nothing
  chosen and this service skips. `namecheap` is reconciled via API, everything else
  (`squarespace`, …) is manual guidance.
- `domain.email.providers.<provider>` and `domain.email.forwarding` — the MAILBOX provider.
  This service does not read them: the `edge` service's `dns-records` and `email-routing`
  operations do.

`domain.enabled: false` skips the service.

## Credentials

- `CLOUDFLARE_TOKEN` — always, even for a manual registrar: the required nameserver values
  come off the zone.
- `NAMECHEAP_USERNAME` + `NAMECHEAP_API_KEY` — only when the registrar is namecheap (their
  registry entries carry a `when` that drops them otherwise).

## Gotchas

- **Namecheap's API is IP-whitelisted.** The client detects its own public IP via
  `api.ipify.org`; that address must be whitelisted in the Namecheap dashboard or every call
  is refused. There is no JSON variant of the API — it is the XML query API.
- **Nameservers live at the REGISTRABLE domain.** For a subdomain project
  (`playground.omegajs.dev`) that is the parent (`omegajs.dev`) — the zone the edge service
  manages and the domain the registrar actually holds. The split uses the public suffix list,
  not a last-dot-label pop, so `mybrand.co.uk` resolves correctly.
