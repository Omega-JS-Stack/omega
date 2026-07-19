# OMEGA Sections & Components — Architecture Spec

> **STATUS: RATIFIED (Ian, 2026-07-18 — same night as the design).** Extraction underway; durable parts migrate to `docs/sections.md` as pieces land.
> Scope: ALL frameworks (web, desktop, extension, future) — this design is made once and never redesigned. No backwards compat anywhere (standing rule).

## 0. Why (the ruling that produced this)

The frontmatter-monolith model (theme layout = whole page, copy as frontmatter defaults) has one fatal flaw — the **fork cliff**: consumers can override words but never structure; the only escape is owning a 600-line layout forever. Ian + Claude independently converged on a **section/component library**: structure becomes data, sections stay framework-owned, updates keep flowing. Massive frontmatter is explicitly rejected ("we tried that and its ugly") — frontmatter shrinks to page meta only.

## 1. The two-tier library

- **Sections** — full-width page bands (hero, testimonials, bento, pricing table, article list…). Pages are compositions of sections.
- **Components** — smaller reusable pieces (browser frame with mac buttons, terminal, marquee, stat card…). Used inside sections and directly in pages.

Both tiers share the same anatomy, resolution, and asset rules.

## 2. Anatomy — a section is a folder that owns everything about itself

```
themes/classy/_sections/marketing/hero/
  section.html    ← markup (Liquid). The args are the data contract.
  section.scss    ← its styles (optional)
  section.js      ← its behavior (optional — most sections have none)
  section.json5   ← meta: arg schema + defaults + showcase demo data
```

(Naming amendment, cp204: the folder families are `_sections`/`_components` —
the Jekyll-family underscore marks template machinery, matching
`_layouts`/`_includes`, and keeps Eleventy from processing them as content.)

Components identical with `component.*` filenames. Standard filenames (not `<name>.html`) so tooling/resolvers are predictable.

**The context-free rule (load-bearing):** args in → HTML out. Section markup never reaches into page globals (`site.*`, nav state, collections). This single rule is what makes sections renderable on every framework surface and portable to any future engine.

## 3. Organization — nested, dozens-scale

- Section id = path under `sections/` (kebab-case): `marketing/hero`, `commerce/pricing-table`, `content/article-list`, `app/stat-cards`.
- Arbitrary nesting allowed; the showcase groups by folder automatically.
- Same for components: `frame/browser`, `frame/terminal`, `motion/marquee`.

## 4. Resolution & layering (mirrors the theme layer chain)

For `{% section "marketing/hero" %}`, first match wins:

1. **Consumer-local**: `<src>/_sections/marketing/hero/` — consumers author their own sections here (their git holds ONLY their own work)
2. **Active theme**: `themes/<active>/_sections/...`
3. **Base theme (classy)**: `themes/classy/_sections/...` — the floor, same as the theming two-lane model

Theme sections live inside the installed package (never scaffolded into the consumer repo) — consumer git stays clean; framework updates flow.

## 5. Authoring syntax

**Frontmatter is minimal forever**: meta title/description, permalink, page-level config only. Content lives in the body as section calls.

Inline form (simple args):
```liquid
{% section "marketing/hero", headline: "Ship every surface" %}
```

Block form (structured data — objects, arrays, N items):
```liquid
{% section "marketing/testimonials" %}
headline: "What builders say"
items:
  - quote: "Shipped in a weekend."
    name: "Avery Quinn"
    role: "Founder, Loopwork"
  - quote: "One config. Every surface."
    name: "Sam Okafor"
    role: "CTO, Fieldnote"
{% endsection %}
```

- Block body = YAML (same dialect as frontmatter). One tag, two forms; using both inline args and a block body on the same call is an error (simplicity first).
- **Amendment (Ian 2026-07-18, landed cp224) — slots**: the body may also carry named markup blocks (`{% slot demo_html %}<any html>{% endslot %}`), composing with inline args OR the YAML (the both-forms error applies to the YAML remainder). Slot content renders in the caller's scope and reaches the section as a finished-HTML string arg (schema type `html`), merged outermost and never re-rendered. Full contract: docs/sections.md.
- No args → the theme's default copy renders (defaults from `section.json5`).
- Components: `{% component "frame/browser", url: "app.example.com" %}` — same two forms.
- Sections must be **N-item responsive by design** (auto-fit grids etc.) — item count is data, layout self-adjusts; showcase demo data exercises 1/3/many variants.

## 6. Schemas & validation (`section.json5`)

- Declares: args (name, type: string/number/bool/array/object/enum, default, description), demo data for the showcase (variants allowed).
- Build-time validation: unknown arg → warning with did-you-mean (`hero.headlin` → `headline`); type mismatch → warning. This is the typed-props benefit without changing engines.
- Schema names are **API** — renames are breaking and follow deprecation discipline (warn one minor, remove later).
- **Defaults ownership (cp205 ruling)**: a section used by ONE page lifts that page's default copy into its json5 (hero precedent); a section SHARED by multiple pages (testimonials: index + pricing + alternatives) keeps json5 defaults NEUTRAL — mechanical knobs only (e.g. the avatar placeholder frame) — and every caller passes its own copy over the data bridge, so no page can ever inherit another page's words.

## 7. Assets

- **CSS**: every section's `section.scss` compiles into the theme sheet (stable order); **PurgeCSS (already in the pipeline) strips sections a site never renders** — shipped CSS self-trims, zero config.
- **JS**: section JS bundles into the theme bundle behind DOM-presence auto-init (`data-omega-section="marketing/hero"` → init only when present) — same pattern as the motion library. Manifest-driven per-section splitting stays available later if bundles fatten.
- **Page assets — `asset_path` is DEAD**, replaced by wildcard filenames (Next.js convention, Windows-safe):
  - `js/pages/team/[id].js` / `css/pages/team/[id].scss` match any `/team/<segment>` page without an exact module; exact path beats wildcard.
  - Internal uses convert too (`js/pages/blog/[slug].js`); zero frontmatter involved.

