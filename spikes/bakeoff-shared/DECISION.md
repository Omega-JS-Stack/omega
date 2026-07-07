# A2 Decision Memo — @omegajs/web builds on **Eleventy 3**

Date: 2026-07-06 · Phase 2 Task 2.4 · Scores + raw data: [RESULTS.md](RESULTS.md)

## The decision

**Eleventy 4.70 vs Astro 3.55 (weighted, 1–5). Margin 1.15.** The decision
rule ("margin < 0.5 → Eleventy by default") never had to fire — Eleventy wins
on the merits. Phase B (B1–B5) builds `@omegajs/web` on **Eleventy 3 +
LiquidJS + @omegajs/template-kit**, promoting the `spikes/bakeoff-eleventy`
engine core.

## Why Eleventy — the three deciding facts

1. **Migration is a codemod, not a rewrite.** Porting three REAL files
   (classy contact, sweet-saucy recipe + adsense include, somiibo index —
   1,347 lines) cost **43 single-line mechanical edits on Eleventy vs ~700
   hand-rewritten lines on Astro**. Projected over the census (46 site repos:
   132 consumer layout/include files + 115 UJM framework theme files ≈ 38.6k
   lines), Astro's bill is a by-hand rewrite of ~247 files; Eleventy's is one
   `omega migrate` codemod pass + review. Every Eleventy edit fell into 8
   regex-able rule classes (RESULTS.md) — the conversion plan that applies to
   ANY consumer, which is exactly what Phase 4 needs across 49 sites.
2. **It's faster where it counts.** Cold corpus build 3.52 s vs 5.31 s (~94×
   vs ~63× the 332 s Jekyll baseline). Both are "fast enough", but Eleventy's
   profile is uniform: fast boot, ~2 s worst-case re-render, 1 s in-process
   test suite (vs 25 s of real `astro build` per suite run — which taxes every
   future CI run and every TDD loop in Phase B).
3. **Templates keep ONE language.** With Eleventy, layouts AND content are
   Liquid — one engine, one mental model, and the append/extend blueprint
   pattern ports verbatim. Astro would split the world permanently: layouts in
   .astro, content in Liquid, with the full liquidjs + template-kit pipeline
   shipping anyway — two template languages forever, for zero feature OMEGA
   actually needs (no islands, no client hydration in these sites).

## What Astro genuinely did better (recorded, not dismissed)

- **Instant warm dev renders** (<50 ms, ~1 s single-page after touch) vs
  Eleventy's ~2 s full re-render — but behind a 16.5 s boot repaid on every
  restart, with NO incremental static build.
- **Logic in JS beats Liquid gymnastics**: the recipe JSON-LD schema as a
  plain JS object is clearly nicer than capture/jsonify chains; pricing math
  as JS beat Liquid filters in A1 too. (Mitigation on Eleventy: template-kit
  tags/filters absorb logic-heavy spots; shortcodes are plain JS when needed.)
- The `omega:` Vite resolver made cross-layer imports elegant, and
  `injectRoute` is a clean default-pages story.
- Auto-escaping by default is the safer XSS posture — Liquid's `{{ }}` never
  escapes (Jekyll semantics, preserved for parity; worth revisiting as a lint
  in B4, not an engine switch).

## Risks accepted with Eleventy + mitigations

- **`--incremental` doesn't narrow under collection-paginated templates**
  (every touch re-renders all 1,279 files, ~2 s). Acceptable dev loop today;
  B-phase optimization via dependency hints if it ever hurts.
- **Small maintainer core** (bus factor) — mitigated by: boring, stable,
  fully-understood dependency; the engine core is ~600 lines of our own code
  over public Eleventy APIs (virtual templates, preprocessors, computed data),
  and the A1/A2 suites pin the behavior we rely on.
- **LiquidJS ≠ Jekyll Liquid edge cases** — exactly why the codemod rules
  exist (no `forloop.parentloop`, include leading slashes, tag-arg
  interpolation); the B4 liquid-lint scanner runs these as checks against
  every consumer BEFORE migration.

## The consumer conversion plan (seed — becomes B4 `omega migrate`)

Proven on real files this checkpoint; every rule is mechanical:

| # | Rule | Found by |
|---|------|----------|
| 1 | `page.resolved.` → `resolved.` | contact (26), adsense (5); 967 refs in UJM |
| 2 | bracket layout values → plain layout names | all three real files |
| 3 | `{{ }}` in quoted tag args → `{% capture %}` hoist | contact stats icons — a SILENT upstream no-op (live somiibo ships `class="fa text- display-4"`) |
| 4 | `forloop.parentloop.*` → hoisted outer `{% assign %}` | recipe ingredient ids + JSON-LD commas |
| 5 | strip leading `/` from include paths | recipe adsense includes |
| 6 | `page.<key>` → `<key>`; `page.content` → `content`; `page.slug` → `page.fileSlug` | recipe |
| 7 | `page.canonical.url` → `{{ site.url }}{{ page.url }}` | recipe schema |
| 8 | Jekyll per-collection `defaults:` → engine-level collection config | recipe layout/permalink assignment (B3 design) |

Plus engine conventions locked for @omegajs/web (winner-independent, already
implemented in the spike): UTC date filters (CI parity), deterministic post
sort (date desc, slug tie-break), page-scoped frontmatter Liquid (page-ref
values render per-page, copy-on-write — never into shared layout data), team
collection for `uj_member`, consumer `_includes` in Liquid roots (existing
dirs only — a missing root cost +1.05 s/corpus in LiquidJS probes).

## Disposition

- **Promote** `spikes/bakeoff-eleventy/src/*` as the B1 engine-core seed.
- **Keep** `spikes/bakeoff-astro` in-tree as a reference implementation (it
  proved the layered-theme model is engine-portable; its README holds the
  Astro-specific findings if the decision is ever revisited).
- **Carry forward regardless of engine**: @omegajs/template-kit,
  @omegajs/config, bakeoff-shared's asset pipeline + fixtures, the
  default-pages-with-suppression model, and the codemod rules above.
