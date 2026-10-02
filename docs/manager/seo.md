# The seo service — parasite SEO repos

The `seo` service creates and maintains parasite SEO content: programmatically created GitHub
repos with templated READMEs, download scripts, and a maintenance workflow. It sits late in
the walk — low priority, no downstream dependencies.

## What it reconciles

One operation, `github-repos`, per configured item: create the repo when missing (public,
auto-init README), push the generated + static template files (content-compared, so an
unchanged file is never rewritten), delete stale non-template files, reconcile description /
homepage / topics, and star the repo as the author.

## Config

Content lives at `seo.github.content[]` in `config/omega.json5`, or in a `config/seo.json5`
sidecar (the `chatsy.md` / `replyify.md` convention: big content sections get their own file).
The sidecar is the brand root's file only (a target's own `config/seo.json5` is never read):
the config loader reads it as the brand root's `seo` section, with the same deep merge (right
after the root's `omega.json5`, before its environment overlay), the same raw-file secret check
and the same strict check. The service reads the
loaded `seo` section and never opens a file. `seo.enabled: false` skips the service, and no
content at all is a clean skip: this service never WRITES config, so nothing is auto-created
for a brand that declared nothing.

Per item, `owner` names the GitHub user or org its repo lives under (default: the brand's
`repo.owner`), `author.tokenEnv` NAMES the `.env` variable holding a GitHub token that overrides
the `gh` auth for that item's API calls, and `author.git` rides the Contents API commits as
author and committer: parasite repos owned by separate accounts. A token itself is never
written in either file. A named variable that is unset fails that item before any API call
(`seo item <name>: author.tokenEnv names <VAR>, which is not set in .env`); the walk still runs
the other items.

Every key an item takes is a schema rule (`seo.github.content.<key>`): `name`, `owner`,
`template`, `title`, `description`, `features`, `custom`, `topics`, `cta` (`platform`, `url`)
and `author` (`tokenEnv`, `git`). The strict check refuses any other key on an item, at load,
one line per path with its position (`config.seo.github.content[0].org`, the standard line of
[config.md](../shared/config.md) § Validation), in either file. Two old keys have a migrate
row, and `npx omega migrate --execute` at the brand root runs both in both files: `org` moves
to `owner`, and `author.token: "env:X"` moves to `author.tokenEnv: "X"`. A literal
`author.token`, or a bare `env:` naming no variable, is reported as refused and left in place:
put the token in `.env` and write `author.tokenEnv` by hand.

**Credentials**: the default `gh` CLI auth, plus those per-item author overrides. A headless walk
with a signed-out `gh` skips the service like a missing key, naming `GH_TOKEN`.

## Gotcha: the collision guardrail

A parasite repo this handler created contains only the template's files, so before ANY write
the existing tree is inspected: more than ten non-template ("stale") files means the configured
name collides with a REAL repo, and the item ERRORS without touching anything. Legitimate
parasite repos sit at zero to two stale files after a template change. **Never reuse a real
repo's name for a parasite entry.**
