# The advertising service — the domain in AdSense

The `advertising` service verifies the brand's domain is present in the configured AdSense
account and reports its approval state. The AdSense Management API v2 is READ-ONLY — sites
cannot be added or configured programmatically — so the service proves presence and state and
deep-links the console for the manual half. It never mutates AdSense, which makes a dry run
identical to a normal run.

## What it reconciles

One operation, `sites`: presence with a `READY` state is the converged proof. Missing → an
interactive run opens the add-site console page and polls until the site appears;
non-interactive and dry runs warn with the deep-link. A non-READY state is warned with what
Google is waiting on:

| State | Meaning |
|---|---|
| `READY` | Serving ads. |
| `GETTING_READY` | Google is reviewing the site — a multi-day human review, so this one legitimately stays a rerun. |
| `REQUIRES_REVIEW` | Request one in the console. |
| `NEEDS_ATTENTION` | Resolve the issues in the console. |

## Config

`advertising.providers.adsense` is the home — the provider-neutral section, never a
brand-named top-level key. **A missing provider entry is a deliberate absence**: authoring
`advertising: { providers: { adsense: {} } }`, even empty, is how a brand opts in.

- `advertising.providers.adsense.client` — the `ca-pub-…` id, and the ONE AdSense switch
  ([#527](https://github.com/Omega-JS-Stack/omega/issues/527)): there is no second `enabled`
  key. The API's account id is the same value without the `ca-` prefix. Missing, with
  credentials in hand, an interactive run offers the account selection flow (create-new opens
  the AdSense signup) and lands it in omega.json5.

Because `client` is schema-typed as a string, "Disable permanently" opts the PROVIDER out
(`advertising.providers.adsense: false`) rather than landing `client: false`, which would fail
validation forever.

**Credentials**: `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` with the `adsense.readonly`
scope.

## Gotcha

AdSense lists sites at the APEX only, so an apex entry covers every subdomain of it
([#631](https://github.com/Omega-JS-Stack/omega/issues/631)) — a subdomain project matches its
parent's entry rather than needing one of its own.
