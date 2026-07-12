# @omega.js/template-kit — the uj_* template surface as plain JS

The complete filter/tag surface of jekyll-uj-powertools (READ-ONLY reference
repo), ported to engine-neutral JavaScript for the SSG bake-off and
`@omega.js/web`. Private workspace package (`packages/template-kit`), vendored
into frameworks at prepare time like the other shared packages.

Two consumption paths (plan §4 A0):
- **Eleventy / any LiquidJS host**: `registerLiquid(engine, options)` — registers everything under the exact Jekyll-era names, so templates port verbatim.
- **Astro / direct**: import the plain functions (`filters`, `TAGS`, `jekyllCompat`) and call them.

## Filters (from `lib/filters/main.rb`)

| Name (registered) | Kind | Notes |
|---|---|---|
| `uj_strip_ads` | pure | strips `<ad-unit>` blocks + adunit includes |
| `uj_json_escape` | pure | JSON-escape, no surrounding quotes |
| `uj_random` | pure | `Math.floor(random * n)` |
| `uj_hash` | pure | **byte-parity with Ruby verified**: full 128-bit MD5 as BigInt, mod max (`'hello'→994@1000`, `'somiibo'→305@360`, checked against ruby 4.0.0) |
| `uj_title_case` | pure | Ruby per-word `capitalize` parity ("hello WORLD" → "Hello World") |
| `uj_jsonify` | pure | pretty JSON, configurable indent |
| `uj_append_param` | pure | `?`/`&`-aware query param append |
| `uj_cachebreak` | pure | appends `cb=<process-consistent ms timestamp>` |
| `uj_pluralize` | pure | singular only for exactly 1; default plural = singular+`s` |
| `uj_commaify` | pure | **deliberate divergence**: Ruby also groups decimal digits (`1234.5678`→`1,234.5,678`, a latent bug); ours commas the whole part only (`1,234.5678`) |
| `uj_increment_return` | context | per-render-context counter (WeakMap in the adapter) |
| `uj_liquify` | context | recursive Liquid render, max depth 10, no-change guard |
| `uj_content_format` | context | liquify + markdownify when `page.extension === '.md'` (markdown converter injected) |

## Tags (from `lib/tags/*.rb`) — registered names are EXACT, incl. the four unprefixed ones

| Name | Kind | Engine needs |
|---|---|---|
| `iftruthy` / `iffalsy` | block | — (nil/false/`''`/0 falsy, Ruby table) |
| `iffile` | block | `options.fileExists(path)` |
| `urlmatches` | inline | `page.url` (index.html-normalized comparison) |
| `uj_readtime` | inline | page content default; 269 wpm, min 1 |
| `uj_fake_comments` | inline | words % 13 |
| `uj_external` | inline | `site.url` |
| `uj_social` | inline | `page.resolved.socials.*` + SOCIAL_URLS data |
| `uj_language` | inline | LANGUAGES data (184 codes, machine-extracted from the Ruby) |
| `uj_translation_url` | inline | `site.translation` {default, languages, exclude} |
| `uj_icon` | inline | `options.icons.{fontAwesomeDirs,aliasFile,flagsDir}` (+ `site.icons.style`); ordered root chain (earlier dirs win), alias resolution from fontawesome-free metadata, brands fallback, flag fallback via LANGUAGE_TO_COUNTRY (43 codes), default warning-triangle SVG with warn-once, module cache — semantics shared with desktop via `@omega.js/client/modules/icon-core.js` (C4 cp108) |
| `uj_logo` | inline | `options.logos.dir`; per-instance SVG id prefixing (url()/href/xlink:href refs rewritten) |
| `uj_image` | inline | pure HTML builder (picture + webp sources + lazy placeholders; `max_width`, `webp=false`, external `<img>`) |
| `uj_video` | inline | pure HTML builder (flag attrs, mime map, lazy sources) |
| `uj_member` | inline | `options.getCollection('team')` — docs `{ id, url, data }` |
| `uj_post` | inline | `options.getCollection/getCollectionNames` — id / substring / custom `post.id` matching across collections |

Port simplification: the Ruby `member`/`post` `image-tag` property re-parsed a
`{% uj_image %}` template string; the JS calls the shared `buildImageHtml()`
directly — same output, no re-parse.

## Jekyll-compat pack (`src/jekyll-compat.js`)

Scoped by the 2026-07-06 real-usage audit (UJM theme + somiibo): the ONLY
Jekyll-specific filters used anywhere are `slugify`, `date_to_xmlschema`,
`jsonify`, `strip_html`, `markdownify`, `push` (LiquidJS ships push).
Implemented: those + `relative_url`, `absolute_url`, `date_to_rfc822`,
`number_of_words`, `where_exp`, `group_by_exp`. The `*_exp` filters implement
the SIMPLE expression subset (`item.path <op> literal`, contains, bare truthy)
— zero real usage exists; extend only if a migrating site needs it.

## Adapter contract (`registerLiquid(engine, options)`)

```js
registerLiquid(new Liquid({ jekyllInclude: true }), {
  site,                                  // the site.* global — pair with @omega.js/config's toSiteGlobal()
  getCollection: (name) => docs,         // docs: { id: '/team/x', url, data }  (Jekyll doc parity)
  getCollectionNames: () => [...],
  fileExists: (path) => boolean,
  markdown: (content) => html,           // e.g. markdown-it render
  icons: { fontAwesomeDirs, aliasFile, flagsDir, style },
  logos: { dir },
});
```

`site.*` comes from `@omega.js/config`'s **`toSiteGlobal(resolvedConfig)`**
(`packages/config/src/site-global.js`): identity mapping of the resolved
config (machinery keys `targets`/`enabled` stripped; `url` derived from
`brand.url` unless explicit; `baseurl` defaulted) — the site.* audit showed
the resolved omega.json5 shape IS the template shape. Engine-owned keys
(`site.posts`, `site.pages`, `site.data`, `site.time`, `site.collections`)
are the SSG's responsibility.

## What is deliberately NOT here

The Ruby plugin's generators/hooks (`inject-properties.rb` = `page.resolved`,
`blog-taxonomy.rb`, `dynamic-pages.rb`, `limit-collections.rb`,
`parallel-build.rb`, `markdown-images.rb`) are ENGINE features, not template
functions — each bake-off candidate maps them natively (Eleventy: data
cascade / eleventyComputed; Astro: helpers). Plan §4 A1.

## Usage numbers that set the porting priority (2026-07-06 audit)

UJM theme/blueprints: `uj_icon` 612, `iftruthy` ~370, `uj_content_format` 97,
`iffalsy` 72, `uj_liquify` 71, `uj_member` 62, `uj_cachebreak` 34,
`uj_title_case` 27, `urlmatches` 19, `uj_commaify` 18, `uj_post` 17,
`uj_readtime` 15, everything else single digits. somiibo adds only
`uj_icon`/`uj_liquify`/`uj_content_format` + iftruthy/iffalsy/urlmatches.
