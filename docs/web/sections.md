# Sections & Components

The section/component library: pages are compositions of one-line calls;
markup, styles, behavior, and the arg contract live together in a folder the
framework owns. Design rationale and the arc's sequencing live in
[docs/web/omega-sections-spec.md](omega-sections-spec.md) — this doc is
the landed contract.

## The two tiers

- **Sections** — full-width page bands (`{% section "marketing/hero" %}`).
- **Components** — smaller reusable pieces (`{% component "frame/box" %}`).

Same anatomy, same resolution, same asset lanes; only the folder family and
filenames differ (`_sections/<id>/section.*` vs `_components/<id>/component.*`).

## Anatomy

```
themes/base/_sections/marketing/hero/
  section.html    ← markup (Liquid). Renders against { args } ONLY.
  section.scss    ← styles (optional) — compiles into the main sheet
  section.js      ← behavior (optional) — bundles behind DOM-presence init
  section.json5   ← { description, args, defaults, demo }
```

Ids are kebab-case category paths (`marketing/hero`, `frame/browser`) —
arbitrary nesting, validated shape, traversal rejected. The underscore folder
families mark template machinery (like `_layouts`/`_includes`) and are
excluded from Eleventy content processing.

## Resolution

First match wins, whole-folder: consumer `<src>/_sections/<id>/` → active
theme → base. A consumer overriding a section owns ALL of it (markup +
assets travel together). Theme sections live inside the installed package —
consumer git holds only the consumer's own work.

`omega customize --list` prints those paths (with their owning layer and your
existing shadows) and `omega customize <path>` materializes one of them, so a
consumer never reads the theme source tree to learn what it may shadow. The
whole-folder rule still applies: materializing an entry's `section.scss` alone
does nothing until the entry's `section.html` moves too, or the winner declares
`inherit` — the command and the file's provenance header both say so.

One declared exception: an override folder's json5 may carry
`inherit: ['js']` (and/or `'scss'`) — §7 asset lanes it deliberately leaves
to the chain, filled from the first LOWER full entry that has the file (the
chain continues past layers lacking it). That's how a theme override replaces
markup while keeping the base section's behavior riding the bundle without a
copy — and it makes the inherited js's DOM contract (the selectors it
queries) part of the override's markup contract. Declaring a lane the folder
also ships is a build error; a declaration no lower layer can fill warns and
inherits nothing. html and json5 are never inheritable: not overriding markup
IS inheritance, and the folder is its own manifest (theme defaults are theme
identity).

## Authoring — one tag, two forms

Inline (simple args — values are real Liquid expressions):

```liquid
{% section "marketing/hero", headline: page.title %}
```

Block (structured data — YAML, the frontmatter dialect; `{{ }}` output tokens
inside values render against the calling page):

```liquid
{% section "marketing/testimonials" %}
superheadline: "What builders say"
items:
  - quote: "Shipped in a weekend."
    author: "Avery Quinn"
{% endsection %}
```

Using both forms on one call is an error. No args → the section's json5
defaults render.

### Values are text, prose is markup (#580)

An arg naming a literal VALUE — a stat number, a hero card number, a timeline
year, a shell command, a terminal transcript line, a code-panel token, a price
card's catalog value — renders through `| escape_once`. A value like `<200ms`
otherwise opens a tag the html minifier eats, and the page prints a visible
`< div>` (kramdown escaped these in the legacy build, so the defect is
OMEGA-only). `escape_once` and not `escape`: a brand that already worked around
this by authoring `&lt;200ms` keeps rendering `<200ms`, and the filter is
idempotent.

Prose args — headline, description, label, title, quote — stay raw: authoring
inline `<em>` in them is the shipped idiom. Real markup beyond that rides the
`html` schema type and slot blocks, below.

### Slots — passing finished HTML (Ian 2026-07-18)

When an arg needs real markup beyond strings/numbers, the block body may
carry named slot blocks — alongside the YAML, or alongside inline args (the
both-forms error applies to the YAML remainder only):

```liquid
{% section "marketing/hero", data: resolved.hero %}
  {% slot demo_html %}
    <div class="my-wild-demo"><i class="fa-solid fa-rocket"></i> {{ resolved.config.brand.name }}</div>
  {% endslot %}
{% endsection %}
```

Slot content renders in the CALLER's scope (site vars, page captures, `omega_*`
tags all work) and reaches the section as a finished-HTML string arg —
schema type `html` — merged OUTERMOST (over defaults ← data ← named) and
NEVER re-rendered: it merges after call-site liquification, so literal
braces survive (`{% raw %}` code samples stay intact; capture-passing an
html value as a plain named arg re-liquifies — slots are the finished-HTML
lane). A whitespace-only slot collapses to `''` — explicit-empty, killing
an html default the way explicit-empty kills everywhere. Duplicate slot
names and unclosed blocks throw; slot names ride the same schema
validation/did-you-mean lane as every arg. `{% slot %}` is body-text
grammar, not a registered tag — stray use outside a call fails loudly.
One limit: same-tag nesting inside a slot (a `{% section %}` block inside a
section slot) breaks the dual-form scan — nest the other tag instead
(components inside section slots, sections inside component slots).

Shipped html args: `marketing/hero` `demo_html` (finished markup replacing
the typed demo lanes) and `marketing/stats` `after` (markup inside the band
container after the grid — classy AND the newsflash override serve it; the
alternative.html stats+CTA composite now composes through it).

The name is usually a quoted literal; a bare expression resolving to an id
string is also legal (`{% section entry.id, data: variant.args %}`) — the
showcase's mechanism, and how data-driven composition stays one tag. The
expression runs up to the first comma (a filter taking comma-separated
params needs a `{% capture %}` first).

### The `data:` bridge

`data:` is reserved: it deep-spreads an object BETWEEN defaults and named
args — `defaults ← data ← named args` (shared `deepMerge` semantics with the
resolved cascade: b wins, explicit `null` removes, `undefined` keeps).
Layouts pass `data: resolved.hero` to bridge the THEME's own defaults (and
the consumer's site-wide directory-data lane). Bare ARRAYS bridge as a named arg
(`{% section "marketing/stats", items: resolved.stats %}`) — an undefined
named arg keeps the default, so absence semantics survive.

