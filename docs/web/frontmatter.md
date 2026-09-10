# Page frontmatter — every key, by family

What a page (or a layout, or a collection document) may put between its `---`
fences, and what each key drives — with the page-only guards called out where
they are page-only. Ratified by Ian on 2026-08-26
([#607](https://github.com/Omega-JS-Stack/omega/issues/607)).

The whole contract in one line: **frontmatter is page machinery and page
overrides — never page content.** Content lives in the body, as `{% section %}`
calls ([sections.md](sections.md)). A key outside the families below is content
in frontmatter, a lane that does not exist: the build strips it from the
cascade with a warning and sections never see it.

The engine's allow-list is `PAGE_FRONTMATTER_ALLOW` in
[engine.js](../../packages/web/src/engine.js); `test/scaffold-example.test.js`
pins the scaffolded walkthrough against it, so this page and that file can
never drift from the code.

## The three namespaces a template reads

| Namespace | What it is |
|---|---|
| `resolved.config.*` | the WHOLE brand config for this target, with this page's `config:` block merged over it |
| `resolved.meta.*` | the page's meta walk: page `meta:` → layout `meta:` → `brand.name` / `brand.description` |
| `site.*` | BUILD FACTS only (collections, the build stamp, the curated targets view) — never config |

Root `config:` / `meta:` in frontmatter are the page's own INPUT; `resolved.*`
is the OUTPUT after global, layout and page. Details:
[index.md](index.md).

## `config:` — omega.json5, overridden for this page

Everything from the brand's `config/omega.json5` that this page wants
different, merged over the resolved config for this page alone
([docs/shared/config.md](../shared/config.md)):

```yaml
---
layout: frontend/core/base
permalink: /quiet
config:
  inbound:
    chat:
      providers:
        chatsy:
          enabled: false
---
```

The rule runs BOTH ways, and both directions fail the build naming the file and
the key:

- **In the config file means under `config:`.** A config section restated BARE
  (`theme:` at the top level of frontmatter) is a build ERROR — it would look
  like an override and reach nothing. `omega migrate`'s `config-parent` rule
  moves a legacy page's bare sections.
- **Not in the config file means not allowed under `config:`.** A key under
  `config:` that no omega.json5 section answers to (`config: { headline: … }`)
  is a build ERROR — it merges into `resolved.config` and nothing reads it.

The two directions do not cover the same files: the bare-restate direction runs
on real PAGES only (files under `pages/`), so a collection document — whose
frontmatter IS the document, and which may legitimately name a field after a
config section — gets the stray-key direction alone, over its `config:` block.

A `config:` block that is not a MAP of sections at all (the empty key `config:`,
a list, a scalar) is a build ERROR on every template that carries frontmatter:
any other shape REPLACES the merged config for that page instead of merging over
it, and every `resolved.config.*` read on it would render empty.

A brand section with no schema rule YET is still config: the check is "the
schema declares it, or this brand's own omega.json5 carries it".

Two `theme` keys are page switches the app shell honours per page
(`backend/core/base.html`): `config: { theme: { sidebar: { enabled: false } } }`
drops the rail and its topbar toggles, and `theme.topbar.enabled: false` drops
the topbar. The shell-chrome contract behind them:
[docs/shared/theming.md](../shared/theming.md) § classy v2 (the app chrome
paragraph, [#740](https://github.com/Omega-JS-Stack/omega/issues/740)).

## `meta:` — the page's `<head>`

Page frontmatter is the ONLY home of meta (Ian 2026-08-26: meta never exists in
two places). omega.json5 declares no `meta` section, and a config still
carrying one is a retired-key error naming the move. The site-wide default is
`brand.name` / `brand.description`, which `core/_includes/core/head.html` falls
back to when nothing sets a value.

| Key | Drives |
|---|---|
| `title` | `<title>` + `og:title`. Unset → `brand.name` |
| `description` | the description meta + `og:description`. Unset → `brand.description` |
| `image` | `og:image` / `twitter:image`. Unset → `brand.images.social`, then `brand.images.brandmark` |
| `keywords` | the keywords meta (comma-separated). Unset emits none |
| `index` | `false` marks the page `noindex` AND drops it from `sitemap.xml`, `pages.json` and `llms.txt`: ONE decision, every signal ([#564](https://github.com/Omega-JS-Stack/omega/issues/564)). The site-wide default is the SAME key one level up, `targets.web.meta.index` in omega.json5 (Ian's same-name ruling 2026-09-09): its literal `false` seeds every page, and this key still wins BOTH directions, so `true` here indexes one page of an otherwise dark site. There is no separate sitemap opt-out: the sitemap follows this flag |
| `viewport` | overrides the framework viewport meta |
| `referrer` | overrides the framework referrer policy meta |
| `twitter_card` | the card type (`summary_large_image` by default) |
| `og_image_width` / `og_image_height` | the og image dimensions (1200 × 630 by default) |
| `breadcrumb` | the breadcrumb label the legal/blueprint layouts render |

Values may carry Liquid (`title: "About - {{ resolved.config.brand.name }}"`).
One exception: a `meta:` value may not read the walk it feeds
(`{{ resolved.meta.title }}` inside `meta:`) — the page ships the literal
`{{ … }}`; `omega migrate` DROPS such a read, key and all, because absence
already falls through to the brand default
([#671](https://github.com/Omega-JS-Stack/omega/issues/671)).

## Page mechanics

The plumbing Eleventy itself reads. Filtered before the meta-only guard runs,
so these are legal on any page.

| Key | Drives |
|---|---|
| `layout` | which layout renders the page chrome (a plain layered name — `frontend/core/base`) |
| `permalink` | the URL, when it is not the file path |
| `tags` | Eleventy collection membership (a document under `_<collection>/` is tagged by directory automatically) |
| `pagination` | Eleventy pagination (`data`, `size`, `alias`) — the alias binds per page in `resolved` |
| `templateEngineOverride` | the template engine, when it should not be inferred from the extension |
| `eleventyExcludeFromCollections` | keeps the page out of `collections.*` (paginated defaults carry it literally) |

## Layout machinery

Shipped contracts a page configures the same way a layout does.

| Key | Drives |
|---|---|
| `schema` | JSON-LD blocks in `core/foot.html`: `schema.software_application.{enabled, name, description, application_category, operating_system, price, price_currency, features, hash_seed}` and `schema.faq_page.{enabled, items}` |
| `redirect` | the `modules/utilities/redirect` layout's target: `redirect.url` (default: the site url) and `redirect.querystring` |

`sitemap` is GONE ([#564](https://github.com/Omega-JS-Stack/omega/issues/564)):
"indexable but out of the sitemap" no longer exists as a concept, so
`sitemap.include` is off the allow-list and a page that carries it is stripped
with the meta-only warning. Use `meta.index: false`, which every machine file
reads. A collection entry (`_posts/`, `_team/`) may still carry `sitemap.lastmod`,
`sitemap.changefreq` and `sitemap.priority`; sitemap.html reads those three tuning
keys and nothing else from the block. The framework's own automatic exclusions (drafts, the `/test` dev
surfaces, `/admin/`, redirect-layout pages, a listing's pages 2..N) are the
ENGINE's: it resolves one `meta.index` per page and the robots tag, the
sitemap, `pages.json` and `llms.txt` all print that same value.

## What is NOT frontmatter

- **Page CONTENT.** Section args live in the `{% section %}` call, in the body.
  A content key in a page's frontmatter is stripped with a warning.
- **`append`.** The legacy UJM add-below flag is DELETED (#607): a page body
  REPLACES the layout's default `{% composition %}`, and a page that wants the
  default bands writes them — `omega customize <url>` materializes exactly
  that. `omega migrate` drops the key with a finding.
- **Band data for a SHELL layout.** That is the page's sidecar data file,
  `<page>.11tydata.*` ([#269](https://github.com/Omega-JS-Stack/omega/issues/269)) —
  same cascade position, arrays REPLACE.
