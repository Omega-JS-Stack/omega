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
themes/classy/_sections/marketing/hero/
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
theme → classy base. A consumer overriding a section owns ALL of it (markup +
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

### Slots — passing finished HTML (Ian 2026-07-18)

When an arg needs real markup beyond strings/numbers, the block body may
carry named slot blocks — alongside the YAML, or alongside inline args (the
both-forms error applies to the YAML remainder only):

```liquid
{% section "marketing/hero", data: resolved.hero %}
  {% slot demo_html %}
    <div class="my-wild-demo">{% uj_icon "rocket" %} {{ site.brand.name }}</div>
  {% endslot %}
{% endsection %}
```

Slot content renders in the CALLER's scope (site vars, page captures, `uj_*`
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
`permalink`, `meta`, `schema`, `theme`, `sitemap`, `append` (+ engine
plumbing). Any other key is content-in-frontmatter — a lane that doesn't
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
section sees it, so defaults like `"Introducing {{ site.brand.name }}"` work
while markup stays portable to every framework surface.

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
- **Dev loop**: theme-layer section edits are covered by the theme-root
  watchers; consumer `src/_sections`/`_components` have their own watch
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
  mechanism (nothing read it).

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

`/test/sections` is the library's living reference: an index over every
RESOLVED entry (grouped by kind + category folder) plus one page per entry
carrying the args table (generated from the schema — name, type,
description), the pretty-printed defaults, and every `demo` variant rendered
LIVE through the real tag. New folder → new pages, zero authoring. The
engine computes the `sectionLibrary` global (`buildSectionLibrary`: same
first-match-wins resolution as the tags) and the pages paginate over it;
each entry chips its owning layer, so overrides say `newsflash` and
fallthrough ids say `classy` — the override doctrine, visible.

- **Development builds only** (the sample-content gate): a page rendering
  every section would keep every section's CSS alive through the PurgeCSS
  content scan and quietly defeat §7 self-trimming. Production never builds
  it; the pages are also collection-excluded, so sitemap.xml and pages.json
  never carry them. A theme with its own sections gets exactly that many
  extra entry pages — the one sanctioned cross-theme page-count delta
  (pinned in the contract suite, derived from the collector).
- **`demo` variants** — `[{ label, args?, stage_class? }]`: args ride the
  data bridge over the entry's defaults (exactly the consumer experience)
  and liquify at the call site; `stage_class` supplies the wrapper a
  component's caller normally owns (section-head's shell). Shared bands
  carry generic demo copy — neutral defaults stay neutral (§6).
- **Docs display is RAW**: description/args/defaults strings arrive
  HTML-escaped from the collector (including `{` → `&#123;`), so the docs
  show the `{{ site.brand.name }}` tokens a consumer would see in the file.
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
  through frontmatter args over `resolved.*`, and everything keeps flowing.

The `{% composition %}` wrap is tri-state, byte-parity with the
`{{ content | uj_content_format }}` line it replaces in the layout:

| Page state | Renders |
|---|---|
| No body content | The wrapped default composition |
| Body content | The body REPLACES the composition (Ian's 2026-07-19 ruling: writing a body means it — what customize materializes; no flag) |
| Body content + `append: true` | Default composition, content appended BELOW (the legacy UJM contract, kept behind the explicit flag) |

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
breadcrumb pages pass no eyebrow) — and `heading/section-head` — the h2-band
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
pattern: `uj_post`/`uj_member` are scope-independent (injected site
adapter), so components own image/name lookups from plain id args;
readtime pre-captures at the call site; kickers pass display-ready with
`| default: "" | uj_title_case` so absence suppresses instead of
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
(`superheadline.icon`, `*_button.icon`) finally rendering, and `command`
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
tri-state guard originally preserved the legacy append contract as the
default (the slice-suite pin caught the first over-eager version); Ian's
2026-07-19 ruling flipped it — a body REPLACES the composition, no flag,
and the legacy add-below contract lives behind an explicit `append: true`.
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
the generated set under the app's `.omega/sample-content/`
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
SCSS pattern (`classy-person` — the index variant carries a links row the
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

Pending (spec §13): the arc close — THE FORK (real omegajs.dev sub-brand
born outside the monorepo on published omega; Ian-gated on publish/launch
decisions).