**Consumer page frontmatter is META-ONLY (Ian 2026-07-19: "not only no more
frontmatter but NOTHING EVEN TRIES TO CONSUME frontmatter"; softened same
day: no build-fail)**: a real file under `pages/` may carry only `layout`,
`permalink`, `meta`, `schema`, `config`, `sitemap` (+ engine plumbing — every
key documented in [frontmatter.md](frontmatter.md)). `config` ([#607](https://github.com/Omega-JS-Stack/omega/issues/607))
is the page's omega.json5 override block — every config section a page or
layout restates lives under it, including `theme` (shell chrome) and `client`
(#1: the `@omega.js/client` settings blob — auth policy, cookie consent, exit
popup; the chat widget moved to `inbound.chat.providers.chatsy` in #23), which
the core chrome reads into the Configuration payload via
`resolved.config.client`. The layout chain still merges underneath, key by key.
A config section restated BARE is a build ERROR naming the file and the key —
no dual-read, and `omega migrate`'s `config-parent` rule moves it. (`client`
was `web_manager` through the UJM era; WebManager is not an OMEGA concept —
see the [config mapping tables](../shared/config.md).) Any other key is
content-in-frontmatter — a lane that doesn't
exist: the engine STRIPS it from the data cascade before resolution (and the
collections parity-repair lane filters pages to the same allow set, so
nothing stripped re-enters through `resolved`), then warns with a
move-it-into-sections message. Sections/components can never see the values;
the build proceeds (`frontmatter-guard.test.js`). Content lives in the page
BODY as `{% section %}` calls; site-wide overrides live in directory data;
theme voice lives in layout frontmatter.

**Doc-wins parity — collections lane (repaired cp225, rescoped cp235)**:
Eleventy's own data-cascade merge CONCATS a doc array onto a layout-default
array and lets a layout-default object beat a doc scalar — breaking the
inject-properties.rb contract for content ENTRIES (`_posts`, `_team`,
`_alternatives`, … — docs whose frontmatter IS the document; the guard never
touches them). The engine re-applies the doc's OWN frontmatter (re-parsed
from source) over the cascade with the shared `deepMerge` inside the
`resolved` computed, so a doc always wins its own keys outright: arrays
replace, scalars beat objects, partial object overrides keep layout
siblings. Virtual templates (blueprints, sample content) have no source
file and keep pure cascade behavior. Pinned in
`test/resolved-page-wins.test.js` against the real classy alternative
layout.

### Context-freeness (load-bearing)

Section markup never reads page globals — `{ args }` is the whole render
scope. Interpolation happens at the CALL site: any string value (default or
passed) containing Liquid renders against the calling page's scope before the
section sees it, so defaults like `"Introducing {{ resolved.config.brand.name }}"`
work while markup stays portable to every framework surface. Config keys are
read through `resolved.config.*` (#607) — `site.*` is build facts only.

## Markup convention: base, skin, fork (ratified 2026-08-04, #177)

Structure lives once, look lives per theme, identity is a bounded escape
hatch. The rules:

- **The base theme owns shared markup.** `themes/base` holds the structural
  markup of every shared surface (layouts, sections, includes, components)
  with neutral `omega-*` BEM classes
  (`omega-<block>__<element>--<modifier>`). The theme layer chain ends at
  base for every theme. Base markup is a contract: changing it touches every
  theme, so it gets API-level care and tests.
- **A theme is a skin by default.** A theme ships tokens plus scss over the
  base's `omega-*` selectors (and fonts, `_theme.js` — both optional: base
  ships the js floor the chain ends at, and a shadowing theme inherits the
  packaged skin's faces and font files,
  [#773](https://github.com/Omega-JS-Stack/omega/issues/773)). It forks no shared
  markup. Identical DOM across themes is what makes theme switching safe:
  a consumer's custom css and overrides survive the switch.
- **Forks are identity, and they are bounded.** A theme forks a surface's
  folder only when its design needs different structure (newsflash's ticker,
  story cards, newspaper homepage). Fork markup uses theme-prefixed BEM
  (`newsflash-<block>__<element>--<modifier>`); the theme's README lists its
  forks. Everything else falls through to base.
- **Pages are compositions.** A page layout is a thin sequence of
  `{% section %}` calls; a hand-built band belongs in a section folder.
- **Behavior contracts ride the base.** Core JS selectors (`.amount`,
  `.billing-info`, `.price-per-unit`, `.btn-adaptive`, `.button-text`) and
  `data-*` idioms (`data-lazy`, `data-plan-*`, `data-billing`,
  `data-omega-countup`, `data-service-uptime`) live in base markup; a fork
  keeps them, whatever its styling does.
- **The theme ladder.** Rung 1: tokens only, a complete restyled site
  (`_template` is this rung). Rung 2: component scss over `omega-*`
  selectors. Rung 3: identity forks. Each rung is a working theme.
- **Unprefixed vocabulary.** Bootstrap and core utility classes stay as-is
  (`card`, `row`, `btn-adaptive`, `animation-*`); `avatar`/`avatar-*`,
  `hairline*`, and `cursor-help` are base utilities shared by all themes.

Classy is a skin like the others; its former structural markup IS the base.

Enforcement is mechanical: `packages/web/test/theme-convention.test.js`
pins the class discipline and the README fork lists, so drift fails the
suite.

## Schemas & validation

`section.json5` declares `args` (name → type or `{ type, description }`),
`defaults`, and `demo` (showcase variants — see §9 below). Build-time
validation is warn-only: unknown args warn with did-you-mean, type
mismatches warn, nothing throws. Schema names are API — renames follow
deprecation discipline.

**Defaults ownership**: a single-page section lifts that page's default copy
into its json5 (hero). A section SHARED by multiple pages (testimonials, cta,
newsletter-cta) keeps json5 defaults NEUTRAL — mechanical knobs only — and
every caller passes its own copy over the data bridge, so no page can inherit
another page's words.

## Asset lanes (§7)

- **CSS**: every layer-resolved `section.scss` compiles into the MAIN sheet
  via the synthesized `omega:sections` sass module (core main.scss pulls it
  last, so section rules sit on top of the theme vocabulary; deterministic
  kind+id order). PurgeCSS self-trims sections a site never renders. A
  consumer main.scss that configures via `@use 'omega:main'` inherits the
  library automatically; a full-fork main that skips `omega:main` opts out.
- **JS**: every `section.js` bundles into the MAIN bundle; the generated boot
  stub registers `id → init` and `bootSections` initializes AFTER the main
  boot, once per present element: `init(el, { manager, options })` for each
  `[data-omega-section="<id>"]` (components: `data-omega-component`).
  Sections with behavior carry the attribute on their own root element;
  absent sections cost one querySelectorAll. One section's init failure never
  blocks another's.
- **Default imagery**: the framework never loads an external image at
  runtime. Default pictures SHIP in the package — `core/images/*` bridges to
  `/assets/images/core/*` via the static-asset channel
  (`static-assets.js`) — or the surface carries none and its designed
  fallback renders (e.g. the testimonial initial badge). No theme or section
  default may point at a third-party image host; the guard test
  `packages/web/test/external-images.test.js` fails the retired hosts across
  the whole theme layer and `defaults/`
  ([#154](https://github.com/Omega-JS-Stack/omega/issues/154),
  [#158](https://github.com/Omega-JS-Stack/omega/issues/158)).
- **Hero animations ride these same lanes**
  ([#441](https://github.com/Omega-JS-Stack/omega/issues/441), Ian's ruling
  2026-08-25). A brand that wants a moving hero visual makes ONE folder —
  `src/_hero/<name>/{index.html, style.scss, script.js}` — and names it in the
  hero's own frontmatter:

  ```liquid
  {% section "marketing/hero" %}
  demo:
    enabled: true
    type: custom
    name: orbit
  {% endsection %}
  ```

  Resolution is the layer chain (consumer → theme layers), first folder with an
  `index.html` wins the whole entry, so a brand overrides a shipped animation by
  owning the name. `style.scss` joins the `omega:sections` sheet and `script.js`
  joins the main bundle beside every `section.js` — the collector
  ([hero-animations.js](../../packages/web/src/hero-animations.js)) returns the
  same `{ kind, id, scss, js }` shape, and the markup's
  `data-omega-hero="<name>"` wrapper is what `bootSections` inits on. The markup
  reaches the hero through the `{% hero_animation %}` tag, not a global, because
  section markup is context-free by contract. The framework ships ONE reference
  animation in exactly that shape, `themes/base/_hero/orbit/`, with its
  `prefers-reduced-motion` branch; the hero's `Custom animation` demo variant is
  it, rendered. The other custom lane is unchanged: `demo.options.content` is
  finished markup authored at the call site, and a named folder wins over it.
  Pinned by `test/hero-animation.test.js`.

  Whichever lane fills it, that markup animates with the document: the hero band
  is a first-paint band (`data-omega-first-paint`,
  [#763](https://github.com/Omega-JS-Stack/omega/issues/763)), so a
  `data-omega-reveal` authored inside it is started by the head's inline starter
  the moment the band is parsed, instead of waiting for the engine to download
  and its scroll observer to fire. A hero animation that runs on its own (a
  `_hero/` folder's js, a css keyframe) still starts from a VISIBLE state, since
  nothing stamps it. The motion contract is
  [docs/shared/theming.md](../shared/theming.md).
- **Dev loop**: theme-layer section edits are covered by the theme-root
  watchers; consumer `src/_sections`/`_components`/`_hero` have their own watch
  entries — scss changes hot-swap css, js changes rebuild + reload.
- **Page modules (cp221)**: `asset_path` frontmatter is DEAD — page assets
  bind to URLs alone. Exact key first (`js/pages/pricing.js` or the
  per-page-dir `pricing/index.js`), then `[name]` wildcard filenames
  (Next.js convention, Windows-safe): `js/pages/blog/[slug].js` /
  `css/pages/blog/[slug].scss` serve every `/blog/<slug>` page. A wildcard
  segment matches exactly one URL segment; exact beats wildcard; among
  wildcards the most-literal key wins (ties break lexicographically); a
  trailing `/index` on a wildcard key is the per-page-dir spelling and never
  consumes a URL segment. Underscore basenames under `pages/` are shared
  partials in BOTH languages, never entries — the flat legal URLs
  (`/terms`, `/cookies`, `/privacy`, unreachable by wildcard) each own a
  two-line entry over `legal/_document.js` / `legal/_document.scss`.
  Resolver: `resolvePageAsset` (assets.js), consumed by the engine's
  `pageAssets` computed. The `data-asset-path` html attribute died with the
  mechanism (nothing read it). Every layer that ships a file for the resolved
  key LOADS, in layer order ([#624](https://github.com/Omega-JS-Stack/omega/issues/624))
  — the same resolver answers `js/layouts/<layout>.js` / `css/layouts/<layout>.scss`
  keyed by layout name.

## Update semantics

| Consumer state | Theme updates (html/css/js/copy) | What's preserved |
|---|---|---|
| No file | Everything flows | — |
| Composition + args | Section internals flow; framework never writes consumer files | Their args + composition |
| Forked section/theme file | Nothing flows for that entry | Everything (frozen) |

A fork whose json5 declares `inherit` keeps those lanes flowing from the
layer below — the one opt-back-in to the update stream (the collector
resolves the base file live, so base js/scss updates still reach the fork).

## Showcase & docs (spec §9) — auto-generated

TWO galleries, one shape ([#602](https://github.com/Omega-JS-Stack/omega/issues/602)): `/test/sections` is the section library and `/test/components` the component library, each an index over every RESOLVED entry of its kind (grouped by category folder) plus one page per entry carrying the args table (generated from the schema — name, type, description), the pretty-printed defaults, and every `demo` variant rendered LIVE through the real tag. New folder → new pages, zero authoring. The
engine computes the `sectionLibrary` global (`buildSectionLibrary`: same
first-match-wins resolution as the tags) and the pages paginate over it;
each entry chips its owning layer, so overrides say `newsflash` and
fallthrough ids say `classy` — the override doctrine, visible.

Each kind's URL SPACE has one home, `KINDS.<kind>.gallery` in [sections.js](../../packages/web/src/sections.js): `url` (the index), `base` (entry pages hang off `<base>/<id>`, frames off `<base>/<id>/frames/<slug>`) and `label`. The library stamps the resolved url onto every entry and variant, so no template ever composes one.

The two spellings are HARMONIZED (Ian's #602 addendum, 2026-08-26) — `base` IS `url` on both, so the shape is literally the same sentence twice:

| Library | Index | Entry | Frame |
|---|---|---|---|
| Sections | `/test/sections` | `/test/sections/<id>` | `/test/sections/<id>/frames/<slug>` |
| Components | `/test/components` | `/test/components/<id>` | `/test/components/<id>/frames/<slug>` |

Neither carries a kind segment the other lacks. Sections used to hang off `/test/sections/section/<id>` — a leftover of the era when the section space held both kinds; a gallery is development-only ([#554](https://github.com/Omega-JS-Stack/omega/issues/554)), so that spelling was simply dropped, with no redirects. The index and its entries share one url prefix without colliding on disk: an extensionless permalink gets the Jekyll `.html` (`jekyllPermalink` in [engine.js](../../packages/web/src/engine.js)), so `test/sections.html` the file sits beside `test/sections/` the directory.

**It is the agent path.** Building a page means composing entries from this
gallery, never hand-rolling HTML: the entry page is the args contract and
the frames are what each variant actually looks like.

- **Embedded frames (#463)**: a variant renders in its OWN document —
  `<gallery base>/<id>/frames/<slug>` (`defaults/showcase/frame.html`,
  paginating over `sectionLibrary.variants`, the flattened one-item-per-
  entry×variant list). The slug is the kebab-cased label, numbered on
  collision within the entry (`side-by-side`, `side-by-side-2`). The frame
  wears the theme's real asset bundles with nav and footer off (page-level
  `theme.nav.enabled: false`), so a hero that expects the viewport gets one.
  The OVERLAY chrome is off in the same frontmatter (#555): the frame bakes
  `client.consent.enabled: false` and
  `inbound.chat.providers.chatsy.enabled: false`, so a stack of variants is not
  a stack of cookie banners and chat bubbles. ONE generator serves both kinds,
  so that is the ONE home for it; the gallery page around the frames is a page
  like any other and still shows both. The DEV PALETTE is the third overlay a
  frame drops, and it is gated in the other place: `core/js/main.js` imports it
  only when `html[data-iframed]` is not `true` (the mark `core/_includes/core/body.html`
  stamps before first paint), because main.js is what loads that chunk. The
  other two are decided before it runs — the client mounts chatsy inside
  `omega.initialize()` — which is why they live in the frontmatter and this one
  does not.
- **The entry page embeds them**: per variant, the label, the authored args
  as a copyable escaped block (`argsJson`, escaped by the collector like
  every other display string), and a lazy same-origin `<iframe>` autosized to
  its content by `core/js/libs/showcase-frames.js` (the shared helper both
  galleries' page modules call —
  `core/js/pages/test/sections/[category]/[name]/index.js` and
  `core/js/pages/test/components/[category]/[name]/index.js` are the wildcard
  page-asset entries serving the two generated families — mirrored keys for
  mirrored urls, both two wildcard segments off their index). An inline
  `min-height` is the no-JS fallback — the frame scrolls, never collapses. The
  stack itself is ONE include, `core/_includes/core/showcase/entry-body.html`,
  rendered by the ONE entry-page generator.
- **Sidebar + stacked frames (#540, Ian's QA call)**: every gallery page is
  one row — the navigation rail on the left, the content on the right. The
  rail (`core/_includes/core/showcase/nav.html`, one home for both galleries'
  indexes and entry pages) is KIND-SCOPED (#602): it lists that library the way
  its own index groups it, marks the entry being shown, and nests THAT entry's
  demo variants under it.
  The right pane shows EVERY variant STACKED, one frame each with its options
  block, and the entry's args table beneath them; the rail's variant links are
  plain anchor jumps (`#variant-<slug>`) into that stack — no tab machinery,
  no reload, and no JS required (the page module only autosizes). Ian settled
  the model at the 2026-08-24 QA pass: stacked scans faster.
- **The gallery chrome clears the masthead**: each gallery page's shell is a
  top-level `<section data-omega-showcase-shell>`, which is the element a
  theme's nav clearance targets (classy's nav is `position: fixed`) — as a
  bare `<div>` it took no clearance and slid under the nav, which is also what
  made the rail's "← Section library" link unclickable. The rail's sticky
  offset and each panel's `scroll-margin-top` clear the same nav.
- **The component gallery (#549, reshaped by #602)**: `/test/components`
  MIRRORS the section gallery rather than reinterpreting it — an index here,
  an entry page at `/test/components/<id>`, its frames at
  `/test/components/<id>/frames/<slug>`. ONE generator serves both kinds:
  `defaults/showcase/entry.html` and `defaults/showcase/frame.html` paginate
  the whole library and take their permalink off the entry's own kind-aware
  url, and the two index pages share `core/_includes/core/showcase/index-body.html`.
  Nothing is generated under `/test/sections/component/…` or
  `/test/sections/section/…` any more — both kind segments are gone. The living
  styleguide that used to hold the `/test/components` URL is `/test/styleguide`
  (a `defaults/pages` page, so it ships in production builds too — noindex and
  sitemap-excluded like every `/test` page); the galleries ride
  `defaults/showcase/`, so production emits none of them.
- The five `hero-demo-*` default pages folded INTO the gallery (#463): the
  hero's own `demo:` roster now carries the input/form/video/side/custom
  compositions they used to author page-side, and they render as frames.

- **Development builds only** (the sample-content gate): a page rendering
  every section would keep every section's CSS alive through the PurgeCSS
  content scan and quietly defeat §7 self-trimming. Production never builds
  it; the pages are also collection-excluded, so sitemap.xml and pages.json
  never carry them. The frame pages ride the same injection (the engine
  collects the whole `defaults/showcase/` dir). A theme with its own sections
  gets exactly that many extra entry pages plus their frames — the one
  sanctioned cross-theme page-count delta (pinned in the contract suite,
  derived from the collector).
- **`demo` variants** — `[{ label, args?, stage_class? }]`: args ride the
  data bridge over the entry's defaults (exactly the consumer experience)
  and liquify at the frame's call site; `stage_class` supplies the wrapper a
  component's caller normally owns (section-head's shell). Shared bands
  carry generic demo copy — neutral defaults stay neutral (§6).
- **Docs display is RAW**: description/args/defaults strings arrive
  HTML-escaped from the collector (including `{` → `&#123;`), so the docs
  show the `{{ resolved.config.brand.name }}` tokens a consumer would see in the file.
  Load-bearing, not cosmetic — the library rides the page data cascade,
  whose frontmatter/resolved walkers liquify any string containing `{{`
  (the walkers also skip the `sectionLibrary` key wholesale).
- **Lookup-driven entries demo nothing by design** (news/story-card,
  news/byline resolve posts/members from live site content) — their pages
  document args only.

## Customize (spec §8) — `omega customize <url>`

Materializes a default page into `src/pages/` so it can diverge — without
owning anything it didn't change. No URL → lists every customizable default
URL with its lane. Idempotent: an existing consumer page at the URL is never
overwritten; both lanes carry a YAML comment header (frontmatter comments
never render) and deleting the file returns the URL to the packaged default.

- **composition lane** — the page's theme layout wraps a pure section
  composition in `{% composition %}…{% endcomposition %}` (classy's home
  today; more as extraction continues — the lane is detected from the tag,
  never a hardcoded list). The materialized file = the default page's thin
  frontmatter + the wrapped one-liners verbatim (a body replaces the
  composition by default — no flag):
  **no copy inlined**. The layout chain stays intact, so shared-band words
  (testimonials, cta) keep flowing from the theme's frontmatter through
  `resolved.*` — the consumer file renders "Sarah Johnson" without ever
  containing it. The consumer owns the composition order plus whatever args
  they add; everything else keeps updating. Written `.html` regardless of
  the default's extension — section output must never pass through
  markdown.
- **shell lane** — the theme layout still carries one-off page markup (not
  yet a pure composition, or shadowed by a theme's own hand-crafted layout,
  e.g. newsflash's home). The materialized file is a verbatim copy of the
  thin default page (layout pointer + permalink): customization happens
  through the page's SIDECAR data file over `resolved.*`, and everything
  keeps flowing. Page frontmatter is meta-only (the guard strips content
  keys), so `<page>.11tydata.json` beside the page IS the page-level lane
  for a shell layout's band data — and it obeys the same arrays-replace rule
  every other override lane does ([#269](https://github.com/Omega-JS-Stack/omega/issues/269)):
  a sidecar array REPLACES the layout's default array outright (Eleventy's
  cascade concats it; `resolved` re-applies the sidecar with the engine's
  deepMerge), while object and string keys merge over the defaults as they
  always did. Pinned by `test/sidecar-data.test.js`.

A default page whose permalink is a TEMPLATE — the blog hub's pagination, the
per-term tag/category pages — is addressed by its SOURCE PATH, because no URL
can ever equal a Liquid permalink ([#458](https://github.com/Omega-JS-Stack/omega/issues/458)):
`omega customize /blog` materializes `defaults/pages/blog.md`,
`/blog/tags/tag` materializes the tag generator. Both list like any other
customizable URL. The permalink is copied BYTE-IDENTICAL, which is the only
thing build-time suppression keys on, so the materialized page takes the
default's place with no duplicate output. Pinned by `test/customize.test.js`.

The `{% composition %}` wrap is tri-state, byte-parity with the
`{{ content | omega_content_format }}` line it replaces in the layout:

| Page state | Renders |
|---|---|
| No body content | The wrapped default composition |
| Body content | The body REPLACES the composition (Ian's 2026-07-19 ruling: writing a body means it — what customize materializes; no flag) |

Materialize-then-build is identity: the only sanctioned output delta is
blank-line runs (the materialized body passes through the blueprint's
content wrap, which frames it with one extra newline each side). Pinned in
`test/customize.test.js`, along with divergence (a call-site arg
override lands — frontmatter is meta-only; a deleted one-liner drops exactly
that band) and the theme-honest
lanes. The update-semantics table above is unchanged — customize writes
once, at the consumer's explicit request; the update stream never writes
consumer files.

## Landed vs pending

Landed: the tags, resolution, schemas/validation, data bridge, §7 asset
lanes, classy's marketing library (hero, trusted-by, bento, product-demo,
showcase, stats, testimonials, cta, newsletter-cta, faq — the homepage and
every CTA/testimonial/newsletter/FAQ band across classy pages render through
them; pricing's FAQ stays inline: its aside embeds a bespoke guarantee
object), and the heading components: `heading/masthead` — the interior-page
head cluster (eyebrow + display h1 + sub) composed inside ~17 layouts' own
band shells (sub_class/h1_class knobs carry the per-page class variants;
breadcrumb pages pass no eyebrow; `first_paint: true` drops the cluster's
reveal attributes for a caller whose band is the first viewport,
[#467](https://github.com/Omega-JS-Stack/omega/issues/467)) — and
`heading/section-head` — the h2-band
cluster serving ~18 layout bands AND the sections themselves (bento,
product-demo, showcase, faq compose it from their markup: **nested
composition** — sections render on the same engine, so `{% component %}`
works inside section markup, args evaluating against the section's own
`{ args }` scope).
newsletter-cta is the §7 reference consumer: its `section.js` owns the
FormManager binding (`export default (el, { manager, options })`), its root
carries `data-omega-section="marketing/newsletter-cta"`, and any page
composing the band gets the working managed form — live-proven on blog index
AND posts (whose old plain-action form posted to a nonexistent page).

The newsflash lane (cp213–218): the FIRST theme-layer section override —
`themes/newsflash/_sections/marketing/stats/` serves the same items
contract with newsflash markup (whole-folder wins, so its json5 carries the
theme's own head default — theme defaults are part of the theme's
identity) — plus newsflash-specific sections (`marketing/rundown`,
`marketing/desks`) and the theme's head components (`heading/rule-head` —
the h2 + rule + view-all idiom; `heading/lede` — the h1-sized header
cluster), composed by the newsflash index — and, since the cp216 sweep,
by EVERY newsflash layout: all 23 band heads and 8 ledes render through
the two components (composite heads join via `{% capture %}`; the
rule-head link slot serves index top-stories/the-latest and post
related; its doc comment trims its trailing newline so calls adjacent
to whitespace-trimmed tags keep glued joins). The posts-driven tile
family:
`news/story-card` (framed art + kicker + h5 + byline — 6 identical grid
instances across index/blog/category/tag/related) nests `news/byline`
(component-IN-component; the byline alone also serves the lead splash via
its `p_class` knob, feed items, and the hero cover). Posts stay out of
args entirely — raw post objects can never ride call-site liquification
(no circularity guard; content strings may carry literal braces). The
pattern: `omega_post`/`omega_member` are scope-independent (injected site
adapter), so components own image/name lookups from plain id args;
readtime pre-captures at the call site; kickers pass display-ready with
`| default: "" | omega_title_case` so absence suppresses instead of
rendering "Undefined". Override #2 (cp217): `marketing/newsletter-cta` —
the vermilion slab — is the inherit lane's first consumer: newsflash
markup (adds `headline_accent` + the `narrow` post-column knob), classy's
FormManager `section.js` inherited into the bundle, binding through the
override's own `data-omega-section` root. Landing it killed TWO live dead
forms: nf posts still carried the plain `action="/email-subscription"`
form (the cp209 bug), and the blog index's inline slab spoke the managed
dialect with NO presence-init root — nothing ever bound it.
Override #3 + the flip decision (cp218): `marketing/cta` — the dark
big-read band — went native. The cta-panel idiom that repeated inline
across the index/about/pricing layouts is now the theme's override
serving classy's exact contract, so those three bands compose it AND
every fallthrough page (download, extension, alternatives ×2) flips from
classy markup to the panel — with the icon keys classy's markup ignores
(`superheadline.icon`, `*_button.icon`) finally rendering (superheadline
icons were later removed everywhere — Ian's ruling, 2026-08-22; button
icons stay), and `command`
served as the mono $ button in panel idiom. The newsletter-cta override
gained a second presentation the same checkpoint, `variant: "rail"` — the
compact sidebar signup card with NO section/container wrapper, composed
by the index aside (`anchor`/`disclaimer` knobs) — killing the THIRD dead
form: the rail card posted to the dead route since birth; it now speaks
the managed dialect through its own §7 root. The standing doctrine the
flip settled: **a theme overrides a shared id only when the band exists
in its own design vocabulary** — hero, bento, product-demo, showcase,
testimonials, trusted-by, and faq deliberately fall through to the classy
base under newsflash (the lede/splash family serves the hero role) and
the skin styles them; team's charter slab and join band stay inline
(per-page uniques borrowing the panel visual, not instances of the
contract). Newsflash pins live in `test/sections-newsflash.test.js` on a
theme-override build lane over the posts-rich fixture (17 posts — every
index slot lit).

The showcase lane (cp219): the auto-generated `/test/sections` surface —
see "Showcase & docs" above. Landing it added the expression-name tag form,
the `sectionLibrary` global, demo variants across all 17 demoable entries
(the two lookup-driven components document args only), and the
development-only default-page injection lane.

The customize lane (cp220): `omega customize <url>` + the
`{% composition %}` wrap — see "Customize" above. Classy's home is the
first composition-lane page (the one pure-composition layout); every other
URL rides the shell lane until its one-off bands extract. The wrap's
guard originally preserved the legacy append contract as the
default (the slice-suite pin caught the first over-eager version); Ian's
2026-07-19 ruling flipped it — a body REPLACES the composition, no flag —
and #607 deleted the `append: true` escape hatch that kept the legacy
add-below contract alive beside it: a page that wants the default bands
writes them, which is exactly what `omega customize <url>` hands it.
The `composition: true` key is retired (ignored).

The wildcard lane (cp221): page assets went URL-only — `asset_path` died
across the tree (theme post/taxonomy/legal/app layouts, the update and
alternative blueprints, the hero-demo pages, the ports fixture), the
`blog/post` → `blog/[slug]`, `updates/[update]`, `alternatives/
[alternative]` families renamed in place, and the legal trio split into
flat exact entries over underscore partials. The §7 dividend: the
homepage's video-tab logic left the dying `index` page module for
`product-demo/section.js`, so the behavior now works on EVERY page that
composes the band — including the showcase pages, which never had it.

Sample content went auto-generated (cp222, spec §8): the shared corpus (11
posts / 4 teammates / 4 updates) carries its dates as a rhythm relative to
the corpus epoch (2026-07-18) and re-anchors to the build day on every
non-production build — post filenames shift (Eleventy `page.date`),
`update.date` frontmatter lines rewrite, dateless team files pass through —
so a virgin blog always looks alive. `omega dev` additionally materializes
the generated set under the target's `.omega/sample-content/`
(self-`.gitignore`d, regenerated each boot, removed per collection the
moment the consumer owns one) for humans to read and copy. Determinism: the
web test harness pins `OMEGA_SAMPLE_ANCHOR` to the epoch — generation
becomes an identity transform (the cp222 goldens are byte-zero against
cp221) — while the wizard journey proves live rolling: a wizard-born brand's
newest sample post lands ~10 days before today, unpinned.

The extraction close (cp223, spec §13 step 2 COMPLETE): a full-page audit of
every classy layout found ONE remaining true duplicate — alternatives/index's
inline stats band, a byte-level copy of `marketing/stats` — now a section
call (classy goldens byte-zero; under newsflash the band correctly flips to
the theme's stats override, the last band newsflash couldn't reskin on that
page). Everything else that *looks* repeated was audited and stays, each for
a reason: alternative.html's stats+CTA composite and pricing's social-proof
stats (star rows) and FAQ+guarantee panel are divergent per-page composites,
not instances of the shared contracts; status's subscribe band is its own
compact idiom, not newsletter-cta; the team portrait card repeats only as an
SCSS pattern (`omega-person` — the index variant carries a links row the
member page deliberately drops), like the rowlist/hairline idiom. The
boundary doctrine the audit settled: **sections/components are for
composable bands with data args (+ finished-HTML slots, cp224); context-bound
partials stay includes**
(post-card, nav/footer, account-section-header — they need `site.*`/liquid
tags a context-free render can't see, the same reason posts never ride
args); **plumbing pages stay layouts** (auth flows, blog taxonomy twins,
payment, portal — generated-page machinery brands override at the layout
layer, not compositions brands remix).

HTML slots (cp224, Ian's ruling 2026-07-18): the `{% slot name %}` block
form — see "Slots" under Authoring above. Landing it: the two shipped html
args (`hero.demo_html`, `stats.after` on classy AND the newsflash override),
and the cp223 audit's parked composite converted — alternative.html's
stats+CTA band now composes `marketing/stats` with its trailing CTA in the
`after` slot. Classy goldens: every production page byte-zero (the
conversion is motion; slot output byte-exact); the only classy diffs are the
showcase's own arg tables documenting the new args. Newsflash: the
per-alternative page's stats band now correctly flips to the theme's stats
override — with the after-CTA surviving inside it — the same FLIP story as
cp223's index page.

Content pass A (cp225, freeze lifted by Ian 2026-07-18): the playground now
carries the real framework pitch — the homepage is a full composition
(hero with the `demo_html` terminal slot as the product shot and the
generic frame mock killed, six true-capability bento tiles, honest stats,
command CTA; trusted-by/product-demo/showcase/testimonials deliberately
absent until real ones exist) and the about page tells the real story
(era-labeled consolidation timeline, the project's actual working
principles as values, `gallery: false`). Landing it found and fixed the
page-wins parity break above — the about draft was the first consumer to
override layout arrays and caught its items concatenating. The draft is
fork-portable: copy carries `{{ site.brand.name }}` refs, so the real
brand's name lands at fork time.

Content pass B (cp226): classy's theme layer speaks generic SaaS — the
sweep found four literal omega accents and killed each: the hero's
`command: npx omega setup` DEFAULT is gone (no command default at all — a
framework command is never a theme's voice; the button renders only when a
brand sets one), the index layout's cta command lines are gone, the bento
code tile's comment line became `config_demo.label` (generic default
`// one config — every target`), and the bento terminal mock's lines became
per-item args (`item.terminal.{command,out,ok}`, defaulting to a generic
npm session). The playground passes its own omega voice through those args
(`omega deploy`, `// omega.json5 — one file, every target`) — proving the
division: the THEME is generic, promoting OMEGA is the BRAND's job. The
framework's own dev-only /test/* surfaces keep their omega references
(they demo the framework's real machinery and are purged from production).

The data lane (#72, ported from the workkit tower): `data/org-chart` — one
root card over a connected row of node cards (`{ title, sub, meta, tone }`
each), joined by ANIMATED dashed connectors. Every line is a repeating
gradient, not a border: a gradient's position is animatable and a border's
dash pattern is not, and a chart of what is happening right now reads as live
only if something on it is. Under 768px the tree tilts onto its side (spine
down the left, an elbow into each card), `prefers-reduced-motion` parks the
animation, and the `tone` arg rides the shared categorical ramp
([docs/shared/theming.md](../shared/theming.md)) so a node's chip matches the
same name's chart series. The class vocabulary is `omega-`-namespaced on
purpose — a live page rendering it from JS keeps the connectors AND survives
the PurgeCSS content scan. Pinned in `test/dataviz.test.js`.

The porting pass (#513, #500, #515, #493) — four gaps the operst and
playlisteer ports found, each closed in the library rather than brand-side:

- `marketing/hero` `breadcrumb` — an ordered `[{ label, href }]` trail rendered
  as `<nav aria-label="Breadcrumb">` above the headline cluster, small and
  muted on shared utilities alone (inline list items, so the trail inherits the
  hero's own alignment in both placements). The LAST crumb is the current page:
  unlinked, `aria-current="page"`. Absent renders nothing. It is the ON-PAGE
  trail only — `foot.html` emits the BreadcrumbList JSON-LD unconditionally
  from `site`, and the arg neither feeds nor replaces it, so an author keeping
  a deep page honest keeps BOTH consistent.
- `marketing/hero` `heading_level` (#500) — the headline's tag, default `1`. A
  page composing the band twice (the #496 pattern: the dashboard demo as its
  own below-fold instance) authors `2` on the second and ships one h1. The
  classes never change with the level, so classy's hero rules key on
  `.omega-display--hero` rather than the tag.
- `marketing/prose` (#515) — the head-plus-lede band: the shared
  `heading/section-head` cluster over a `body` of paragraphs, one `<p>` each,
  in the `omega-prose` reading column. No items, no media, no new CSS. Absent
  body renders the head alone. Before it, that shape had to fake itself with an
  item-less `marketing/showcase`; that empty-items rendering stays UNRATIFIED.
- `marketing/pricing-cards` (#493) — the minimal plan band, composed by the
  base index layout directly under the WHY band (the bento). It renders from
  the SAME resolved catalog `/pricing` does: the layout bridges
  `plans: resolved.pricing.plans` and `annual: resolved.pricing.billing.annually`,
  so the annual view shows the resolver's own floored monthly equivalent
  (#477) and no homepage number can drift from `payment.products`. The card
  vocabulary is `/pricing`'s `omega-price-card`, minus the billing-toggle JS
  hooks (`amount`, `billing-info`) and with a real link per card instead of a
  checkout button — that binding is a page module, and a hook nothing binds is
  a dead contract. No plans, no band; `enabled: false` removes it (#473).
  Because the band composes price cards OFF /pricing, a theme's
  `.omega-price-card` skin belongs in its marketing layer in the main bundle,
  never in `css/pages/pricing/index.scss` — neobrutalism and newsflash hoisted
  theirs there (#531), matching classy; /pricing renders identically, its
  styles simply arrive from the shared layer.
- `pricing/features` (#539) — the price card's feature bullets, hoisted out of
  the /pricing layout into a COMPONENT because the band composes the same
  list: green check, the catalog's value ahead of the name, and the
  dotted-underline tooltip a feature's `definition` earns (the themes
  initialize Bootstrap tooltips page-wide, so the affordance works wherever
  the list lands). Three callers — /pricing's plan cards, its one-time cards,
  and `marketing/pricing-cards` — so the hover surface can never exist on one
  and not the other. **Where the data comes from changed with
  [#647](https://github.com/Omega-JS-Stack/omega/issues/647), the rendering did
  not**: the composer now reads the top-level `features` CATALOG for the row
  order, the name, the icon and the definition, and each product's `features`
  map for its value alone ([config.md](../shared/config.md)). A feature valued
  `false` (or absent) is not part of that tier and renders nowhere. The
  definition BACKFILL is gone with the duplication that needed it — a
  definition exists in exactly one place now. The caller keeps the tier note above the extras, because
  its WORDING differs by surface: the page says "Everything in <previous>,
  and more:", the band says "and:" (Ian 2026-08-24). The band reads the
  composer's own `commonFeatures`/`extraFeatures` split, falling back to the
  flat `features` list for a plan hand-authored in a page body.
- The /pricing comparison matrix reads a cell the SAME way (#562, ruling Ian
  2026-08-25). A truthy cell is a YES and draws `circle-check`; a cell that is
  not a bare `true` also prints its own value as `omega-compare__label` beside
  the mark. `true` stays icon-only, falsy stays `circle-xmark`. **One value
  feeds both surfaces**: a product's `features.<id>` entry is the only number or
  label either one reads (#647), so a catalog's `"Included"` stops mixing the
  word with x icons in the same row while the cards keep printing the label. A value the catalog
  authored is TEXT — `omega_commaify` still formats a number, then
  `escape_once` (#580).

- `marketing/bento` `subheadline` default (#512) — the section default is
  EMPTY: an absent subheadline renders no sub node, never a demo sentence the
  brand never wrote (it shipped onto 40 pages of the operst port). The demo
  line moved into the band's `Default grid` gallery variant, where sample
  content belongs. Same sweep, same move: `about/timeline` and
  `about/principles` (the about layout authors both bands' real sub lines
  itself, so the packaged /about is unchanged). The rule this pins: **a
  json5 default is STRUCTURE — copy that reads as a live sentence belongs to
  a gallery variant or to the composing layout.** The sweep's remainder
  (#530) finished the job on the three marketing bands the base index layout
  composes without copy of its own: `marketing/showcase`,
  `marketing/product-demo` and `marketing/pricing-cards` all take the empty
  default, their demo lines moved to their gallery variants, and the packaged
  homepage's plan band now renders head-only until a brand writes its own sub
  line. (`marketing/prose` was already neutral by design.)
- `marketing/bento` tile `href` (#514) — the linked-card listing. With `href`
  the WHOLE tile renders as one `<a>` wearing `.omega-interactive` (the shared
  whole-surface click affordance); without it the tile is the div it always
  was. **A linked tile's body carries no nested anchors** — one anchor per
  tile, always, so the markup stays valid and the click target stays whole.
  It covers every hub/category listing the operst port hand-rolled over the
  `omega-rowlist` vocabulary; no separate link-list band exists (#514's
  deletion test).
- `marketing/bento` `numbered` (#519) — band-level, not per tile: `true`
  numbers the tiles 1..N by position as a small mono ordinal chip
  (`omega-tile__ordinal`, tokens only), so reordering a process band
  renumbers itself. Default band unchanged.
- `marketing/stats` item `icon` + `color` (#518) — the glyph rides the ONE
  icon mechanism (native `fa-*` markup in the shared `omega-icon-chip` idiom); `color`
  names a slot in the categorical token palette (`tone-1`…`tone-6` — the same
  ramp charts and tone chips read, [theming](../shared/theming.md)) and is
  WHITELISTED: anything else — a hex, a Bootstrap name — paints nothing, so a
  band can never colour outside the theme. The tone marks the glyph; the
  number stays ink.
- `about/letter` aside gate (#520) — the aside renders only when it has
  something to say: feed items, or the aside photo. Empty `feed_items` means
  no feed AND no framing (fragment box, status chip, label), and with no photo
  either the aside column goes with it and the letter runs the container's
  full width. Before it, a brand that wanted the mission/vision copy without
  the feed got an empty ornament no page asked for.
- `about/hero` `facts_head.headline_accent` (#516) — the facts head composed
  every line but the accent, so a legacy "Measuring our IMPACT" rendered as
  "Measuring our". It passes through like every other head composition now.
- `blueprint/team/index` copy homes (#517) — three optional args, all absent
  by default (byte-identical hub): `grid_head` (superheadline / headline /
  headline_accent / subheadline) heads the portrait grid through the shared
  `heading/section-head` cluster; each member's own one-line `bio:` (in their
  `_team` doc) reads under name and position as `omega-person__desc` — the
  card vocabulary the theme already styled and nothing rendered; and
  `mission_headline` gives the mission band its h2.
- `blueprint/alternatives/index` competitor description (#563) — the same
  shape one page over: each `_alternatives` doc's
  `alternative.competitor.description` reads UNDER its hub row title as
  `omega-rowlist__desc` (the row's first cell, above the "View comparison"
  meta), muted and unweighted so the link voice stays the title's. Every
  alternatives doc authors the key and legacy UJM printed it; the OMEGA hub
  printed the title and the link alone, so brand copy had nowhere to land.
  Unauthored, the row is byte-identical to what it always was.

Pending (spec §13): the arc close — THE FORK (real omegajs.dev sub-brand
born outside the monorepo on published omega; Ian-gated on publish/launch
decisions).
