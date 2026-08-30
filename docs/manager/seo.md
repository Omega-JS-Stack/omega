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

Per item, `author.token` (`env:VAR_NAME` or a literal) overrides the `gh` auth for that item's
API calls, and `author.git` rides the Contents API commits as author and committer — parasite
repos owned by separate accounts.

**Credentials**: the default `gh` CLI auth, plus those per-item author overrides.

## Gotcha: the collision guardrail

A parasite repo this handler created contains only the template's files, so before ANY write
the existing tree is inspected: more than ten non-template ("stale") files means the configured
name collides with a REAL repo, and the item ERRORS without touching anything. Legitimate
parasite repos sit at zero to two stale files after a template change. **Never reuse a real
repo's name for a parasite entry.**
