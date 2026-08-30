# The repo service — the brand's GitHub presence

The `repo` service reconciles the brand's GitHub side: the org profile, the brand-monorepo
repo, and GitHub Pages. It is the monorepo cousin of legacy omega-manager's github service,
which managed one repo per target — here a brand is ONE repo.

## What it reconciles

- **`org`** — the org profile matches the brand: display name, support email
  (`support@{domain}`), billing email, description (truncated to GitHub's 160-char org
  limit), blog URL, and `location` only when configured. Skipped for a shared org.
- **`repo`** — the repo exists with the right settings. Missing → created EMPTY (the brand
  already exists locally; the user pushes to it — no template, no clone, that is onboarding's
  job). Existing → visibility and homepage diffed, and only the drift is patched.
- **`pages`** — GitHub Pages serves the website from `gh-pages` with `brand.url` as the
  custom domain.

## Config

Everything lives under `repo.providers.github` in the brand `config/omega.json5`:

| Key | Meaning |
|---|---|
| `org` | Repo owner (org or user). No default — unset and the service skips. |
| `shared` | `true` = the org is shared with other brands, so the org-level `org` operation is filtered out: one brand must not rewrite a shared org's profile. |
| `repo` | Optional `owner/name` slug or bare name. Name defaults to the brand id, owner to `repo.providers.github.org`. |
| `private` | Repo visibility (manager default `true`). |
| `location` | Org profile location — only reconciled when set (omega-manager hardcoded a country). |

The repo identity is pure derivation from config (`@omega.js/config`'s `brandRepoName` /
`brandRepoOwner`, shared with `deploy --direct`), so nothing about it is persisted anywhere.

## Credentials

The `gh` CLI, authenticated — `gh auth login`, or a `GH_TOKEN`/`GITHUB_TOKEN` in the brand
`.env` (loaded before services run; `gh` honors both). The client verifies `gh` is installed
and authenticated at construction, and every invocation is `execFileSync` with an argv array
— no shell, so brand-config values can never inject commands. The service declares no entry
in the `REQUIRES` registry because it authorizes through `gh`, not through a key.

## Gotchas

- **A missing `gh-pages` branch is not an error.** It appears with the first deploy; the
  operation says "deploy the website first" and moves on.
- **An owner that is a user, not an org**, makes the `org` operation inapplicable — noted,
  not failed.
- **One Pages site per repo.** Legacy per-subdomain Pages repos (`{brand}-{sub}-website`)
  have no monorepo equivalent; multi-site hosting rides the edge/hosting story instead.
