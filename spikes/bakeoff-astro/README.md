# bakeoff-astro — candidate 2 (Astro 5 + content collections + template-kit direct imports)

The A1 slice built on Astro against the shared corpus
([spikes/bakeoff-shared](../bakeoff-shared)). Numbers + checklist live in
[RESULTS.md](../bakeoff-shared/RESULTS.md); this README is the architecture and
the migration findings.

```bash
npm run build   # corpus (if absent) → esbuild+sass (staged) → astro build → PurgeCSS
npm run dev     # astro dev (on-demand rendering)
npm run bench   # cold ×3 (+warmup) + dev-server reload probes
npm test        # 13 tests against the shared mini-site fixture (real astro builds)
```

## Architecture

- **Layered themes, zero copying** — TWO mechanisms:
  - `omega:` **Vite resolver** ([src/omega/vite-omega-layers.mjs](src/omega/vite-omega-layers.mjs)):
    any import of `omega:<rel>` resolves through the layer chain (active theme
    → classy → core), so classy's base layout picks up dusk's head override
    when dusk is active — the load-bearing bet, validated.
  - **`import.meta.glob` layout dispatch** ([src/omega/layouts.mjs](src/omega/layouts.mjs)):
    Jekyll `layout: blueprint/index` names map to the winning theme's .astro
    component through the same chain.
- **Layouts are .astro components** — ported by hand from the Liquid theme
  (THE migration cost; see findings). Layout frontmatter defaults become
  `export const defaults`, chained layouts merge their parent's defaults at
  module scope, and `computeResolved()` deep-merges page frontmatter over the
  chain = the `page.resolved` equivalent.
- **Content stays Liquid** — bodies + frontmatter values render through
  liquidjs + template-kit (`registerLiquid`) exactly like the Eleventy
  candidate ([src/omega/liquid.mjs](src/omega/liquid.mjs)); .astro components
  consume template-kit as DIRECT IMPORTS ([src/omega/uj.mjs](src/omega/uj.mjs)):
  filters as plain functions, tags via a thin ctx builder.
- **Content collections** (Astro 5 Content Layer) — posts/alternatives/defaults
  via the glob loader; PAGES via a custom frontmatter loader (the glob loader
  has no `.html` entry type).
- **Default pages, two shapes** — content-shaped (about/signin/signup/404):
  `defaults` collection + suppression in the catch-all's `getStaticPaths`;
  route-shaped (blog index/pagination/taxonomy): an integration
  (`injectRoute`) that simply doesn't inject when the consumer owns the URL.
- **Assets** — the SHARED SSG-agnostic pipeline
  ([bakeoff-shared/src/assets.js](../bakeoff-shared/src/assets.js)): esbuild
  page modules (real `@omegajs/client` via the `web-manager` alias), `omega:`
  scheme sass, PurgeCSS. Built into a staging dir and copied after Astro runs
  (astro build clears its outDir).

## Migration findings (feed the A2 scorecard + B4 codemod)

1. **Every layout/include ports from Liquid to .astro by hand** — the
   dominant cost (~200 custom files across 49 sites), and it's a rewrite, not
   a transform (loops → JSX-ish maps, filters → function calls, includes →
   imports). Content does NOT port: it stays Liquid, so the full
   liquidjs + template-kit engine ships in the build pipeline regardless.
2. Layout frontmatter defaults → `export const defaults` per layout, with
   MANUAL parent-chain merging (`deepMerge(baseDefaults, {…})`) — Eleventy
   gets the same cascade natively.
3. The glob loader has no `.html` entry type — Jekyll's mixed .md/.html
   pages/ needs a custom frontmatter loader (small, but bespoke).
4. Linked CJS workspace packages need `vite.ssr.external` (Rollup can't
   synthesize default exports from linked CJS source).
5. SSR chunks carry the CHUNK's `import.meta.url`, not the source file's —
   real paths must be anchored at config time (`OMEGA_SPIKE` env).
6. No incremental static rebuild: a rebuild is the full ~5.6 s build. Dev is
   on-demand: slow boot (~16.5 s over the corpus), then near-instant warm
   renders and ~1 s single-page re-renders after touches.
7. Bracket-layout hack normalizes in plain JS (no alias table needed —
   layout dispatch is ours), and theme switching is env-driven config; two
   same-process builds with different themes work (test-proven).
8. HTTPS dev: native Vite `server.https` (mkcert) — no proxy.
9. Test-harness ergonomics: every test build is a real `astro build`
   (~25 s suite, serialized — parallel test files collide on the shared
   `.astro` store) vs Eleventy's in-process `toJSON()` (~1 s suite).

From the A2 real-layout ports (see `test/ports.test.js` + shared DECISION.md):

10. Astro auto-escapes `{expr}` but Liquid `{{ }}` NEVER escapes — frontmatter
    values carrying inline HTML (corpus platform headlines embed `<span>`)
    need `set:html` at every render site (a per-field audit in any migration);
    attribute values entity-escape too, so the AdUnit component raw-emits its
    div for output parity.
11. Site-templated layout defaults (`{{ site.brand.name }}` in the real
    contact frontmatter) have no data home — they move into component code via
    the `??` pattern; page-templated meta (`{{ page.recipe.title }}` in the
    real recipe) is computed in-component and grafted onto `resolved`.
12. Consumer-LOCAL layouts (sweet-saucy ships `src/_layouts/recipe.html`)
    can't be dispatched dynamically — `import.meta.glob` is compile-time, so
    consumer layouts must join the Astro project graph (a restructuring cost
    the Eleventy candidate doesn't have).
13. `ujTag` needs real collections in its ctx for `uj_member` —
    collections.mjs reads `_team` directly, outside the content layer.

## Not in the slice (deliberate)

Same exclusions as the Eleventy candidate: imagemin, translation, minifyHtml,
sitemap/feeds (uj_member now runs against a real team doc in the A2 ports
fixture). Also not modeled:
Astro islands/client directives (the slice ships zero client-side framework
JS — page modules come from the esbuild pipeline, like production).
