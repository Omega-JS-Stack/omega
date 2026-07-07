# bakeoff-eleventy — bench harness (engine promoted to @omegajs/web)

**The engine core built here WON the bake-off and was promoted to
[packages/web](../../packages/web) in Phase B1** (decision:
[../bakeoff-shared/DECISION.md](../bakeoff-shared/DECISION.md)). Architecture,
module map, engine facts, and the 22-test suite now live with the package —
this directory is the remaining **corpus-scale harness**:

```bash
npm run build   # corpus (if absent) → @omegajs/web buildSite (assets → Eleventy → PurgeCSS)
npm run dev     # eleventy --serve over the corpus (farm layouts, watchable)
npm run bench   # cold ×3 (+warmup) + watch-mode incremental touches
```

- `src/build.js` — corpus-consumer wiring around `buildSite()` (prints the
  `OMEGA_TIMINGS` line the bench parses).
- `src/bench-run.js` — cold benches + `--watch --incremental` touch probes
  (touch targets point at the packaged themes in `packages/web/themes`).
- `eleventy.config.js` — dev-serve config (`configureOmega` + symlink farm +
  native HTTPS via `OMEGA_HTTPS_KEY`/`CERT`).

Recorded numbers, two eras — the corpus CONTENT changed at B2:

- **A2 final (synthetic slice layouts)**: cold full build **3.52 s** (σ0.035)
  over the 1,135-document corpus → 1,279 HTML files, vs the 332 s somiibo
  Jekyll baseline (~94×). Raw tables: [../bakeoff-shared/RESULTS.md](../bakeoff-shared/RESULTS.md).
  This is the engine-vs-engine record from the bake-off decision.
- **B2 baseline (REAL UJM content)**: same corpus through the real classy
  theme + real core chrome (885-line head/body/foot, JSON-LD, full default
  page set) → **1,397 HTML files in ~20 s total** (assets ~1.4 s, Eleventy
  ~17 s, purge ~1.9 s). Per-page engine cost ~12.7 ms vs Jekyll's ~68.6 ms
  on the equivalent real content (179 s / 2,608 files) ≈ **5.4× per page**;
  the real somiibo whole-pipeline comparison is the Phase-4 scale test.
  (B2 also killed two order-of-magnitude traps: LiquidJS include-parse
  caching, and throwing-getter walks in `resolved` — see the package README.)
  Watch-mode re-render is now ~15.8 s (the known full-re-render behavior ×
  real chrome) — the dev-loop optimization (incremental narrowing / chrome
  memoization) is a flagged B-phase work item.
- **B3 spot-check (ESM + splitting assets)**: the bundle format switch (IIFE →
  ESM with shared chunks for the boot runtime/web-manager singleton) left the
  corpus at **18.6 s total** single-run (assets 0.91 s — faster: page bundles
  are thin stubs) — within the B2 baseline's range.
- **B4 spot-check + THE FIRST REAL SOMIIBO BUILD**: post-migrate-checkpoint
  corpus single-run **18.14 s** (no regression from the taxonomy slug-dedupe /
  sass-importer / chrome changes). And the headline: a REAL somiibo copy,
  converted by `omega migrate`, built **2,556 pages in ~96–104 s** vs the
  **332 s** Jekyll baseline (~3.2× whole-pipeline on the real site — heavier
  per-page than the corpus: real chrome + 456-line index + per-page css).
  Jekyll's output was 2,608 files; the 52-file URL-set diff is B5
  `omega verify`'s first job.

Historical: the A1/A2 findings this spike produced (LiquidJS edge cases,
virtual-template layering, preprocessor cascade behavior, include-root perf)
are recorded in the packages/web README ("Engine facts"), RESULTS.md, and
DECISION.md (codemod rules).
