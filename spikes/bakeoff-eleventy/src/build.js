/**
 * Bench-harness build: corpus (generate if absent) → @omegajs/web buildSite
 * (assets → Eleventy → PurgeCSS), with per-phase timings printed for the
 * bench harness. The engine was promoted to packages/web in B1 — this file
 * is only the corpus-consumer wiring.
 *
 * Env:
 *   OMEGA_THEME=classy|dusk      active theme (default: site-data theme.id)
 *   OMEGA_LAYOUT_MODE=virtual|farm  layered-layout delivery (default virtual)
 *   OMEGA_SKIP_PURGE=1           skip the PurgeCSS pass
 */
const fs = require('node:fs');
const path = require('node:path');
const { generateCorpus } = require('@omegajs/bakeoff-shared');
const { buildSite } = require('@omegajs/web');

const SPIKE = path.resolve(__dirname, '..');
const ROOT = path.resolve(SPIKE, '..', '..');
const CORPUS = path.join(ROOT, 'spikes', 'bakeoff-shared', 'corpus');
const OUT = path.join(SPIKE, '_site');
const CLIENT_ENTRY = path.join(ROOT, 'packages', 'client', 'src', 'index.js');
// The corpus site's own asset layer ("site wins" page modules) — the same
// fixture packages/web's asset-pipeline tests build against
const SITE_ASSETS = path.join(ROOT, 'packages', 'web', 'test', 'fixtures', 'site-assets');

async function main() {
  const started = process.hrtime.bigint();

  // ---- corpus (idempotent: only generated when absent)
  let corpusSeconds = 0;
  if (!fs.existsSync(path.join(CORPUS, 'corpus-manifest.json'))) {
    const t0 = process.hrtime.bigint();
    generateCorpus({ outDir: CORPUS, seed: 42 });
    corpusSeconds = Number(process.hrtime.bigint() - t0) / 1e9;
  }
  console.log(`[build] corpus: ${corpusSeconds.toFixed(2)}s`);

  const siteData = JSON.parse(fs.readFileSync(path.join(CORPUS, 'site-data.json'), 'utf8'));

  const { timings, htmlCount } = await buildSite({
    consumerDir: CORPUS,
    siteData,
    outDir: OUT,
    clientEntry: CLIENT_ENTRY,
    siteAssetsDir: SITE_ASSETS,
    activeTheme: process.env.OMEGA_THEME,
    layoutMode: process.env.OMEGA_LAYOUT_MODE || 'virtual',
    farmDir: path.join(SPIKE, '.omega', 'layout-farm'),
    skipPurge: Boolean(process.env.OMEGA_SKIP_PURGE),
    manifestPath: path.join(SPIKE, '.omega', 'asset-manifest.json'),
    onPhase: (name, seconds) => console.log(`[build] ${name}: ${seconds.toFixed(2)}s`),
  });

  const totalSeconds = Number(process.hrtime.bigint() - started) / 1e9;
  console.log(`[build] TOTAL: ${totalSeconds.toFixed(2)}s — ${htmlCount} HTML files`);
  console.log(`OMEGA_TIMINGS ${JSON.stringify({ corpus: corpusSeconds, ...timings, total: totalSeconds, htmlCount })}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
