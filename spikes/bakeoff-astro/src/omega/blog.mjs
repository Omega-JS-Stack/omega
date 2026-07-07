/**
 * blog.mjs — posts, pagination, and taxonomy over the content collections
 * (Jekyll conventions: dated `_posts` filenames → `/blog/<slug>/`; taxonomy
 * aggregated from `post.categories` / `post.tags`).
 */
import { getCollection } from 'astro:content';
import { slugify } from './uj.mjs';

export const PAGE_SIZE = 10;

/**
 * All posts, newest first, with date/slug/url parsed from the Jekyll
 * filename convention (`YYYY-MM-DD-slug.md`).
 * @returns {Promise<Array<{ entry: object, date: Date, slug: string, url: string }>>}
 */
export async function sortedPosts() {
  const entries = await getCollection('posts');

  const posts = entries.map((entry) => {
    const base = entry.id.split('/').pop();
    const match = base.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
    const date = new Date(`${match ? match[1] : '1970-01-01'}T00:00:00Z`);
    const slug = match ? match[2] : base;
    return { entry, date, slug, url: `/blog/${slug}/` };
  });

  // Slug tie-break: same-date posts must order identically across engines
  return posts.sort((a, b) => (b.date - a.date) || a.slug.localeCompare(b.slug));
}

/**
 * Slice posts into pagination pages (page numbers are 1-based; page 1 is
 * `/blog/`, page N is `/blog/page/N/`).
 * @param {Array} posts - from sortedPosts()
 * @returns {Array<{ number: number, url: string, items: Array, previous: string|null, next: string|null, total: number }>}
 */
export function paginate(posts) {
  const total = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
  const urlOf = (number) => (number === 1 ? '/blog/' : `/blog/page/${number}/`);

  return Array.from({ length: total }, (unused, index) => {
    const number = index + 1;
    return {
      number,
      url: urlOf(number),
      items: posts.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE),
      previous: number > 1 ? urlOf(number - 1) : null,
      next: number < total ? urlOf(number + 1) : null,
      total,
    };
  });
}

/**
 * Aggregate the blog taxonomy from posts' `post.categories` / `post.tags`.
 * @param {Array} posts - from sortedPosts()
 * @param {string} field - 'categories' | 'tags'
 * @returns {Array<{ name: string, slug: string, posts: Array }>}
 */
export function aggregateTaxonomy(posts, field) {
  const groups = new Map();

  for (const post of posts) {
    for (const name of (post.entry.data.post && post.entry.data.post[field]) || []) {
      if (!groups.has(name)) groups.set(name, { name, slug: slugify(name), posts: [] });
      groups.get(name).posts.push(post);
    }
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
