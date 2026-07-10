/**
 * integration.mjs — the Astro home for framework DEFAULT PAGES that are
 * routes (blog index/pagination + taxonomy): an integration injecting each
 * route UNLESS the consumer owns the URL. (Content-shaped defaults —
 * about/signin/signup — go through the defaults collection + the catch-all
 * route's suppression instead; see src/pages/[...slug].astro.)
 */
import path from 'node:path';
import consumerScan from '@omega.js/web/consumer-scan';
import { SPIKE, consumerDir } from './paths.mjs';

const { scanConsumerPermalinks } = consumerScan;

// [route pattern, entrypoint under src/omega/routes/, consumer URL that suppresses it]
const DEFAULT_ROUTES = [
  ['/blog', 'blog-index.astro', '/blog/'],
  ['/blog/page/[num]', 'blog-page.astro', '/blog/'],
  ['/blog/category/[slug]', 'blog-category.astro', '/blog/'],
  ['/blog/tag/[slug]', 'blog-tag.astro', '/blog/'],
];

/**
 * The omega defaults integration.
 * @returns {object} Astro integration
 */
export function omegaDefaults() {
  return {
    name: 'omega-defaults',
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        const owned = scanConsumerPermalinks(consumerDir());

        for (const [pattern, entryFile, suppressedBy] of DEFAULT_ROUTES) {
          if (owned.has(suppressedBy)) continue;
          injectRoute({ pattern, entrypoint: path.join(SPIKE, 'src', 'omega', 'routes', entryFile) });
        }
      },
    },
  };
}
