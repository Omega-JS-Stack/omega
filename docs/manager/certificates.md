# The certificates service — Apple signing material

The `certificates` service reconciles Apple signing certificates, bundle IDs, and provisioning
profiles for brands with a desktop or mobile target, via the App Store Connect API. It is the
only thing that WRITES the signing tree; nothing copies the tree anywhere, because every reader
reads it in place ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)).

## The signing home: two tiers

ONE Apple account signs everything a company ships, so a brand that names a company
(`company: { id }`, [#677](https://github.com/Omega-JS-Stack/omega/issues/677)) shares that
company's signing tree, inside the company brand's own `company/` folder; a standalone brand
keeps it brand-local, and the material simply moves into the company tree when one is born.

The resolution is TWO-tier ([#892](https://github.com/Omega-JS-Stack/omega/issues/892)), and it
is ONE function every surface calls (`@omega.js/devkit/signing-tree`, also reached as
`@omega.js/devkit/certs`): the walk here, and every desktop reader through the one derivation at
the env load (`@omega.js/devkit/signing-env`):

- **READ** the company tree first, the brand's own second. A type answered by the company tree
  prints `reused from company`.
- **WRITE** into the company tree when the brand has one, the brand tree otherwise. A new CSR,
  a downloaded `.cer` and an exported `.p12` all land where the company can reuse them.

Layout under the gitignored `{company tree||brandRoot}/.omega/certificates/apple/`:

```
AuthKey_*.p8                                            App Store Connect API key
certificates/{TYPE}.cer + .p12                          downloaded or created, then exported
csr/{TYPE}/{private.key,request.csr}                    PRESERVED — the issued cert pairs with this key
profiles/{BRAND_ID}/{TYPE}/{PLATFORM}.mobileprovision   per-brand — a profile binds ONE bundle ID
```

## What it reconciles

- **`api-key`** — the sanity checkpoint: which Apple account (issuer, team, key) the
  downstream operations act on.
- **`certificates`**: per cert type, REUSE before anything else (#892). Apple only issues so
  many certificates, so a valid one on the account is never minted over: it is downloaded when
  neither tier holds the `.cer` (delete it to force a re-download) and paired with a local
  private key by MODULUS (the company tier's key, then the brand's), then exported to `.p12`.
  No valid cert and automatable → created via a reused CSR, downloaded, exported; no valid cert
  and manual (`DEVELOPER_ID_*`) → the local `.cer` is validated, and a missing one prints the
  portal URL and warns. Exported `.p12` files are then imported into the macOS login keychain
  from every tier (best-effort, never in dry-run).

  Then the VALIDITY line, per type, from the ONE expiry reader
  (`certificateExpiry`, [@omega.js/devkit](../devkit/index.md)):

  | Days left | Line | Status |
  |---|---|---|
  | 30 or more | `expires 2030-11-23 (1533 days)` | success |
  | under 30 | `⚠ expires 2026-10-02 (20 days)` | **warned** (it still signs) |
  | expired | `✗ EXPIRED 2026-08-01 (42 days ago)` | **error** |

  Two more states are ERRORS ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)), not
  warnings, because the type cannot produce signing material at all and the mac build that
  reads it would ship unsigned:

  - **no paired key**: a valid certificate that no key in either tier pairs with. The message
    names the type, the expected `csr/{TYPE}/private.key` path in the company tree, and the two
    fixes: copy the key from the machine whose CSR created it, or (a truly lost key) revoke the
    certificate in the portal and re-run so a new one is issued from a CSR this machine holds.
    No create call happens on that path.
  - **export failure**: openssl refused the pair.
- **`bundle-ids`** — the brand's bundle ID exists with the required capabilities. It is
  `composeBundleId(certificates.providers.apple.bundleIdPrefix, brand.id)` — a reverse-DNS
  prefix plus the brand id with hyphens as dots. Platforms derive from the enabled targets
  (desktop → MACOS, mobile → IOS).
- **`profiles`** — provisioning profiles for the brand's bundle ID × every applicable cert
  type and platform, downloaded per brand. Device lists are fetched lazily, only when a
  development profile actually needs creating. **Developer ID types ask for NONE**
  ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)): `DEVELOPER_ID_APPLICATION` and
  `DEVELOPER_ID_APPLICATION_G2` map to a null profile type, exactly as the installer types
  always did, because Developer ID is DIRECT distribution (signed, notarized, no profile
  embedded) and a profile only carries entitlements Apple reviews. Requesting one anyway
  produced a per-brand file every build then had to be told to ignore, and a stale copy in a
  target dir was the only thing desktop's `validate-certs` had left to complain about.

## Config and credentials

| Key | Meaning |
|---|---|
| `certificates.enabled: false` | Skip. Also skipped with no desktop or mobile target. |
| `certificates.providers.apple.bundleIdPrefix` | The reverse-DNS prefix. A brand without one is ASKED ([#635](https://github.com/Omega-JS-Stack/omega/issues/635)). |
| `certificates.providers.apple.certificates` | Which cert types to reconcile. |

`APPLE_API_ISSUER`, `APPLE_API_KEY_ID`, `APPLE_TEAM_ID` in the brand `.env` are required.
`CSC_KEY_PASSWORD` is auto-generated on the first real run and persisted to the SIGNING ROOT's
`.env` (the company tree for a brand of a company: shared `.p12` files need the one shared
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
- **The per-brand profile segment matters.** The signing tree is shared in the company tree,
  but a profile binds one bundle ID: without `profiles/{BRAND_ID}/`, the company's brands
  would overwrite each other's profiles.
- **`--force-recreate` was not ported.** Delete the local `.cer` to force a re-download;
  expired certs recreate automatically.
- **The legacy seed is a one-time, by-hand copy.** A brand migrating off omega-manager copies
  the legacy `_shared/certificates/apple/` tree into the company tree (`AuthKey_*.p8`,
  `certificates/*.cer`, `csr/*/{private.key,request.csr}`; skip `_backups` and the legacy
  `.p12` files) and lets the walk re-export every `.p12` with the password it mints or reads.
  The step is in the [migration playbook](migration.md); [#885](https://github.com/Omega-JS-Stack/omega/issues/885)'s
  migrate verb automates it later.
