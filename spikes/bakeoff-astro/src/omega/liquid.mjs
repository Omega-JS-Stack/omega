/**
 * liquid.mjs — the CONTENT pipeline for the Astro candidate.
 *
 * Layouts are .astro components (template-kit via direct imports — see
 * uj.mjs), but consumer CONTENT is still Jekyll-flavored Liquid + Markdown:
 * bodies carry `{{ site.* }}` refs (and may carry uj_* tags), frontmatter
 * values carry Liquid. So the Astro candidate still needs a full
 * LiquidJS + template-kit engine for content — that asymmetry is a real
 * migration finding, recorded in the README.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Liquid } from 'liquidjs';
import MarkdownIt from 'markdown-it';
import templateKit from '@omegajs/template-kit';
import frontmatterLiquid from '@omegajs/bakeoff-shared/src/frontmatter-liquid.js';
import { SPIKE, consumerDir } from './paths.mjs';

const { registerLiquid } = templateKit;
const { createFrontmatterResolver } = frontmatterLiquid;

const md = new MarkdownIt({ html: true });

// Per-site-global engine cache (the site object is constant per build)
let engineCache = null;

/**
 * The LiquidJS engine for content bodies, with template-kit registered.
 * timezoneOffset 0: filename dates are UTC midnights (CI Jekyll parity).
 * @param {object} site - the site.* global
 * @returns {{ engine: object, frontmatter: object }}
 */
export function contentEngine(site) {
  if (engineCache && engineCache.site === site) return engineCache;

  const engine = new Liquid({ jekyllInclude: true, timezoneOffset: 0 });
  registerLiquid(engine, {
    site,
    getCollection: () => [],
    getCollectionNames: () => [],
    fileExists: (file) => fs.existsSync(path.join(consumerDir(), file)),
    markdown: (content) => md.render(content),
    icons: {
      fontAwesomeDir: path.join(SPIKE, 'core', 'icons'),
      flagsDir: path.join(SPIKE, 'core', 'icons', 'flags'),
      style: 'solid',
    },
    logos: { dir: path.join(SPIKE, 'core', 'logos') },
  });

  engineCache = { site, engine, frontmatter: createFrontmatterResolver({ site }) };
  return engineCache;
}

/**
 * Render a content entry's body: Liquid → (Markdown when .md).
 * @param {object} entry - content-collection entry (body + filePath)
 * @param {object} site
 * @param {object} scope - extra render scope (page, resolved, …)
 * @returns {string} HTML
 */
export function renderBody(entry, site, scope) {
  const body = entry.body || '';
  if (!body.trim()) return '';

  const { engine } = contentEngine(site);
  const rendered = (body.includes('{{') || body.includes('{%'))
    ? engine.parseAndRenderSync(body, { site, ...scope })
    : body;

  return entry.filePath && entry.filePath.endsWith('.md') ? md.render(rendered) : rendered;
}
