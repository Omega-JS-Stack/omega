# Bake-off scorecard — Eleventy vs Astro (Phase 2 A2)

Weights per the master plan. Each dimension scored 1–5 per candidate; weighted
total decides. **Decision rule: margin < 0.5/5 → Eleventy wins by default**
(migration-cost bias across 49 sites / ~200 custom files).

Baseline to beat: **332 s cold build** (see [BASELINE.md](BASELINE.md)).

## Scorecard

| Dimension | Weight | Eleventy | Astro | Notes |
|-----------|-------:|:--------:|:-----:|-------|
| Cold build @ 1030 posts | 25% | — | — | corpus cold build, `bench.js --runs=3 --warmup=1` |
| Incremental rebuild + dev reload | 20% | — | — | touch 1 post / 1 layout / 1 data file |
| Migration cost per layout | 20% | — | — | port 3 real layouts: classy contact, sweet-saucy recipe, somiibo index (stopwatch, projected across ~200 custom files) |
| uj_* adapter ergonomics | 10% | — | — | registerLiquid() vs direct helper imports |
| Asset-pipeline integration | 10% | — | — | esbuild + sass + PurgeCSS + imagemin fit |
| Long-term risk | 10% | — | — | maintenance, ecosystem, bus factor |
| Output parity | 5% | — | — | DOM diff + Lighthouse vs Jekyll output |
| **Weighted total** | 100% | — | — | |

## Raw measurements

### Cold build (corpus, seed 42)

| Candidate | mean | stddev | min | max | runs |
|-----------|-----:|-------:|----:|----:|-----:|
| Jekyll (real somiibo, reference) | 332 s | — | — | — | 1 |
| Eleventy | — | — | — | — | — |
| Astro | — | — | — | — | — |

### Incremental rebuild

| Candidate | 1 post touched | 1 layout touched | 1 data file touched |
|-----------|---------------:|-----------------:|--------------------:|
| Eleventy | — | — | — |
| Astro | — | — | — |

### A1 slice checklist (both candidates must build the identical slice)

- [ ] Base layout chain
- [ ] blueprint/index + pricing (incl. resolve-plan math)
- [ ] Auth signin/signup (FormManager + web-manager boot)
- [ ] Blog with pagination + taxonomy
- [ ] 404
- [ ] One frontmatter-only override page (consumer data over layout defaults)
- [ ] TWO themes, layered resolution, zero file copying
- [ ] 3-layer page-module JS/CSS via esbuild manifest
- [ ] `page.resolved` equivalent
- [ ] Frontmatter-value Liquid rendering (cached) — corpus has `{{ site.* }}` refs in frontmatter
- [ ] sass loadPaths + PurgeCSS
- [ ] HTTPS dev-server story decided

## Decision

_Pending A1 + A2._
