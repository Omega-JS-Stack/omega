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

Recorded numbers (A2 final): cold full build **3.52 s** (σ0.035) over the
1,135-document corpus → 1,279 HTML files, vs the 332 s somiibo Jekyll
baseline (~94×). Raw tables: [../bakeoff-shared/RESULTS.md](../bakeoff-shared/RESULTS.md).

Historical: the A1/A2 findings this spike produced (LiquidJS edge cases,
virtual-template layering, preprocessor cascade behavior, include-root perf)
are recorded in the packages/web README ("Engine facts"), RESULTS.md, and
DECISION.md (codemod rules).
