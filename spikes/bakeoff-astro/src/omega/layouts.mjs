/**
 * layouts.mjs — Jekyll layout-name → .astro component dispatch.
 *
 * `import.meta.glob` eagerly imports every theme's layout components; the
 * active layer chain (active theme → classy) picks the winner per relative
 * path — layered resolution with zero file copying, same contract as the
 * Eleventy candidate's virtual templates.
 */
import { activeThemeId } from './paths.mjs';

const modules = import.meta.glob('/themes/*/layouts/**/*.astro', { eager: true });

/**
 * Resolve a normalized layout name ('blueprint/index') to its module —
 * `{ default: Component, defaults?: object }` — through the layer chain.
 * @param {string} name
 * @returns {object} the winning layout module
 */
export function resolveLayoutModule(name) {
  const chain = [...new Set([activeThemeId(), 'classy'])];

  for (const theme of chain) {
    const mod = modules[`/themes/${theme}/layouts/${name}.astro`];
    if (mod) return mod;
  }

  throw new Error(`layout not found in any layer: ${name} (chain: ${chain.join(' → ')})`);
}
