# Code Signing

Cross-platform code signing reference. Covers macOS (sign + notarize), Windows (EV token + cloud), and Linux (no signing required for AppImage/deb but Snap/Flatpak have their own conventions).

## tl;dr

- **macOS production**: Developer ID Application cert + notarization API key. Files in `config/certs/`. Env vars point at them.
- **Windows production**: EV USB token (self-hosted runner now) or cloud signing (future, pluggable via `platforms.windows.signing.strategy`).
- **Linux**: No signing for AppImage/deb. Snap/Flatpak have their own pipelines.

## Where files live

Signing material lives in the SIGNING TREE and is read there, never copied into a target
([#891](https://github.com/Omega-JS-Stack/omega/issues/891)):

```
<company brand>/company/.omega/certificates/apple/   # read FIRST when the brand names a company
<your brand>/.omega/certificates/apple/              # read second
  certificates/DEVELOPER_ID_APPLICATION_G2.p12       # what CSC_LINK resolves to
  certificates/DEVELOPER_ID_INSTALLER_G2.p12         # only for .pkg builds (rare)
  AuthKey_XXXXXXXXXX.p8                              # what APPLE_API_KEY resolves to

<your-app>/
  build/
    entitlements.mac.plist             # universal, already in @omega.js/desktop defaults
    icon.icns / icon.ico / icon.png    # per-brand
  config/certs/                        # gitignored, and EMPTY on a developer machine:
                                       # only a RUNNER writes here, decoding the pushed secrets
    README.md                          # the ONE tracked file here (#913): it says the above
  .env                                 # gitignored, and it carries no signing PATH: only
                                       # CSC_KEY_PASSWORD and the APPLE_* three
```

There is no provisioning profile: Developer ID is direct distribution, signed and notarized,
and needs none.

## Where the macOS certificate comes from (the lookup order)

Every desktop boot (the CLI and gulp alike) derives the signing paths ONCE, at the env load
([src/utils/load-env.js](../src/utils/load-env.js), over `@omega.js/devkit/signing-env`), so
the build, `omega validate-certs` and the deploy precheck's secret publish all read the same
answer. `CSC_LINK` resolves in ONE order:

1. **`CSC_LINK`** in the environment — an explicit answer always wins.
2. **The COMPANY's tree**, when the brand names a company and that company is on this
   machine: a brand with a company reuses the company tree first, always
   ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)). A brand is NEVER physically
   inside its company folder: membership is its `company: { id }` key, resolved through
   `@omega.js/config`'s `resolveCompany` (the ecosystem's one company rule), and the
   certificate is one more relative path through that resolver's `file()`:
   `<company>/company/.omega/certificates/apple/certificates/DEVELOPER_ID_APPLICATION_G2.p12`.
3. **The brand's own signing tree**:
   `<brandRoot>/.omega/certificates/apple/certificates/DEVELOPER_ID_APPLICATION_G2.p12`.
   `@omega.js/manager`'s certificates service produces the tree
   ([the manager guide](../../../docs/manager/index.md)).
4. **The macOS Keychain** — electron-builder's own identity auto-discovery.

`APPLE_API_KEY` follows the same order for `AuthKey_<APPLE_API_KEY_ID>.p8` (an unset id means
there is no filename to look for). Both derived values are ABSOLUTE paths into the tree.

**Keychain stays the default.** A project with no signing tree resolves to it exactly as
before. Two further conditions keep a build on the Keychain rather than handing
electron-builder a file it cannot use: no `CSC_KEY_PASSWORD` in the `.env` cascade, or a
password that does not OPEN the `.p12` (verified with `openssl pkcs12 -legacy`, retried
without the flag for LibreSSL — stock macOS openssl — which reads legacy containers but
rejects the flag; a missing openssl is named as the reason rather than blamed on the
password). Either case prints one line naming the file and the reason, and leaves the key
unset rather than failing the build silently.

The password itself never lives in config: `CSC_KEY_PASSWORD` comes from the `.env`
cascade (the manager's certificates service writes it to the signing root's `.env`),
and the config validator hard-fails secret-shaped config keys.

## What's universal vs per-brand

**Universal (one set per Apple Developer team / Windows signing identity):**
- Developer ID Application cert (`.p12`)
- Developer ID Installer cert (`.p12`) — only if you ship `.pkg`
- App Store Connect API key (`.p8`)
- Apple Team ID, Apple ID, app-specific password
- Windows EV USB token

