/**
 * Devlog publish stage — write the post into the brand's website app and push
 * it live. In the brand-monorepo world the website is an app INSIDE the brand
 * repo (apps/{website}/src), so the commit lands in the brand monorepo itself.
 * Publishing IS the push — the site auto-builds and deploys on push. Only the
 * post file is committed; unrelated dirty files are untouched.
 */

const { execSync } = require('node:child_process');
const { join } = require('node:path');

const jetpack = require('fs-jetpack');

/**
 * Local YYYY-MM-DD stamp — local (not UTC) so a late-night run never
 * future-dates the post, which the site build would silently skip.
 *
 * @param {Date} date - Date to stamp
 * @returns {string} YYYY-MM-DD
 */
function localDateStamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Render the post file (blueprint front matter + markdown body).
 *
 * @param {object} brandConfig - Merged brand config
 * @param {object} post - Generated post { title, slug, description, tags, categories, body }
 * @returns {string} Full post file contents
 */
function renderPostFile(brandConfig, post) {
  return [
    '---',
    'layout: blueprint/blog/post',
    '',
    'post:',
    `  title: ${JSON.stringify(post.title)}`,
    `  description: ${JSON.stringify(post.description)}`,
    `  author: ${brandConfig.brand.id}`,
    `  id: ${Math.floor(Date.now() / 1000)}`,
    `  tags: ${JSON.stringify(post.tags)}`,
    `  categories: ${JSON.stringify(post.categories)}`,
    '---',
    '',
    post.body,
    '',
  ].join('\n');
}

/**
 * Write the post into the brand's website app, commit only the post file in
 * the brand monorepo, and push.
 *
 * @param {object} params - { brand, post } (brand = lib/brand.js loadBrand shape)
 * @returns {{ postPath: string, url: string }} Written file + eventual live URL
 */
function publishToWebsite({ brand, post }) {
  const webApp = brand.apps.find((app) => app.target === 'web');

  if (!webApp) {
    throw new Error(`Brand ${brand.id} has no website app under apps/ — devlog's 'website' destination needs one`);
  }

  const now = new Date();
  const date = localDateStamp(now);
  const relativePath = join(webApp.dir, 'src', '_posts', String(now.getFullYear()), brand.config.devlog.postPath, `${date}-${post.slug}.md`);
  const postPath = join(brand.root, relativePath);

  jetpack.write(postPath, renderPostFile(brand.config, post));

  const git = (args) => execSync(`git ${args}`, { cwd: brand.root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  git(`add "${relativePath}"`);
  git(`commit -m "📦 Omega: Add devlog post ${date}-${post.slug}" -- "${relativePath}"`);
  git('push');

  return {
    postPath,
    url: `${brand.config.brand.url}/blog/${post.slug}`,
  };
}

module.exports = { publishToWebsite, renderPostFile };
