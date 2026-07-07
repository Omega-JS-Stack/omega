/**
 * vite-omega-layers.mjs — THE load-bearing Astro bet: theme layering via
 * import resolution. Any module may import `omega:<rel>` (components,
 * layouts, …) and the FIRST layer dir containing <rel> wins — so a classy
 * base layout importing `omega:components/head.astro` picks up dusk's head
 * override when dusk is the active theme, with zero file copying.
 */
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'omega:';

/**
 * Create the Vite resolver plugin for a layer chain.
 * @param {object} options
 * @param {string[]} options.layers - ordered layer dirs (first wins)
 * @returns {object} Vite plugin
 */
export function omegaLayers(options) {
  return {
    name: 'omega-layers',
    enforce: 'pre',
    resolveId(source) {
      if (!source.startsWith(PREFIX)) return null;

      const rel = source.slice(PREFIX.length);
      for (const dir of options.layers) {
        const abs = path.join(dir, rel);
        if (fs.existsSync(abs)) return abs;
      }
      throw new Error(`omega-layers: "${source}" not found in layers:\n  ${options.layers.join('\n  ')}`);
    },
  };
}
