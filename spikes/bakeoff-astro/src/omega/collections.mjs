/**
 * collections.mjs — Jekyll-doc-shaped collections for the uj_* tags
 * (uj_member / uj_post take `ctx.site.getCollection(name)` returning docs
 * shaped { id, url, data }). The team collection is read straight from the
 * consumer's `_team/*.md` — it never routes, so it stays outside the Astro
 * content layer.
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { consumerDir } from './paths.mjs';

// Cache keyed by consumer dir (test builds switch consumers in-process)
let cache = null;

/**
 * Get a collection's docs ({ id, url, data }).
 * @param {string} name
 * @returns {object[]}
 */
export function getCollection(name) {
  if (name !== 'team') return [];

  const dir = path.join(consumerDir(), '_team');
  if (!cache || cache.dir !== dir) cache = { dir, docs: loadTeam(dir) };
  return cache.docs;
}

/**
 * Collection names with docs present.
 * @returns {string[]}
 */
export function getCollectionNames() {
  return getCollection('team').length ? ['team'] : [];
}

function loadTeam(dir) {
  if (!fs.existsSync(dir)) return [];

  const docs = [];
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const { data } = matter.read(path.join(entry.parentPath, entry.name));
    const slug = entry.name.replace(/\.md$/, '');
    docs.push({ id: `/_team/${slug}`, url: permalinkUrl(data.permalink) || `/team/${slug}/`, data });
  }

  return docs.sort((a, b) => a.url.localeCompare(b.url));
}

// Jekyll pretty-URL normalization: extensionless permalinks get a trailing slash
function permalinkUrl(permalink) {
  if (!permalink || typeof permalink !== 'string') return null;
  return path.extname(permalink) || permalink.endsWith('/') ? permalink : `${permalink}/`;
}
