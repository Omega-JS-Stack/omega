/**
 * cp139 — the site meta-files (UJM parity, gap-audit closure): sitemap.xml,
 * RSS + JSON feeds (the /feeds/posts.xml link every page's head carries
 * stops dangling), robots.txt, ads.txt, humans.txt, opensearch.xml,
 * pages.json, .well-known/security.txt — all default pages (consumer files
 * at the same URL suppress them like any other default page).
 *
 * Correctness upgrades over legacy pinned here: JSON outputs are VALID BY
 * CONSTRUCTION (uj_json_escape + first-flag commas — legacy's trailing-comma
 * bug when the last item was skipped is impossible), and the machine files
 * exclude each other (legacy pages.json listed robots.txt as a search hit).
 */
const assert = require('node:assert');
const { test, before } = require('node:test');
const { buildWith, miniData } = require('./lib/build.js');

let pages;
before(async () => {
  pages = await buildWith({
    ...miniData,
    advertising: { providers: { 'google-adsense': { client: 'ca-pub-1234567890' } } },
    socials: { twitter: 'https://twitter.com/minico' },
  }, {}, 'meta-files');
});

test('sitemap.xml: real pages in, machine/redirect/test pages out', () => {
  const xml = pages.get('/sitemap.xml');
  assert.ok(xml.includes('<urlset'), 'sitemap renders');

  // Real pages with absolute locs; the root page collapses to the bare url
  assert.ok(xml.includes('<loc>https://mini.example.com</loc>'), 'root page, no trailing slash');
  assert.ok(xml.includes('<loc>https://mini.example.com/about</loc>'), 'consumer page listed');
  assert.ok(xml.includes('<loc>https://mini.example.com/pricing</loc>'), 'default-page channel listed');
  assert.ok(/<priority>1.0<\/priority>/.test(xml), 'root priority 1.0');
  assert.ok(/<changefreq>weekly<\/changefreq>/.test(xml), 'default changefreq');
  assert.ok(/<lastmod>\d{4}-\d{2}-\d{2}T/.test(xml), 'build-stamp lastmod');

  // Exclusions: redirects (sitemap.include false), test pages, admin, the meta files themselves
  assert.ok(!xml.includes('/login'), 'auth redirects excluded');
  assert.ok(!xml.includes('/test/'), 'test pages excluded');
  assert.ok(!xml.includes('/admin/'), 'admin pages excluded');
  assert.ok(!xml.includes('sitemap.xml</loc>') && !xml.includes('robots.txt'), 'machine files exclude themselves');
});

test('robots.txt: blocks admin/test, points at the sitemap', () => {
  const robots = pages.get('/robots.txt');
  assert.ok(robots.includes('Disallow: /admin/'));
  assert.ok(robots.includes('Disallow: /test/'));
  assert.ok(robots.includes('Sitemap: https://mini.example.com/sitemap.xml'));
});

test('feeds/posts.xml: RSS with every fixture post, absolute guids, rendered content', () => {
  const rss = pages.get('/feeds/posts.xml');
  assert.ok(rss.includes('<rss'), 'RSS envelope');
  assert.ok(rss.includes('MiniCo Blog'), 'channel title from brand');

  const items = rss.match(/<item>/g) || [];
  assert.strictEqual(items.length, 2, 'both fixture posts in the feed');
  assert.ok(rss.includes('First post') && rss.includes('Second post'), 'post titles');
  assert.ok(/<guid isPermaLink="true">\s*https:\/\/mini\.example\.com\/blog\//.test(rss), 'absolute post guids');
  assert.ok(rss.includes('Alpha bravo charlie'), 'rendered post content in content:encoded');
  assert.ok(/<pubDate>\w{3}, \d{2} \w{3} \d{4}/.test(rss), 'RFC822-style pubDate');
  assert.ok(rss.includes('<category><![CDATA[ Growth ]]></category>'), 'first category');
});

test('feeds/posts.json: VALID JSON Feed (legacy trailing-comma bug impossible)', () => {
  const feed = JSON.parse(pages.get('/feeds/posts.json'));
  assert.strictEqual(feed.version, 'https://jsonfeed.org/version/1');
  assert.strictEqual(feed.title, 'MiniCo Blog');
  assert.strictEqual(feed.items.length, 2);

  const first = feed.items[0];
  assert.ok(first.url.startsWith('https://mini.example.com/blog/'));
  assert.ok(first.content_text.length > 0, 'text content present');
  assert.ok(first.content_html.length > 0, 'html content present');
  assert.match(first.date_published, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Array.isArray(first.tags), 'tags from post categories');
});

test('pages.json: VALID search index — real pages with titles, machine files out', () => {
  const index = JSON.parse(pages.get('/pages.json'));
  assert.ok(Array.isArray(index) && index.length > 0);

  const urls = index.map((entry) => entry.url);
  assert.ok(urls.includes('https://mini.example.com/about'), 'consumer page indexed');
  assert.ok(!urls.some((url) => url.includes('robots.txt') || url.includes('sitemap.xml')), 'machine files not search hits');
  assert.ok(!urls.some((url) => url.includes('/test/') || url.includes('/admin/')), 'test/admin out of the index');

  const post = index.find((entry) => entry.type === 'post');
  assert.ok(post, 'posts carry type post');
  assert.ok(post.title.length > 0, 'post title populated');
});

test('ads.txt: renders the configured AdSense client with the ca- prefix stripped', () => {
  assert.match(pages.get('/ads.txt'), /^google\.com, pub-1234567890, DIRECT, f08c47fec0942fa0$/m);
});

test('humans.txt + opensearch.xml + security.txt: brand-derived, no empties', () => {
  const humans = pages.get('/humans.txt');
  assert.ok(humans.includes('Website: MiniCo'));
  assert.ok(humans.includes('Twitter: https://twitter.com/minico'), 'socials render when configured');
  assert.ok(humans.includes('OMEGA (@omega.js/web)'), 'honest framework credit');

  const opensearch = pages.get('/opensearch.xml');
  assert.ok(opensearch.includes('<ShortName>MiniCo</ShortName>'));
  assert.ok(opensearch.includes('https://mini.example.com/assets/images/favicon/favicon-32x32.png'), 'minted favicon path');

  const security = pages.get('/.well-known/security.txt');
  assert.ok(security.includes('Contact: https://mini.example.com/contact'));
  const expires = security.match(/Expires: (\d{4})-12-31/);
  assert.strictEqual(Number(expires[1]), new Date().getFullYear() + 1, 'expires one year out');
});

test('ads.txt without advertising config: honest comment, never a broken record', async () => {
  const bare = await buildWith(miniData, {}, 'meta-files-bare');
  assert.match(bare.get('/ads.txt'), /^# No advertising providers configured$/m);
  assert.ok(!bare.get('/ads.txt').includes('google.com,'), 'no fabricated AdSense line');

  // And humans.txt drops the socials line instead of rendering an empty field
  assert.ok(!bare.get('/humans.txt').includes('Twitter:'), 'unconfigured socials line dropped');
});
