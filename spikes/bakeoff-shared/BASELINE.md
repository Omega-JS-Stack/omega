# Jekyll baseline — real somiibo-website production build

The number every bake-off candidate is judged against. Measured on the REAL
somiibo-website (the heaviest OMEGA consumer site), not the synthetic corpus —
the corpus mirrors this site's shape so candidate numbers are comparable.

## Result

| Metric | Value |
|--------|-------|
| **Total cold build (`npm run build`)** | **332 s (5 min 32 s)** |
| gulp `build` task chain | 5.39 min |
| — jekyll (1030 posts + 105 pages + defaults → 2,608 HTML files) | **2.98 min (Jekyll self-reported 178.23 s)** |
| — sass (incl. PurgeCSS) | 1.99 min |
| — imagemin (WARM cache: 1,783/1,936 from `cache-uj-imagemin`) | 1.82 min |
| — minifyHtml (2,608 files) | 24 s |
| — webpack | 12 s |
| — translation (warm `cache-uj-translation`) | 0.4 s |
| — distribute + defaults + jsonToHtml + audit | < 1 s |
| `mgr clean` + `mgr setup` + npm overhead | ~9 s |

gulp tasks overlap (parallel groups), so per-task times exceed the wall total.

## Method

- **Site:** `/Users/ian/Developer/Repositories/Somiibo/somiibo-website` (READ-ONLY — measurement only; no new tracked-file modifications after the run)
- **Command:** `npm run build` = `npx mgr clean && npx mgr setup && UJ_BUILD_MODE=true bundle exec npm run gulp -- build`
- **Cold:** `mgr clean` wipes `dist/`, `_site/`, `.temp/`, `.cache` (incl. `.jekyll-cache`/`.jekyll-metadata`) before building
- **Warm remote caches:** imagemin + translation hit their cache branches (`cache-uj-imagemin`, `cache-uj-translation`) — this is the representative day-to-day/CI state; a fully cache-cold imagemin run is far slower
- **Measured:** 2026-07-06, single run (`time npm run build`, wall 332 s)

## Environment

| | |
|---|---|
| Machine | Apple M1 Max, 10 cores, 64 GB RAM, macOS 26.5.1 |
| Node | v22.22.1 (site `.nvmrc` v22/*) |
| Ruby / Jekyll | ruby 4.0.0 / jekyll 4.4.1 |
| ultimate-jekyll-manager | 1.9.31 (npm latest at measurement time — no setup self-update) |

## Site content shape (what the synthetic corpus mirrors — see src/corpus-spec.js)

- 1,030 posts in `src/_posts/{2017..2026,other,seo}/` — word counts min 346 / p25 875 / median 1017 / p75 1797 / max 7522
- 105 pages in `src/pages/` (99 `.md` + 6 `.html`): 59× `platform-bot`, 32× `solution`, 5× `package`, 6× `themes/[ site.theme.id ]/frontend/core/base`, 3× blueprint singles (index/pricing/contact)
- 20 collection docs, all `_alternatives` (`_team`/`_updates` empty)
- 199 `{{ site.* }}` refs inside page frontmatter values (variable-resolver load)
- 3 custom layouts (`platform-bot`, `solution`, `package`) + ~11 custom includes
- Output: 2,608 HTML files

## Targets (from the master plan)

- Cold build: minutes → **tens of seconds**
- Incremental rebuild: **sub-second to a few seconds** (Jekyll dev mode today copes only by LIMITING collections via `limit-collections.rb` — full-corpus dev rebuild is effectively unusable, which is itself part of the baseline story)

## Not yet measured

- Jekyll incremental/dev-reload time on the full corpus (dev mode limits posts by design; measure per-candidate at A2 scoring time if a like-for-like Jekyll number is needed)
