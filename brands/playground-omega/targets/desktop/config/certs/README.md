# `config/certs/`: signing material on a RUNNER, and nothing else

**Never commit anything in this directory.** The target's `.gitignore` ignores everything here except this file, which is tracked so the explanation travels with the repo.

## Locally: nothing lives here

Signing material is READ IN PLACE from the signing tree ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)), never copied into a target:

```
<company root>/company/.omega/certificates/apple/    # first, when the brand names a company
<brand root>/.omega/certificates/apple/              # second
```

The `omega manage --service certificates` walk produces that tree, and every desktop boot (the CLI and gulp alike) derives the paths into it once, through `@omega.js/devkit/signing-env`:

| Env var | Derived from |
|---|---|
| `CSC_LINK` | `certificates/DEVELOPER_ID_APPLICATION_G2.p12` in the tree, when `CSC_KEY_PASSWORD` opens it |
| `APPLE_API_KEY` | `AuthKey_<APPLE_API_KEY_ID>.p8` in the tree |

So the build, `omega validate-certs` and the deploy precheck's secret publish all read one answer. An EXPLICIT `CSC_LINK` or `APPLE_API_KEY` in the env always wins, and with neither set nor derivable, electron-builder falls back to macOS Keychain identity discovery.

There is no provisioning profile: Developer ID is DIRECT distribution, signed and notarized, and needs none.

## On the runner: this directory is the decode target

The generated `.github/workflows/build.yml` decodes the pushed base64 secrets back to disk here (`config/certs/dev-id.p12`, `config/certs/AuthKey.p8`) and points `CSC_LINK` / `APPLE_API_KEY` at the decoded files. `omega deploy`'s precheck is what pushes those secrets; a mac leg with either secret missing exits 1 rather than shipping an unsigned app.

## The rest of the signing set

These are values, not files, and live in the brand `.env` (never here):

- `CSC_KEY_PASSWORD`: the password for the `.p12`
- `APPLE_API_KEY_ID`: 10-char Key ID (it also names the `.p8` file in the tree)
- `APPLE_API_ISSUER`: issuer UUID from App Store Connect
- `APPLE_TEAM_ID`: 10-char team ID from developer.apple.com

Windows keeps no file here at all: the self-hosted EV USB token is addressed by `WIN_EV_TOKEN_PATH` / `WIN_CSC_KEY_PASSWORD`, and each cloud provider by its own env set.

For the whole picture see [`docs/signing.md`](../../docs/signing.md).
