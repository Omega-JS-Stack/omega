/**
 * Full production build: corpus (generate if absent) → assets (esbuild + sass)
 * → Eleventy → PurgeCSS, with per-phase timings printed for the bench harness.
 *
 * Env:
 *   OMEGA_THEME=classy|dusk      active theme (default: site-data theme.id)
 *   OMEGA_LAYOUT_MODE=virtual|farm  layered-layout delivery (default virtual)
 *   OMEGA_SKIP_PURGE=1           skip the PurgeCSS pass
 */
const fs = require('node:fs');
const path = require('node:path');
const { generateCorpus } = require('@omegajs/bakeoff-shared');
const { buildAssets, purgeCss } = require('./assets.js');
const { configureOmega } = require('./omega-web.js');

const SPIKE = path.resolve(__dirname, '..');
const ROOT = path.resolve(SPIKE, '..', '..');
const CORPUS = path.join(ROOT, 'spikes', 'bakeoff-shared', 'corpus');
const OUT = path.join(SPIKE, '_site');
const CLIENT_ENTRY = path.join(ROOT, 'packages', 'client', 'src', 'index.js');

async function main() {
  const timings = {};
  const started = process.hrtime.bigint();
  const phase = async (name, fn) => {
    const t0 = process.hrtime.bigint();
    const result = await fn();
    timings[name] = Number(process.hrtime.bigint() - t0) / 1e9;
    console.log(`[build] ${name}: ${timings[name].toFixed(2)}s`);
    return result;
  };

  // ---- corpus (idempotent: only generated when absent)
  await phase('corpus', () => {
    if (!fs.existsSync(path.join(CORPUS, 'corpus-manifest.json'))) {
      generateCorpus({ outDir: CORPUS, seed: 42 });
    }
  });

  fs.rmSync(OUT, { recursive: true, force: true });
  const siteData = JSON.parse(fs.readFileSync(path.join(CORPUS, 'site-data.json'), 'utf8'));
  const activeTheme = process.env.OMEGA_THEME || (siteData.theme && siteData.theme.id) || 'classy';
  const themeLayerDirs = [...new Set([activeTheme, 'classy'])].map((id) => path.join(SPIKE, 'themes', id));

  // ---- assets first: the manifest feeds the head include
  const manifest = await phase('assets', () =>
    buildAssets({
      jsLayers: [
        path.join(SPIKE, 'site-assets', 'js'),
        ...themeLayerDirs.map((dir) => path.join(dir, 'js')),
        path.join(SPIKE, 'core', 'js'),
      ],
      cssLayers: [...themeLayerDirs.map((dir) => path.join(dir, 'css')), path.join(SPIKE, 'core', 'css')],
      outDir: OUT,
      clientEntry: CLIENT_ENTRY,
    })
  );
  fs.mkdirSync(path.join(SPIKE, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(SPIKE, '.omega', 'asset-manifest.json'), JSON.stringify(manifest, null, 2));

  // ---- Eleventy
  await phase('eleventy', async () => {
    const Eleventy = require('@11ty/eleventy').default;
    const elev = new Eleventy(CORPUS, OUT, {
      quietMode: true,
      configPath: false,
      config: (eleventyConfig) =>
        configureOmega(eleventyConfig, {
          consumerDir: CORPUS,
          siteData,
          themesDir: path.join(SPIKE, 'themes'),
          coreDir: path.join(SPIKE, 'core'),
          defaultsDir: path.join(SPIKE, 'defaults'),
          activeTheme,
          layoutMode: process.env.OMEGA_LAYOUT_MODE || 'virtual',
          farmDir: path.join(SPIKE, '.omega', 'layout-farm'),
          assetManifest: manifest,
        }),
    });
    await elev.write();
  });

  // ---- PurgeCSS over the rendered HTML
  if (!process.env.OMEGA_SKIP_PURGE) {
    const sizes = await phase('purge', () => purgeCss({ outDir: OUT, manifest }));
    console.log(`[build] purge: ${sizes.before} → ${sizes.after} bytes`);
  }

  const totalSeconds = Number(process.hrtime.bigint() - started) / 1e9;
  const htmlCount = countHtml(OUT);
  console.log(`[build] TOTAL: ${totalSeconds.toFixed(2)}s — ${htmlCount} HTML files`);
  console.log(`OMEGA_TIMINGS ${JSON.stringify({ ...timings, total: totalSeconds, htmlCount })}`);
}

/**
 * Count .html files under a directory.
 * @param {string} dir
 * @returns {number}
 */
function countHtml(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.html')) count++;
  }
  return count;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