## 8. Pages model — blueprints stay, absence is the spine

- **No file → theme/blueprint default renders** (Ian's loved behavior, preserved verbatim). Default pages become section compositions internally; pricing/contact/TOS keep filling from config.
- **`omega customize <url>`** (verb SETTLED, Ian 2026-07-18): materializes the page prefilled with the default composition as clean one-liners (no copy inlined) — consumer adds args only where they diverge. Nobody starts blank; nobody owns what they didn't change.
- Deep escape hatch unchanged: consumer-local theme file override = own that file forever (documented cost: its updates freeze).

### Sample content (Ian 2026-07-18)

- Posts/teammates/updates-style filler stays **SHARED across themes** — never per-theme. Scope = that filler only; anything bigger goes back to Ian.
- It becomes **auto-generated with rolling current dates** (a virgin blog always looks alive, never "6 months stale") and materializes only under a **gitignored test path** in the consumer tree — never committed, never mixed with real brand content.

### Update semantics (the truth table)

| Consumer state | Theme updates (html/css/js/copy) | What's preserved |
|---|---|---|
| No file | Everything flows | — (nothing to preserve) |
| Composition + args | All section internals flow; their words/composition preserved; framework NEVER writes consumer files | Their args + composition |
| Forked theme file | Nothing flows for that file | Everything (frozen at fork) |

Only schema renames can bite the middle row — governed by §6 deprecation + warnings.

## 9. Showcase & docs — auto-generated

- The showcase iterates the section/component library and renders each entry with its `section.json5` demo data (all variants). New section → appears automatically. The showcase stops being a hand-built page.
- Reference docs generate from the same schemas (args table per section).

## 10. Multilanguage

- **The existing post-build translation system stays THE mechanism** (`packages/web/src/translate/`): reads built HTML, translates text units via `@omega.js/devkit/translate` (default provider: Claude on the local install), per-string cache committed in the consumer repo (hand-fix any string, it sticks), emits static `/{lang}/…` copies with lang/dir, rewritten links, honest hreflang. SEO-correct, zero manual translation.
- Raw-liquid translation rejected (MT mangles template syntax). Data-level translation rejected as the pipeline (would need a second pipeline for prose anyway).
- Section contract additions: code-y components (terminal, code frames, commands) carry the standard `translate="no"` attribute; a future per-locale arg-override lane (hand-tuned marketing headlines) rides the same committed cache.

## 11. Cross-framework standardization (Ian 2026-07-18: design once, never again)

- **`@omega.js/web`'s engine is the single HTML factory for every framework's HTML surfaces.** Desktop windows/pages and extension popup/options pages are BUILT by it (target-scoped page sets via `targets.*` config); no framework ever reimplements templates, sections, theming, or translation.
- **One design contract across surfaces**: the `--omega-*` token sheet + `.omega-shell` chrome (already shipped) — sections ride on it.
- **One translator**: `@omega.js/devkit/translate` — the post-build pass runs over any built HTML dir regardless of target.
- Realistic surface scope: desktop inherits full pages via the website; extension shares tokens + small components (buttons, cards, frames) — marketing bands in a popup are a non-goal.
- Enabled entirely by the context-free rule (§2).

## 12. Engine ruling — Liquid stays this generation

- Market reality (2026): Liquid alive and huge (Shopify engine, Eleventy first-class); the modern paradigm is components-with-typed-props (Astro/JSX/Svelte; WebC is Eleventy's answer). Greenfield would evaluate Astro seriously.
- We are not greenfield: the layered file-override model works BECAUSE Liquid templates are interpreted at build from whichever file wins the chain (compile-time imports would break it); two themes are finished; consumers never write Liquid — they write one-liner calls + YAML.
- Sections + schemas capture the typed-props/scoped-assets benefit at ~10% of a rewrite's cost. **Sections are the migration unit** if omega v2 ever switches engines. Revisit at the next major, not before.

## 13. Sequencing (the locked map, updated)

1. ~~Ian ratifies this spec~~ **RATIFIED 2026-07-18**
2. **Extraction refactor**: classy + newsflash layouts → section/component libraries. `packages/web` only (playground-freeze-safe); corpus/golden-master pins output identical
3. **Content pass A — omega-ify the playground**: real framework pitch as compositions/args; playground = the living draft of the real site
4. **Content pass B — genericize classy**: sweep omega dev-accents from theme defaults (theme speaks generic SaaS; promoting OMEGA is a brand's job); optional per-theme sample posts/team
5. **Showcase**: auto-generated from the library (§9)
6. **Arc close — THE FORK**: real omegajs.dev sub-brand born fresh outside the monorepo on published omega (fresh repo, fresh production Firebase, omegajs.dev zone, CI deploys); playground's polished content copies over 1:1. **The playground stays in the monorepo forever as the dedicated live test brand** (real Firebase, zero customer risk, break it freely)
7. Post-arc: company umbrella brand + sub-brand rebuilds (existing hard gates unchanged; the config `company` layer already models the umbrella)

## 14. Open items — ALL RESOLVED (Ian, 2026-07-18)

- Verb name → **`omega customize <url>`**
- Per-theme sample content → **NO — shared filler stays shared**, but it becomes auto-generated + gitignored-test-path isolated (see §8)
- Playground deploys after the fork → **BOTH lanes**: simple direct push is the normal lane (CI runs cost real money), and the full CI-dispatch path gets deliberately exercised every once in a while so it stays proven
