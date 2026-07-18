# Sections & Components

The section/component library: pages are compositions of one-line calls;
markup, styles, behavior, and the arg contract live together in a folder the
framework owns. Design rationale and the arc's sequencing live in
[plans/omega-sections-spec.md](../plans/omega-sections-spec.md) — this doc is
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
  section.json5   ← { description, args, defaults } (+ demo, later)
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

### The `data:` bridge

`data:` is reserved: it deep-spreads an object BETWEEN defaults and named
args — `defaults ← data ← named args` (shared `deepMerge` semantics with the
resolved cascade: b wins, explicit `null` removes, `undefined` keeps).
Layouts pass `data: resolved.hero` so consumer frontmatter key-overrides keep
working unchanged. Bare frontmatter ARRAYS bridge as a named arg
(`{% section "marketing/stats", items: resolved.stats %}`) — an undefined
named arg keeps the default, so absence semantics survive.

### Context-freeness (load-bearing)

Section markup never reads page globals — `{ args }` is the whole render
scope. Interpolation happens at the CALL site: any string value (default or
passed) containing Liquid renders against the calling page's scope before the
section sees it, so defaults like `"Introducing {{ site.brand.name }}"` work
while markup stays portable to every framework surface.

## Schemas & validation

`section.json5` declares `args` (name → type or `{ type, description }`) and
`defaults`. Build-time validation is warn-only: unknown args warn with
did-you-mean, type mismatches warn, nothing throws. Schema names are API —
renames follow deprecation discipline.

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

## Update semantics

| Consumer state | Theme updates (html/css/js/copy) | What's preserved |
|---|---|---|
| No file | Everything flows | — |
| Composition + args | Section internals flow; framework never writes consumer files | Their args + composition |
| Forked section/theme file | Nothing flows for that entry | Everything (frozen) |

## Landed vs pending

Landed: the tags, resolution, schemas/validation, data bridge, §7 asset
lanes, classy's marketing library (hero, trusted-by, bento, product-demo,
showcase, stats, testimonials, cta, newsletter-cta, faq — the homepage and
every CTA/testimonial/newsletter/FAQ band across classy pages render through
them; pricing's FAQ stays inline: its aside embeds a bespoke guarantee
object), and the first real component: `heading/masthead` — the
interior-page head cluster (eyebrow + display h1 + sub) composed inside
~17 layouts' own band shells (sub_class/h1_class knobs carry the per-page
class variants; breadcrumb pages pass no eyebrow).
newsletter-cta is the §7 reference consumer: its `section.js` owns the
FormManager binding (`export default (el, { manager, options })`), its root
carries `data-omega-section="marketing/newsletter-cta"`, and any page
composing the band gets the working managed form — live-proven on blog index
AND posts (whose old plain-action form posted to a nonexistent page).
Pending (spec §13): remaining classy pages + newsflash extraction,
`omega customize <url>`, the auto-generated showcase + docs, `[id].js`
wildcard page modules, auto-generated sample content.
