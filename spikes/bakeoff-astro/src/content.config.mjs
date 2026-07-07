/**
 * content.config.mjs — content collections over the consumer dir (Astro 5
 * Content Layer). Posts/alternatives/defaults are pure-.md and use the glob
 * loader; PAGES mix .md and .html (Jekyll convention), which the glob
 * loader has no entry type for — they use the custom frontmatter loader.
 * No zod schemas: the corpus frontmatter is open-shaped brand data;
 * `resolved` is computed per page at render time.
 */
import path from 'node:path';
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { SPIKE, consumerDir } from './omega/paths.mjs';
import { frontmatterLoader } from './omega/loaders.mjs';

const consumer = consumerDir();
const rel = (dir) => path.relative(SPIKE, dir);

export const collections = {
  pages: defineCollection({ loader: frontmatterLoader({ base: path.join(consumer, 'pages') }) }),
  posts: defineCollection({ loader: glob({ pattern: '**/*.md', base: rel(path.join(consumer, '_posts')) }) }),
  alternatives: defineCollection({ loader: glob({ pattern: '**/*.md', base: rel(path.join(consumer, '_alternatives')) }) }),
  defaults: defineCollection({ loader: glob({ pattern: '*.md', base: rel(path.join(SPIKE, 'defaults', 'pages')) }) }),
};
