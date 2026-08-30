# The certificates service — Apple signing material

The `certificates` service reconciles Apple signing certificates, bundle IDs, and provisioning
profiles for brands with a desktop or mobile target, via the App Store Connect API. It runs
before `disperse`, which copies the artifacts into the targets.

## The signing home

ONE Apple account signs everything a company ships, so a company-managed brand (the
`.omega/company.json` marker) shares the COMPANY workspace's signing tree; a standalone brand
keeps it brand-local, and the material simply moves to the company root when one is born.
Layout under the gitignored `{companyRoot||brandRoot}/.omega/certificates/apple/`:

```
AuthKey_*.p8                                            App Store Connect API key
certificates/{TYPE}.cer + .p12                          downloaded or created, then exported
csr/{TYPE}/{private.key,request.csr}                    PRESERVED — the issued cert pairs with this key
profiles/{BRAND_ID}/{TYPE}/{PLATFORM}.mobileprovision   per-brand — a profile binds ONE bundle ID
```

## What it reconciles

- **`api-key`** — the sanity checkpoint: which Apple account (issuer, team, key) the
  downstream operations act on.
- **`certificates`** — per cert type: a valid cert on the account is downloaded when the local
  `.cer` is missing (delete it to force a re-download) and its `.p12` refreshed when stale; no
  valid cert and automatable → created via a reused CSR, downloaded, exported; no valid cert
  and manual (`DEVELOPER_ID_*`) → the local `.cer` is validated, and a missing or expired one
  prints the portal URL and warns. Exported `.p12` files are then imported into the macOS
  login keychain (best-effort, never in dry-run).
- **`bundle-ids`** — the brand's bundle ID exists with the required capabilities. It is
  `composeBundleId(certificates.providers.apple.bundleIdPrefix, brand.id)` — a reverse-DNS
  prefix plus the brand id with hyphens as dots. Platforms derive from the enabled targets
  (desktop → MACOS, mobile → IOS).
- **`profiles`** — provisioning profiles for the brand's bundle ID × every applicable cert
  type and platform, downloaded per brand. Device lists are fetched lazily, only when a
  development profile actually needs creating.

## Config and credentials

| Key | Meaning |
|---|---|
| `certificates.enabled: false` | Skip. Also skipped with no desktop or mobile target. |
| `certificates.providers.apple.bundleIdPrefix` | The reverse-DNS prefix. A brand without one is ASKED ([#635](https://github.com/Omega-JS-Stack/omega/issues/635)). |
| `certificates.providers.apple.certificates` | Which cert types to reconcile. |

`APPLE_API_ISSUER`, `APPLE_API_KEY_ID`, `APPLE_TEAM_ID` in the brand `.env` are required.
`CSC_KEY_PASSWORD` is auto-generated on the first real run and persisted to the SIGNING ROOT's
`.env` (the company workspace when company-managed — shared `.p12` files need the one shared
password). `APPLE_KEYCHAIN_PASSWORD` is optional and suppresses macOS keychain prompts.

## Gotchas

- **Never rotate `CSC_KEY_PASSWORD`.** A `.p12` must carry a real password (modern macOS
  rejects an empty one with "MAC verification failed"), and rotating orphans every existing
  `.p12`.
- **The `.p8` downloads ONCE** — Apple never re-serves it. An interactive run opens the keys
  page Enter-gated and watches `~/Downloads` for a fresh `AuthKey_*.p8`, filing it into the
  signing tree; the key is auto-detected by prefix, so no path config exists.
- **`DEVELOPER_ID_*` certs have no API path.** Apple requires an Account Holder login to issue
  them, so the interactive walkthrough stages the CSR itself, opens the portal create page, and
  watches Downloads for the issued `.cer`; a headless run keeps printed guidance and converges
  on rerun.
- **The per-brand profile segment matters.** The signing tree is shared at the company root,
  but a profile binds one bundle ID — without `profiles/{BRAND_ID}/`, sibling brands would
  overwrite each other's profiles.
- **`--force-recreate` was not ported.** Delete the local `.cer` to force a re-download;
  expired certs recreate automatically.
