# @omega.js/template-kit — the omega_* template surface as plain JS

The complete filter/tag surface of jekyll-uj-powertools (READ-ONLY reference
repo), ported to engine-neutral JavaScript for the SSG bake-off and
`@omega.js/web`. Private workspace package (`packages/template-kit`), vendored
into frameworks at prepare time like the other shared packages.

**Names are `omega_*` (#44).** The Jekyll-era `uj_` spelling is retired with no
aliases: `{% uj_icon %}` is an undefined tag, `| uj_liquify` an undefined
filter, and `site.uj.*` is `site.omega.*`. A legacy consumer gets the rename
mechanically from `omega migrate`'s `legacy-prefix` rule; a shipped surface
that reintroduces one fails web's `test/legacy-prefixes.test.js` guard.

Two consumption paths (plan §4 A0):
- **Eleventy / any LiquidJS host**: `registerLiquid(engine, options)` — registers everything under the `omega_*` names (the Ruby's behavior, one spelling newer).
- **Astro / direct**: import the plain functions (`filters`, `TAGS`, `jekyllCompat`) and call them.

## Filters (from `lib/filters/main.rb`)

| Name (registered) | Kind | Notes |
|---|---|---|
| `omega_strip_ads` | pure | strips `<ad-unit>` blocks + adunit includes |
| `omega_json_escape` | pure | JSON-escape, no surrounding quotes |
| `omega_random` | pure | `Math.floor(random * n)` |
| `omega_hash` | pure | **byte-parity with Ruby verified**: full 128-bit MD5 as BigInt, mod max (`'hello'→994@1000`, `'somiibo'→305@360`, checked against ruby 4.0.0) |
| `omega_title_case` | pure | Ruby per-word `capitalize` parity ("hello WORLD" → "Hello World") |
| `omega_jsonify` | pure | compact JSON; `omega_jsonify: 2` pretty-prints at that indent; an absent value is `null` |
| `omega_append_param` | pure | `?`/`&`-aware query param append |
| `omega_cachebreak` | pure | appends `cb=<process-consistent ms timestamp>` |
| `omega_pluralize` | pure | singular only for exactly 1; default plural = singular+`s` |
| `omega_commaify` | pure | **deliberate divergence**: Ruby also groups decimal digits (`1234.5678`→`1,234.5,678`, a latent bug); ours commas the whole part only (`1,234.5678`) |
| `omega_increment_return` | context | per-render-context counter (WeakMap in the adapter) |
| `omega_liquify` | context | recursive Liquid render, max depth 10, no-change guard |
| `omega_content_format` | context | liquify + markdownify when `page.extension === '.md'` (markdown converter injected) |

## Tags (from `lib/tags/*.rb`) — registered names are EXACT, incl. the four unprefixed ones

| Name | Kind | Engine needs |
|---|---|---|
| `iftruthy` / `iffalsy` | block | — (nil/false/`''`/0 falsy, Ruby table) |
| `iffile` | block | `options.fileExists(path)` |
| `urlmatches` | inline | `page.url` (index.html-normalized comparison) |
| `omega_readtime` | inline | page content default; 269 wpm, min 1 |
| `omega_fake_comments` | inline | words % 13 |
| `omega_external` | inline | `site.url` |
| `omega_social` | inline | `page.resolved.socials.*` + SOCIAL_URLS data |
| `omega_language` | inline | LANGUAGES data (184 codes, machine-extracted from the Ruby) |
| `omega_translation_url` | inline | `site.translation` {default, languages, exclude} |
| `omega_logo` | inline | `options.logos.dir`; per-instance SVG id prefixing (url()/href/xlink:href refs rewritten) |
| `omega_image` | inline | pure HTML builder (picture + webp sources + lazy placeholders; `max_width`, `webp=false`, external `<img>`) |
| `omega_video` | inline | pure HTML builder (flag attrs, mime map, lazy sources) |
| `omega_member` | inline | `options.getCollection('team')` — docs `{ id, url, data }` |
| `omega_post` | inline | `options.getCollection/getCollectionNames` — id / substring / custom `post.id` matching across collections |

Port simplification: the Ruby `member`/`post` `image-tag` property re-parsed a
`{% omega_image %}` template string; the JS calls the shared `buildImageHtml()`
directly — same output, no re-parse.

Tag options (`src/variable-resolver.js`): a typed literal resolves TYPED —
`max_width=640` is the number 640 and `webp=false` the boolean ([#102](https://github.com/Omega-JS-Stack/omega/issues/102));
quote it (`max_width="640"`) to keep a string. A bare word keeps its literal
text unless the context has it (`class=card` works), a dotted path always
resolves, and a missing path yields `null` so a typo never renders its own
name into the page.

## Helper filters, and the retired Jekyll names (`src/jekyll-compat.js`)

omega's own template helpers live in the filter pack (`src/filters.js`) under
`omega_*` names. The contract is CORRECT BEHAVIOR, not emulation of Jekyll
internals: where Jekyll's own semantics are surprising, these do the sane thing
and the tests pin it ([#102](https://github.com/Omega-JS-Stack/omega/issues/102)).

| Name (registered) | Replaces | Notes |
|---|---|---|
| `omega_slugify` | `slugify` | the ONE slugifier (below) |
| `omega_date_xmlschema` | `date_to_xmlschema` | ISO-8601 in UTC; unparseable input passes through |
| `omega_date_rfc822` | `date_to_rfc822` | RFC-822 in UTC; unparseable input passes through |
| `omega_jsonify` | `jsonify` | compact by default (the filter table above) |
| `omega_strip_html` | `strip_html` | strips tags; script/style contents removed entirely |
| `omega_number_of_words` | `number_of_words` | whitespace-separated word count |
| `omega_where` | `where_exp` | keeps the items whose expression is truthy |
| `omega_group_by` | `group_by_exp` | buckets by the expression's VALUE, one group per distinct value in first-seen order (an absent value groups under `''`) |
| `omega_relative_url` | `relative_url` | prefixes `site.baseurl` |
| `omega_absolute_url` | `absolute_url` | prefixes `site.url` + `site.baseurl`; an absolute URL passes through |
| `omega_markdownify` | `markdownify` | renders with the injected markdown converter |

`push` comes from LiquidJS. `omega_where` and `omega_group_by` read the SIMPLE
expression subset (`item.path <op> literal`, contains, bare paths); extend it
when a site needs more.

`omega_slugify` is the ONE slugifier ([#488](https://github.com/Omega-JS-Stack/omega/issues/488)):
downcase, non-alphanumeric runs become `-`, and an apostrophe is deleted. It is
what LINKS a taxonomy term and what the term's page is GENERATED at
(`src/collections.js`), so `A&R` is `a-r` on both sides.

**The old names throw.** Each Jekyll-era name in `COMPAT_REPLACEMENTS` (old
name to new, exported from `src/jekyll-compat.js`) stays registered as a filter
that throws `[@omega.js/template-kit] <old> is a Jekyll filter: use <new> (npx
omega migrate --target=<name> --execute rewrites it)`, so an unmigrated
template fails its build with the file and replacement in the message.
Eleventy ships a universal `slugify` of its own that outranks the filters
template-kit registers; `src/engine.js` claims that name back through a plugin
as the same thrower. `omega migrate`'s `compat-filters` rule rewrites `| <old>`
to `| <new>` from the same table, inside `{{ }}`/`{% %}` spans and outside
quoted args only (prose about a filter keeps its text), and the liquid-lint names a leftover
as a `jekyll-filter` error with its replacement.

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
(`site.posts`, `site.pages`, `site.data`, `site.time`) are the SSG's
responsibility. `site.collections` is not among them ([#207](https://github.com/Omega-JS-Stack/omega/issues/207)):
it carries the `targets.web.collections` DECLARATION through the identity
mapping, and the engine reads it to generate each declared collection's pages.

## What is deliberately NOT here

The Ruby plugin's generators/hooks (`inject-properties.rb` = `page.resolved`,
`blog-taxonomy.rb`, `dynamic-pages.rb`, `limit-collections.rb`,
`parallel-build.rb`, `markdown-images.rb`) are ENGINE features, not template
functions — each bake-off candidate maps them natively (Eleventy: data
cascade / eleventyComputed; Astro: helpers). Plan §4 A1.

## Usage numbers that set the porting priority (2026-07-06 audit)

UJM theme/blueprints: `uj_icon` 612 (retired — icons are native markup since [#619](https://github.com/Omega-JS-Stack/omega/issues/619)), `iftruthy` ~370, `omega_content_format` 97,
`iffalsy` 72, `omega_liquify` 71, `omega_member` 62, `omega_cachebreak` 34,
`omega_title_case` 27, `urlmatches` 19, `omega_commaify` 18, `omega_post` 17,
`omega_readtime` 15, everything else single digits. somiibo adds only
`uj_icon`/`omega_liquify`/`omega_content_format` + iftruthy/iffalsy/urlmatches.
