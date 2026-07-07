/**
 * astro.config.mjs — the Astro candidate's project config: the omega-layers
 * Vite resolver (theme layering), the defaults integration (injected blog
 * routes), and the `@omega` alias for theme components importing engine
 * helpers.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

// Anchor the spike dir for SSR-runtime modules BEFORE paths.mjs loads (the
// config file runs unbundled, so its import.meta.url is the real path)
process.env.OMEGA_SPIKE = path.dirname(fileURLToPath(import.meta.url));

const { SPIKE, layerDirs } = await import('./src/omega/paths.mjs');
const { omegaLayers } = await import('./src/omega/vite-omega-layers.mjs');
const { omegaDefaults } = await import('./src/omega/integration.mjs');

export default defineConfig({
  outDir: './_site',
  devToolbar: { enabled: false },
  integrations: [omegaDefaults()],
  vite: {
    plugins: [omegaLayers({ layers: layerDirs() })],
    resolve: { alias: { '@omega': path.join(SPIKE, 'src', 'omega') } },
    // Linked CJS workspace packages: let Node require() them at SSR time
    // (Rollup can't synthesize default exports from linked CJS source)
    ssr: { external: ['@omegajs/template-kit', '@omegajs/config', '@omegajs/bakeoff-shared', '@omegajs/web'] },
  },
});
