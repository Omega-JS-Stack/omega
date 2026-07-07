/**
 * paths.mjs — spike/consumer/theme-chain path resolution for the Astro
 * candidate. Everything env-driven so the same project builds the corpus
 * (default), the mini-site fixture (tests), or any consumer dir:
 *
 *   OMEGA_CONSUMER=<abs dir>   consumer site (default: the shared corpus)
 *   OMEGA_THEME=classy|dusk    active theme (default: site-data theme.id)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// In the SSR build, bundled chunks carry the CHUNK's import.meta.url (under
// outDir), not this source file's — so the config (whose url is real, it
// runs unbundled) anchors the spike dir in OMEGA_SPIKE for runtime modules.
export const SPIKE = process.env.OMEGA_SPIKE
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ROOT = path.resolve(SPIKE, '..', '..');
export const DEFAULT_CORPUS = path.join(ROOT, 'spikes', 'bakeoff-shared', 'corpus');

/**
 * The consumer site directory being built.
 * @returns {string}
 */
export function consumerDir() {
  return process.env.OMEGA_CONSUMER || DEFAULT_CORPUS;
}

/**
 * Raw site data (site-data.json shape / resolved omega config).
 * @returns {object}
 */
export function loadSiteData() {
  return JSON.parse(fs.readFileSync(path.join(consumerDir(), 'site-data.json'), 'utf8'));
}

/**
 * The active theme id.
 * @returns {string}
 */
export function activeThemeId() {
  if (process.env.OMEGA_THEME) return process.env.OMEGA_THEME;
  const siteData = loadSiteData();
  return (siteData.theme && siteData.theme.id) || 'classy';
}

/**
 * Ordered theme layer dirs: active theme → classy base.
 * @returns {string[]}
 */
export function themeLayerDirs() {
  return [...new Set([activeThemeId(), 'classy'])].map((id) => path.join(SPIKE, 'themes', id));
}

/**
 * Full layer chain for `omega:` imports and asset lookups: themes → core.
 * @returns {string[]}
 */
export function layerDirs() {
  return [...themeLayerDirs(), path.join(SPIKE, 'core')];
}

/**
 * The asset manifest written by the asset build (empty when absent — tests
 * and `astro dev` before a full build).
 * @returns {{ js: object, css: object }}
 */
export function loadAssetManifest() {
  const file = path.join(SPIKE, '.omega', 'asset-manifest.json');
  if (!fs.existsSync(file)) return { js: {}, css: {} };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
