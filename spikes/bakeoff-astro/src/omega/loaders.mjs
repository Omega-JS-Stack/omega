/**
 * loaders.mjs — custom Content Layer loader for CONSUMER PAGES.
 *
 * Astro's glob loader has no entry type for `.html` (Jekyll consumers mix
 * .md and .html pages freely), so pages load through this thin
 * frontmatter loader instead: same store shape (id/data/body/filePath),
 * any extension.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

/**
 * Create a frontmatter-file loader over a directory.
 * @param {object} options
 * @param {string} options.base - absolute directory
 * @param {RegExp} [options.filter] - relative-path filter (default .md/.html)
 * @returns {object} Astro loader
 */
export function frontmatterLoader(options) {
  const filter = options.filter || /\.(md|html)$/;

  return {
    name: 'omega-frontmatter-loader',
    load: async ({ store, config }) => {
      store.clear();
      if (!fs.existsSync(options.base)) return;

      const rootDir = fileURLToPath(config.root);
      for (const entry of fs.readdirSync(options.base, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;

        const abs = path.join(entry.parentPath, entry.name);
        const rel = path.relative(options.base, abs);
        if (!filter.test(rel)) continue;

        const { data, content } = matter(fs.readFileSync(abs, 'utf8'));
        store.set({
          id: rel.replace(/\.[^.]+$/, ''),
          data,
          body: content,
          filePath: path.relative(rootDir, abs),
        });
      }
    },
  };
}
