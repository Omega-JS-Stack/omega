# The repo service: every repo the brand owns

The `repo` service reconciles the brand's GitHub side, in the two ROLES a brand has
([#883](https://github.com/Omega-JS-Stack/omega/issues/883)):

| Role | Repo | Holds |
|---|---|---|
| source | `<brand.id>-omega` | the monorepo the brand is written in |
| website | `<brand.id>-<target name>` | the BUILT site of one GitHub-hosted web target, served by Pages |

A third repo, `<brand.id>-releases`, exists for every brand that ships artifacts, but the
desktop lane provisions it (`deploy-precheck`), not this service.

No repo NAME is configured anywhere: every name derives from the `<brand.id>-<role>` rule
([#809](https://github.com/Omega-JS-Stack/omega/issues/809)) through `@omega.js/config`'s
`sourceRepo` / `websiteRepo` / `releasesRepo`, the same functions the deploy lanes,
the CMS and the dispatch read. A repo name that must differ is a brand id that must differ.

## Config

ONE block in the brand `config/omega.json5`, and its PRESENCE is the switch (the same rule
targets follow): no `repo` block, no repo service.

```json5
repo: {
  provider: 'github',   // optional; `github` is the only one built
  org: 'Acme-Org',      // the owner every repo the brand owns lives in
}
```

Visibility is NOT in omega.json5. The brand root's `package.json` `private` field is the one
statement of it: `true` or ABSENT is private (every brand monorepo is private by default,
Ian 2026-09-11), a literal `false` is a public brand. The walk reconciles the source repo to
that in both directions.

A web target says where it is hosted with `targets.<name>.hosting.provider` (default
`github`); a target hosted anywhere else owns no website repo here.

## What it reconciles

- **`repo`** (the source role): `<brand.id>-omega` exists, at the brand's visibility, with
  the brand description. Missing means created EMPTY: the brand already exists locally and
  the user pushes to it, so there is no template, no clone (that is onboarding's job) and no
  initial commit. No homepage either, because the brand's url belongs to the website repo
  that serves it. The step also reports the **Pages retirement**: a source repo still serving
  Pages is the pre-#883 shape, and the walk names the by-hand steps and carries a warned
  status until they are done. It never deletes Pages on its own, because a custom domain can
  be on only one repo at a time and the order is the owner's call.
- **`website`** (the website role), once per web target with `hosting.provider: 'github'`:
  `<brand.id>-<target name>` exists with the target's url as its homepage and
  `<brand.name> website (<target name>)` as its description, then Pages is pointed at the
  `gh-pages` branch with the target url's host as the custom domain. Pages cannot be
  configured before that branch exists, which the FIRST deploy pushes, so a fresh repo
  reports "Pages configures after the first deploy" and the next walk finishes the job.
- **`runners`** ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)): the org's Actions runner groups allow this repo. It runs
  only where all three hold: the brand has a desktop target, the SOURCE repo is PUBLIC (the
  brand root's `package.json` says so), and the Windows signing strategy is `self-hosted`
  (`targets.<desktop target>.platforms.win.signing.strategy`, absent = self-hosted). Then it
  reads the owner's account type and, for an organization,
  `GET /orgs/{org}/actions/runner-groups`. No group with `allows_public_repositories: true`
  FAILS the walk, naming the checkbox and the settings link. A personal-account owner has no
  runner groups and skips; a 403/404 reading them (a token without the org-admin scope) warns
  with the same link. A group that allows public repositories but is scoped to selected
  repositories (`visibility: selected`) is read one level deeper
  ([#879](https://github.com/Omega-JS-Stack/omega/issues/879)):
  `GET /orgs/{org}/actions/runner-groups/{id}/repositories`, and a source repo the list leaves
  out FAILS the walk exactly the same way (unless a later allowing group serves it), because
  the dispatch queues forever with the checkbox green. A 403 on that read warns with the link,
  like the groups read.
  Under the same three conditions the step ALSO reads the brand's composed workflows
  ([#875](https://github.com/Omega-JS-Stack/omega/issues/875)): the brand root's
  `.github/workflows/*.yml`, where GitHub actually runs them. A `push` or `pull_request`
  trigger in any workflow that puts a job on a self-hosted label gets ONE warning line naming
  the file and the trigger, because a workflow reaching the signing box fires on a dispatch and
  nothing else ([../shared/deploys.md](../shared/deploys.md)). It WARNS rather than fails: the
  file is the brand's to fix and every legitimate deploy still runs, and a stray trigger never
  softens the runner-group error it may ride with.
- **`secrets`** ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)), LAST, because it
  publishes into the repos the roles above make: every target dir the brand maps gets its
  composed `.env` set published as the SOURCE repo's Actions secrets, through the ONE function
  each framework's deploy precheck calls (`publishTargetSecrets`, `@omega.js/devkit/target-secrets`).
  The push belongs to a deploy first (that is when a runner needs them), and Ian's call was that
  it "could happen elsewhere like manage too", so a brand can be brought current without
  deploying anything. A REFUSAL (a key this brand's config requires that the cascade cannot
  value) is the operation's `status: 'error'` with the key and its fix line, and nothing is
  published on that path. A dry run prints the key NAMES it would send and issues no `gh` call.

## The website repo's visibility, and the plan rule

The website repo's visibility is NOT the brand's:

| Brand | Org plan | Website repo | Why |
|---|---|---|---|
| public | any | public | the brand publishes its source anyway |
| private | free | public | Pages on a private repo is a paid feature, and the alternative is publishing the SOURCE |
| private | paid | private | Pages serves a private repo on a paid plan, so nothing has to be public |

The plan comes from `GET /orgs/{org}` (`.plan.name`); a user owner, or an org whose plan the
token cannot read, answers `free`, the half that cannot serve private Pages. It is read ONCE
per walk, because the plan is the org's, not a target's. Every run prints which visibility it
chose and why, and a dry run prints it as the plan line:

```
create Acme-Org/acme-web (public: free plan)
pages Acme-Org/acme-web: gh-pages -> acme.com
```

This split is the whole point of #883: the built site used to force-push `gh-pages` onto the
SOURCE monorepo, so a free org had to publish its source to serve its site.

## The LOCAL side: the origin heal ([#890](https://github.com/Omega-JS-Stack/omega/issues/890))

This service reconciles GitHub. The remote your CLONE points at is healed one layer
lower, by the devkit boot prelude that runs before EVERY verb
([devkit/index.md](../devkit/index.md#boot-preludes-890)), `omega manage` included: it
asks GitHub about the repo `origin` already names, which follows GitHub's own redirect
after a transfer or a rename, and points the remote at the address that answer carries,
in one line (`origin healed from <old> to <new>`).

The redirect is the authority there, not the config, so the heal runs config or no
config. `repo.org` stays the one typed value: an owner GitHub serves the repo from that
differs from it is stated in one line (`origin lives under <owner> but repo.org is
<org>`) and nothing more. The prelude never writes config, and this service only ensures
repos UNDER `repo.org`, so a brand that really did move orgs is a `repo.org` edit by
hand.

That is why the walk needs no origin step of its own, and why a converged brand reports
zero mutations here: by the time the walk runs, the boot has already settled the remote,
and the service reconciles the repo that remote points AT. The prelude is a no-op on
everything else, silently: no `.git` at the brand root (so an in-repo fixture brand like
`brands/sandbox-brand` never has this monorepo's own remote touched), no `origin`, a
non-GitHub remote, a repo GitHub answers 404 for, or no network.

A repo this service just CREATED has no local remote yet, which is why the create line
prints the `git remote add origin` command: the heal retargets a remote, it never adds
one.

## Credentials

The `gh` CLI, authenticated: `gh auth login`, or a `GH_TOKEN`/`GITHUB_TOKEN` in the brand
`.env` (loaded before services run; `gh` honors both). The service verifies `gh` is installed
and authenticated before its first call, and every invocation is `execFile` with an argv
array (no shell), so brand-config values can never inject commands. The transport and the
repo/Pages calls are `@omega.js/devkit/github-repo`, the ONE GitHub-repo boundary the desktop
precheck and the extension publish share; the manager adds only the three org-Actions reads
the runner check makes. The service declares no entry in the `REQUIRES` registry because it
authorizes through `gh`, not through a key.

## Gotchas

- **A missing `gh-pages` branch is not an error.** It appears with the first deploy; the
  website step reports pending and moves on.
- **No brand rewrites an org profile.** One org hosts as many brands as it likes, so the org
  reconcile (and the `shared` switch that guarded it) is gone as of #883.
- **An owner that is a user, not an org**, makes the `runners` operation inapplicable, and
  reads `free` for the plan: noted, not failed.
- **The runner-group check FAILS LOUDLY, and never flips the setting** (Ian's ruling,
  2026-09-10). An org runner group refuses public repositories by default, and GitHub accepts
  the dispatch anyway: the windows-sign job simply never starts, with no error anywhere. The
  checkbox belongs to the org owner and flipping it needs org-admin rights, so the walk stops
  on the message instead of guessing. Fix it at
  `https://github.com/organizations/<org>/settings/actions/runner-groups` ("Allow public
  repositories" on the group), then re-run.
- **One Pages site per repo**, which is why each web target gets its OWN repo: two web
  targets are two repos, two Pages sites, two domains.
