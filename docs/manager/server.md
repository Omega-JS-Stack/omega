# The server service — the brand's entry in the company registry

The `server` service publishes the brand's registry entry to the COMPANY server's Firestore at
`brands/{brand.id}`. The company's parent backend keeps a registry of every brand it serves —
webhook fan-out and cross-brand features read it — and this keeps that entry in sync with the
brand's config. It is a company-server OPERATOR service: every other brand answers "Disable
permanently" once.

Its sibling is the [directory](directory.md) service, and the difference is deliberate: the
registry here is a full REPLACE of the framework's document, the directory is a MERGE into a
document a hub also writes.

## What it reconciles

One operation, `brands`. Only three top-level config sections cross into the registry —
`brand`, `repo`, `sponsorships` — and the document is fully REPLACED on write, so a key
removed from config disappears from the registry too. The write is diff-synced: the current
document is read first and only drift is written (omega-manager overwrote it blindly on every
run, with no dry-run guard). Equality is structural and key-order-insensitive, because a
full-replace write makes ANY difference — including an extra key in the current document —
drift.

## Config and credentials

- `server.enabled: false` (or `server: false`) — skip.
- The entry id is `brand.id`.

`SERVER_SERVICE_ACCOUNT` in the brand `.env` — a path to the company server's Firebase
service-account JSON, absolute or relative to the brand root. The service account names the
target project; omega-manager hardcoded the company project instead and read its secrets from
the company-instance `.output/` tree.

## Gotcha

Because the write is a replace, anything a human adds to a registry document by hand is
removed on the next walk. Content the framework does not own belongs on a different document —
or in the directory entry, whose write is masked.
