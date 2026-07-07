# @omegajs/bakeoff-shared

Shared infrastructure for the Eleventy vs Astro bake-off (master plan Phase 2,
A0–A2). Private workspace package — never published.

## What's here

| File | Purpose |
|------|---------|
| [BASELINE.md](BASELINE.md) | The real somiibo-website Jekyll build measurement (332 s cold) — the number to beat |
| [RESULTS.md](RESULTS.md) | A2 scorecard (weights, decision rule, raw measurement tables) |
| [DECISION.md](DECISION.md) | The A2 decision memo — Eleventy wins; codemod-rule table; disposition (engine promoted to packages/web in B1) |
| [src/corpus-spec.js](src/corpus-spec.js) | SSOT for the corpus shape — every number measured from the real somiibo-website |
| [src/generate-corpus.js](src/generate-corpus.js) | Deterministic corpus generator (seeded PRNG, byte-reproducible) |
| [src/prng.js](src/prng.js) | mulberry32 + sampling helpers |
| [src/bench.js](src/bench.js) | Repeated-run timing harness (hyperfine-style, zero deps — hyperfine is not installed on this machine) |

## Usage

```bash
# Generate the corpus (default: ./corpus, seed 42 — gitignored, deterministic)
npm run generate
npm run generate -- --out=/path/to/corpus --seed=42

# Benchmark a candidate build against the corpus
node src/bench.js --runs=3 --warmup=1 --label="eleventy cold" -- npx @11ty/eleventy

# Verify the generator
npm test
```

## Corpus shape (mirrors the real somiibo-website, measured 2026-07-06)

- **1,030 posts** in `_posts/{2017..2026,other,seo}/YYYY-MM-DD-slug.md` — exact per-dir distribution, word-count quartiles matching min 346 / p25 875 / median 1017 / p75 1797 / max 7522
- **105 pages** in `pages/` — 59× platform-bot + 32× solution + 5× package (rich data frontmatter, `{{ site.* }}` refs in values, HTML-in-YAML), 6× theme-bracket `.html`, 3× blueprint singles
- **20 `_alternatives`** collection docs
- `site-data.json` — the `site.*` resolution source for candidates
- `corpus-manifest.json` — seed + counts + word stats (deterministic, no timestamps)

Consumers: `spikes/bakeoff-eleventy` and `spikes/bakeoff-astro` point their
content dirs at a generated corpus and must both build the identical A1 slice
(see the checklist in RESULTS.md).
