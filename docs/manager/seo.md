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
sidecar whose keys merge OVER the config's `seo` section (the `chatsy.md` / `replyify.md`
convention: big content sections get their own file). `seo.enabled: false` skips the service,
and no content at all is a clean skip — this service never WRITES config, so nothing is
auto-created for a brand that declared nothing.

Per item, `owner` names the GitHub user or org its repo lives under (default: the brand's
`repo.owner`), `author.token` (`env:VAR_NAME` or a literal) overrides the `gh` auth for that item's
API calls, and `author.git` rides the Contents API commits as author and committer — parasite
repos owned by separate accounts.

Every key an item takes is a schema rule (`seo.github.content.<key>`): `name`, `owner`,
`template`, `title`, `description`, `features`, `custom`, `topics`, `cta` (`platform`, `url`)
and `author` (`token`, `git`). The strict check refuses any other key on an item, one line per
path with its position (`config.seo.github.content[0].org`, the standard line of
[config.md](../shared/config.md) § Validation): the loader for `config/omega.json5`, and the
service itself for the merged section, after it reads the sidecar and before any API call. The
old `org` is one such key, and `npx omega migrate --execute` at the brand root moves it to
`owner` in both files. `author.token` belongs in the sidecar: in `config/omega.json5` the
secret-key check refuses a key named `token`.

**Credentials**: the default `gh` CLI auth, plus those per-item author overrides. A headless walk
with a signed-out `gh` skips the service like a missing key, naming `GH_TOKEN`.

## Gotcha: the collision guardrail

A parasite repo this handler created contains only the template's files, so before ANY write
the existing tree is inspected: more than ten non-template ("stale") files means the configured
name collides with a REAL repo, and the item ERRORS without touching anything. Legitimate
parasite repos sit at zero to two stale files after a template change. **Never reuse a real
repo's name for a parasite entry.**