**Per-brand (per app):**
- Provisioning profile (`.provisionprofile`) — only required if your app uses entitlements that Apple gates (push notifications, in-app purchase, network extensions, app groups, etc.)
- Icons (`icon.icns`, `icon.ico`, `icon.png`)

So for ITW Creative Works' multiple Electron apps signed by the same team, you generally drop the **same** `developer-id-application.p12` and `AuthKey_*.p8` into each app's `config/certs/`. The `.env` paths are identical across apps. Provisioning profiles, if needed, are unique per app.

## macOS setup

### 1. Apple Developer prerequisites

You need an Apple Developer Program membership ($99/year). Inside it:

1. **Developer ID Application certificate** — generate at Apple Developer → Certificates → `+` → "Developer ID Application." Download the `.cer`, install in Keychain Access, then export from Keychain as `.p12` with a password.
2. **App Store Connect API key** (preferred over Apple ID + app-specific password) — generate at App Store Connect → Users and Access → Keys → `+`. Download the `.p8` once (Apple won't show it again). Note the Key ID and Issuer ID shown on the page.
3. **Team ID** — visible in your Apple Developer membership page.

### 2. Drop files into your project

```bash
cp ~/Downloads/developer-id-application.p12 config/certs/
cp ~/Downloads/AuthKey_XXXXXXXXXX.p8        config/certs/
```

### 3. Wire `.env`

```bash
CSC_LINK=config/certs/developer-id-application.p12
CSC_KEY_PASSWORD=<password you set on export>

APPLE_API_KEY=config/certs/AuthKey_XXXXXXXXXX.p8
APPLE_API_KEY_ID=XXXXXXXXXX             # 10 chars from key filename
APPLE_API_ISSUER=00000000-0000-...      # UUID from App Store Connect

APPLE_TEAM_ID=XXXXXXXXXX
```

> **Empty values are safe.** The `.env` template ships these as `CSC_LINK=""` placeholders; @omega.js/desktop deletes empty/whitespace signing vars after loading `.env` (`src/utils/sanitize-signing-env.js`) so they read as *unset*. Without the guard, app-builder-lib only null-checks — `importCertificate('')` resolves `''` to the project root and the build dies with `"<projectRoot> not a file"`. With no `CSC_LINK` at all, electron-builder falls back to Keychain identity auto-discovery (so local `package:quick` builds still sign when an identity is installed).

### 4. Verify

```bash
npx omega validate-certs
```

This checks:
- `CSC_LINK` exists and is readable
- macOS Keychain has a Developer ID Application identity, and ONLY when `CSC_LINK` names no certificate: electron-builder imports a `CSC_LINK` `.p12` into its own temporary keychain, so the login keychain says nothing about that build
- API key file exists and `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` are set
- Team ID matches the cert

The electron-builder floor is 26.16.1 (the package's peer range, installed by ensure-target for any consumer below it): every earlier build hands the `.p12` password to `security set-key-partition-list`, which wants the temporary keychain's own password, and the macos-26 runner image rejects the mismatch (electron-userland/electron-builder#10066, [#891](https://github.com/Omega-JS-Stack/omega/issues/891)).

### 5. Build + notarize

```bash
npm run release   # signs + notarizes + publishes
```

@omega.js/desktop's built-in notarize is wired as electron-builder's `afterSign` hook (via `gulp/build-config`) and calls `@electron/notarize` with the API key creds. Consumers can extend it with an optional `hooks/notarize/post.js` for post-notarization work.

## Windows setup

### Self-hosted EV USB token (recommended for v1)

Buy an EV code-signing cert from Sectigo, DigiCert, SSL.com, etc. Get a physical USB token (you can't transfer EV certs).

1. Plug the token into a Windows machine that's registered as a self-hosted GitHub Actions runner labeled `windows`, `self-hosted`, `ev-token`.
2. Install the token's middleware (SafeNet, etc.) on that machine.
3. Set `.env` (on the runner):
   ```
   # config: { signing: { windows: { strategy: 'self-hosted' } } }
   WIN_EV_TOKEN_PATH=<cert SHA1 thumbprint, or a path to a .pfx>
   WIN_CSC_KEY_PASSWORD=<token PIN>
   ```
4. The `windows-sign` job in `.github/workflows/build.yml` will route signing to that runner.

Setting the box up is [`docs/runner.md`](runner.md) — the runner home, the Startup-folder auto-start, the commands, and the Session 0 / Session 1 rule that makes the whole thing work.

**A workflow that targets this runner fires only on dispatch**, and the box enforces it ([#875](https://github.com/Omega-JS-Stack/omega/issues/875)). Whoever can start a job on the signing box can sign binaries with your token, so two guards stand between a stray trigger and `signtool`:

- The generated `windows-sign` job runs only on `workflow_dispatch`, the one trigger the file carries (#923). A `push` or `pull_request` trigger added to `build.yml` later SKIPS the sign job instead of signing what it built.
- The runner itself refuses the job before its first step. `npx omega runner install` writes `job-started.js` beside the runner and points every registration's `ACTIONS_RUNNER_HOOK_JOB_STARTED` at it; the hook exits nonzero, failing the job with one line, unless the event is a dispatch, `GITHUB_REPOSITORY` is on `allowed-repos.txt` and `GITHUB_ACTOR` is on `allowed-actors.txt`. Both lists live on the box and are yours to edit ([`docs/runner.md`](runner.md) § One-time setup).

`npx omega sign-windows` is the strategy-aware command that drives `signtool` (or the cloud provider CLI).

Every signed artifact is verified before the job moves on, and the log says so in the mac lane's shape: `Signed and verified: signtool verify /pa accepts <file>.` mirrors macOS's `Stapled and verified: ...`, so a deploy log proves the Windows signature was checked rather than only claimed ([#918](https://github.com/Omega-JS-Stack/omega/issues/918)). A failing verify aborts the job.

### Cloud signing (future migration)

Once the framework's cloud strategy is finalized, set the provider in `config/omega.json5`:
```
# config: { targets: { win: { signing: { strategy: 'cloud', cloud: { provider: 'azure' } } } } }
# provider: 'azure' | 'sslcom' | 'digicert'
# Provider-specific creds (secrets) live in .env Custom Values section.
```

Provider modules will live in `src/lib/sign-providers/{azure,sslcom,digicert}.js` (Pass 3 work).

### Local (developer-machine) fallback

If no signing runner is available, CI uploads the unsigned `.exe` and a developer manually signs locally:
```
# config: { signing: { windows: { strategy: 'local' } } }
```

## Pushing secrets to GitHub Actions

`omega deploy`'s precheck pushes the target's **composed env** to the repo's GitHub Actions secrets over the same shared `gh` transport the other three frameworks use (`gh secret set`, which seals each value with the repo's public key locally): values travel on **stdin**, never in argv, and are never logged. For env vars whose value is a path to a local file (`.p12`, `.p8`, etc.), the secret value pushed is the **base64-encoded file contents**: the workflow decodes back to a temp file at job start.

There is no standalone `omega push-secrets` verb ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)): the push happens where it matters, and the manage walk's `repo` service runs the same function when you want a brand brought current without deploying.

```bash
# Make sure the brand root's .env holds CSC_KEY_PASSWORD + the APPLE_* three, and `gh auth login` has run
npx omega deploy

# See exactly what it would publish, and publish nothing
npx omega deploy --dry-run
```

Behavior:
- The source is `composeTargetEnv({ targetDir, target: 'desktop' })`: company `.env` ← brand `.env` ← target `.env`, the brand-side layers filtered by the env schema to the keys the desktop target reads. The brand root's `.env` is the one file you keep; a target `.env` is an optional per-key override.
- Files only — the shell is never a source — and an empty value never claims a key, so unset keys simply don't publish.
- Auto-detects "is this a path?" — relative or absolute paths ending in `.p12`/`.pem`/`.cer`/`.p8`/`.provisionprofile`/`.crt`/`.key`/`.json` that exist on disk (target root first, brand root second) get base64-encoded.
- Publishes to the brand's SOURCE repo (`repo.org` + `brand.id` → `<brand.id>-omega`), and REFUSES unless the checkout's own remote IS that repo: a fork, a template clone or a vendored target never arms a stranger's Actions with your certificates.
- No PAT: the credential is `gh`'s auth session. A missing or signed-out `gh` fails loudly with install/auth instructions; a CI run, an empty cascade or a remote-less checkout skips loudly, and a checkout whose `origin` is not the derived source repo refuses on the one drift line (`origin is <slug> but config derives <derived>: ...`, [#934](https://github.com/Omega-JS-Stack/omega/issues/934)).
- `CSC_LINK` and `APPLE_API_KEY` are DERIVED, never typed ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)): the env load resolved them from the signing tree, so the publish sends those files' bytes. A typed value still wins, and a key the config REQUIRES that neither the tree nor the `.env` answers STOPS the deploy (the step is `fatal`), naming both tier paths it looked in and `omega manage --service certificates`, publishing nothing.
- Logs key NAMES only; never a value.

The corresponding decode step in CI looks like:

```yaml
- name: Decode signing assets
  run: |
    mkdir -p config/certs
    echo "${{ secrets.CSC_LINK }}" | base64 --decode > config/certs/dev-id.p12
    echo "${{ secrets.APPLE_API_KEY }}" | base64 --decode > config/certs/AuthKey.p8
  env:
    CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
    APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
    APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
    APPLE_TEAM_ID:    ${{ secrets.APPLE_TEAM_ID }}
- name: Build and release
  run: npm run release
  env:
    CSC_LINK:         config/certs/dev-id.p12
    APPLE_API_KEY:    config/certs/AuthKey.p8
    GH_TOKEN:         ${{ secrets.GH_TOKEN }}
```

This is wired up automatically in the `.github/workflows/build.yml` template (lands in Pass 3).

## CI integration

GitHub Actions secrets you'll need (per repo):

| Secret | Purpose |
|---|---|
| `GH_TOKEN` | Cross-repo publish, secret rotation |
| `CSC_LINK` | base64-encoded `.p12` (workflow decodes to file) |
| `CSC_KEY_PASSWORD` | `.p12` password |
| `APPLE_API_KEY` | base64-encoded `.p8` |
| `APPLE_API_KEY_ID` | Plain string |
| `APPLE_API_ISSUER` | UUID |
| `APPLE_TEAM_ID` | 10-char team ID |
| `WIN_EV_TOKEN_PATH` | Windows EV cert reference — SHA1 thumbprint or `.pfx` path (the ONE name; the `WIN_CSC_LINK` alias is gone) |
| `WIN_CSC_KEY_PASSWORD` | EV token PIN / `.pfx` password |
| `SIGNTOOL_PATH` | Full path to `signtool.exe` on the signing runner |

The workflow base64-decodes secrets into temp files inside `config/certs/` at job start, runs the build, and the runner's ephemeral filesystem cleans up afterward. Local `.env` files are never committed and never shipped.

## Troubleshooting

### "Could not find a certificate" on macOS
- Run `security find-identity -v -p codesigning` — you should see "Developer ID Application: <your name> (TEAMID)".
- If absent: re-import your `.p12` to Keychain Access and make sure the private key is included.

### Notarization timeout
- Confirm `APPLE_API_KEY` is the absolute path (or relative to repo root) and the file is readable.
- Confirm `APPLE_API_KEY_ID` matches the `XXXXXXXXXX` portion of the `AuthKey_XXXXXXXXXX.p8` filename.
- Confirm `APPLE_API_ISSUER` is the issuer UUID from App Store Connect → Users and Access → Keys.

### "Hardened runtime requires entitlements"
- @omega.js/desktop generates `dist/config/entitlements.mac.plist` from defaults + your overrides at build time.
- Defaults cover Electron's needs (allow-jit, network client/server, library validation off, etc.).
- To override or add: set the `entitlements.mac` block in `config/omega.json5`. Setting a key to `null` removes a default.
  ```json5
  entitlements: {
    mac: {
      'com.apple.security.cs.allow-jit': false,           // override default
      'com.apple.security.device.camera': true,           // add a key
      'com.apple.security.network.server': null,          // remove a default
    },
  }
  ```

### Windows: "SignTool Error: No certificates were found"
- Token unplugged or middleware not running.
- For cloud: verify `platforms.windows.signing.cloud.provider` in `config/omega.json5` matches the provider whose creds are in `.env`.

## What lives in `build/`

`build/` in a consumer project holds **only** code-signing certificate files. Everything else (entitlements, icons, electron-builder config) is generated by @omega.js/desktop into `dist/config/` at build time.

- **`config/certs/`** — `.p12`, `.p8`, `.cer`, `.mobileprovision` files. Per-developer / per-CI-runner. **Never commit** — `.gitignore` blocks them.
- **Nothing else.** `entitlements.mac.plist` is generated. App icons + DMG background + tray icons resolve from `config/icons/` (consumer override) → @omega.js/desktop's bundled defaults. `electron-builder.yml` is generated.

The only file you usually create yourself in `build/` is the cert files in `config/certs/`. See [`config/certs/README.md`](../src/defaults/config/certs/README.md) for the full inventory.

## Related docs

- [`config/certs/README.md`](../src/defaults/config/certs/README.md) — cert file inventory
