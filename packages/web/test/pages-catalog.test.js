/**
 * The page's entry in `pages.json`, the catalog the site's own search box
 * reads ([#858](https://github.com/Omega-JS-Stack/omega/issues/858),
 * Ian 2026-09-13: "sure catalog").
 *
 * The keys used to be `search.include` / `search.category`, which named the
 * same thing as the config `search` section (Search Console), and that is
 * the pair Ian's same-name ruling forbids. `catalog` is the page's half now,
 * page-only: there is no site-wide catalog default, and `search` in
 * omega.json5 means the provider section and nothing else.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

/** A consumer whose `pages/` carries the given extra pages (name → lines). */
function makeConsumer(extraPages) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-catalog-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.cpSync(path.join(BARE, 'pages'), path.join(consumerDir, 'pages'), { recursive: true });

  for (const [name, lines] of Object.entries(extraPages)) {
    fs.writeFileSync(path.join(consumerDir, 'pages', name), `${lines.join('\n')}\n`);
  }

  return { tmp, consumerDir };
}

const PAGE = (permalink, title, extra = []) => [
  '---',
  'layout: frontend/core/base',
  `permalink: ${permalink}`,
  'meta:',
  `  title: "${title}"`,
  ...extra,
  '---',
  '<section><h2>Body</h2></section>',
];

test('#858: `catalog.include: false` drops the page from pages.json, and only from there', async () => {
  const { tmp, consumerDir } = makeConsumer({
    'listed.html': PAGE('/listed', 'Listed'),
    'unlisted.html': PAGE('/unlisted', 'Unlisted', ['catalog:', '  include: false']),
  });

  try {
    const built = await buildSite(consumerDir, bareData, {}, 'catalog-include');
    const urls = JSON.parse(built.get('/pages.json')).map((entry) => entry.url);

    assert.ok(urls.includes(`${bareData.url}/listed`), 'an ordinary page is a catalog entry');
    assert.ok(!urls.includes(`${bareData.url}/unlisted`), 'catalog.include: false takes it out');

    // It is a SEARCH-BOX opt-out, never an index posture: the page still ships
    // indexable and still sits in the sitemap.
    assert.ok(built.get('/unlisted').includes('<meta name="robots" content="index'), 'still indexable');
    assert.ok(built.get('/sitemap.xml').includes(`<loc>${bareData.url}/unlisted</loc>`), 'still in the sitemap');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#858: `catalog.category` sets the entry\'s category', async () => {
  const { tmp, consumerDir } = makeConsumer({
    'guide.html': PAGE('/guide', 'Guide', ['catalog:', '  category: "Docs"']),
  });

  try {
    const built = await buildSite(consumerDir, bareData, {}, 'catalog-category');
    const entry = JSON.parse(built.get('/pages.json')).find((item) => item.url === `${bareData.url}/guide`);

    assert.ok(entry, 'the page is a catalog entry');
    assert.equal(entry.category, 'Docs');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// No dual-read (#858): the old spelling is not quietly honoured. `search` is
// not on the frontmatter allow-list, and it IS a config section, so a page
// still writing it FAILS the build the way any bare config section does.
test('#858: a page still writing the old `search:` keys fails the frontmatter guard', async () => {
  const { tmp, consumerDir } = makeConsumer({
    'legacy.html': PAGE('/legacy', 'Legacy', ['search:', '  include: false']),
  });

  try {
    await assert.rejects(
      () => buildSite(consumerDir, bareData, {}, 'catalog-legacy'),
      (error) => {
        // Eleventy wraps a preprocessor throw, so the engine's message is down
        // the originalError/cause chain.
        const parts = [];
        for (let node = error; node; node = node.originalError || node.cause) parts.push(node.message);
        const message = parts.join(' | ');
        assert.match(message, /legacy\.html/, 'the error names the file');
        assert.match(message, /`search`/, 'the error names the retired key');
        return true;
      },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
