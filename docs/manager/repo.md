# The repo service — the brand's GitHub presence

The `repo` service reconciles the brand's GitHub side: the org profile, the brand-monorepo
repo, GitHub Pages, and the org runner group a public desktop brand's release actually runs
on. It is the monorepo cousin of legacy omega-manager's github service,
which managed one repo per target — here a brand is ONE repo.

## What it reconciles

- **`org`** — the org profile matches the brand: display name, support email
  (`support@{domain}`), billing email, description (truncated to GitHub's 160-char org
  limit), blog URL, and `location` only when configured. Skipped for a shared org.
- **`repo`** — the repo exists with the right settings. Missing → created EMPTY (the brand
  already exists locally; the user pushes to it — no template, no clone, that is onboarding's
  job). Existing → visibility and homepage diffed, and only the drift is patched. A
  `default_branch` of `gh-pages` is patched back to `main` when a `main` branch exists
  ([#872](https://github.com/Omega-JS-Stack/omega/issues/872); the deploy lane's `waitForWorkflow` applies the same rule from its side, on a first miss, [deploys.md](../shared/deploys.md)): built output is never the default branch, and a dispatch reads the
  workflow off whatever branch that key names.
- **`pages`** — GitHub Pages serves the website from `gh-pages` with `brand.url` as the
  custom domain.
- **`runners`** ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)): the org's Actions runner groups allow this repo. It runs
  only where all three hold: the brand has a desktop target, the repo is PUBLIC
  (`repo.providers.github.private: false`), and the Windows signing strategy is `self-hosted`
  (`targets.desktop.platforms.win.signing.strategy`, absent = self-hosted). Then it reads the
  owner's account type and, for an organization, `GET /orgs/{org}/actions/runner-groups`. No
  group with `allows_public_repositories: true` FAILS the walk, naming the checkbox and the
  settings link. A personal-account owner has no runner groups and skips; a 403/404 reading
  them (a token without the org-admin scope) warns with the same link. A group that allows
  public repositories but is scoped to selected repositories (`visibility: selected`) is read
  one level deeper ([#879](https://github.com/Omega-JS-Stack/omega/issues/879)):
  `GET /orgs/{org}/actions/runner-groups/{id}/repositories`, and a brand repo the list leaves
  out FAILS the walk exactly the same way (unless a later allowing group serves it), because the dispatch queues forever with the
  checkbox green. A 403 on that read warns with the link, like the groups read.

## Config

Everything lives under `repo.providers.github` in the brand `config/omega.json5`:

| Key | Meaning |
|---|---|
| `org` | Repo owner (org or user). No default — unset and the service skips. |
| `shared` | `true` = the org is shared with other brands, so the org-level `org` operation is filtered out: one brand must not rewrite a shared org's profile. |
| `repo` | Optional `owner/name` slug or bare name. Name defaults to `<brand.id>-omega` (the `<brand.id>-<role>` rule, [#809](https://github.com/Omega-JS-Stack/omega/issues/809)), owner to `repo.providers.github.org`. |
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
- **An owner that is a user, not an org**, makes the `org` and `runners` operations
  inapplicable — noted, not failed.
- **The runner-group check FAILS LOUDLY, and never flips the setting** (Ian's ruling,
  2026-09-10). An org runner group refuses public repositories by default, a brand repo is
  public the moment it serves gh-pages, and GitHub accepts the dispatch anyway: the
  windows-sign job simply never starts, with no error anywhere. The checkbox belongs to the
  org owner and flipping it needs org-admin rights, so the walk stops on the message instead
  of guessing. Fix it at
  `https://github.com/organizations/<org>/settings/actions/runner-groups` ("Allow public
  repositories" on the group), then re-run.
- **One Pages site per repo.** Legacy per-subdomain Pages repos (`{brand}-{sub}-website`)
  have no monorepo equivalent; multi-site hosting rides the edge/hosting story instead.
