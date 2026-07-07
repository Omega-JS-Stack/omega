/**
 * generate-corpus.test.js — corpus generator verification.
 *
 * Proves: exact counts vs the somiibo-measured spec, byte-determinism
 * (same seed → identical tree), seed sensitivity, Jekyll filename convention,
 * frontmatter shape, and the {{ site.* }}-in-frontmatter stressor.
 */

// Libraries
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jetpack = require('fs-jetpack');
const { generateCorpus } = require('../src/generate-corpus.js');
const spec = require('../src/corpus-spec.js');

/**
 * Hash every file in a tree (relative path + content) into one digest.
 * @param {string} dir
 * @returns {string}
 */
function treeHash(dir) {
  const files = jetpack.find(dir, { matching: '**/*', files: true, directories: false }).sort();
  const hash = crypto.createHash('md5');
  for (const file of files) {
    hash.update(path.relative(dir, file));
    hash.update(jetpack.read(file, 'buffer'));
  }
  return hash.digest('hex');
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bakeoff-corpus-'));
}

test('corpus matches the somiibo-measured spec exactly', () => {
  const out = tmpDir();
  const manifest = generateCorpus({ outDir: out });

  // Counts
  assert.strictEqual(manifest.counts.posts, 1030);
  assert.strictEqual(manifest.counts.pages, 105);
  assert.strictEqual(manifest.counts.alternatives, 20);

  // Per-dir post distribution matches spec
  for (const [dir, count] of Object.entries(spec.POSTS_PER_DIR)) {
    const found = jetpack.find(path.join(out, '_posts', dir), { matching: '*.md' });
    assert.strictEqual(found.length, count, `_posts/${dir} should have ${count} posts`);
  }

  // Page mix: 99 .md + 6 .html like somiibo
  const pageFiles = jetpack.find(path.join(out, 'pages'), { matching: '**/*', files: true });
  assert.strictEqual(pageFiles.filter((f) => f.endsWith('.md')).length, 99);
  assert.strictEqual(pageFiles.filter((f) => f.endsWith('.html')).length, 6);

  // Word stats in the measured ballpark (quartile-bucket sampling)
  assert.ok(manifest.postWordStats.min >= 300, `min ${manifest.postWordStats.min} >= 300`);
  assert.ok(manifest.postWordStats.median >= 800 && manifest.postWordStats.median <= 1500,
    `median ${manifest.postWordStats.median} in [800, 1500]`);
  assert.ok(manifest.postWordStats.max <= 8000, `max ${manifest.postWordStats.max} <= 8000`);

  jetpack.remove(out);
});

test('same seed produces a byte-identical tree; different seed does not', () => {
  const a = tmpDir();
  const b = tmpDir();
  const c = tmpDir();

  generateCorpus({ outDir: a, seed: 42 });
  generateCorpus({ outDir: b, seed: 42 });
  generateCorpus({ outDir: c, seed: 7 });

  assert.strictEqual(treeHash(a), treeHash(b), 'seed 42 twice must be byte-identical');
  assert.notStrictEqual(treeHash(a), treeHash(c), 'different seed must produce different content');

  jetpack.remove(a);
  jetpack.remove(b);
  jetpack.remove(c);
});

test('posts follow the Jekyll filename convention and frontmatter contract', () => {
  const out = tmpDir();
  generateCorpus({ outDir: out });

  const posts = jetpack.find(path.join(out, '_posts'), { matching: '**/*.md' });
  for (const post of posts) {
    assert.match(path.basename(post), /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/,
      `${path.basename(post)} must be YYYY-MM-DD-slug.md`);
  }

  // Spot-check frontmatter shape on one post
  const sample = jetpack.read(posts[0]);
  assert.match(sample, /^---\n/);
  assert.match(sample, /layout: blueprint\/blog\/post/);
  assert.match(sample, /post:\n {2}title: "/);
  assert.match(sample, /\n {2}author: /);
  assert.match(sample, /\n {2}tags: \[/);
  assert.match(sample, /\n {2}categories: \[/);

  jetpack.remove(out);
});

test('pages carry the variable-resolver stressor and layout mix', () => {
  const out = tmpDir();
  generateCorpus({ outDir: out });

  const pageFiles = jetpack.find(path.join(out, 'pages'), { matching: '**/*', files: true });
  const contents = pageFiles.map((f) => jetpack.read(f));

  // {{ site.* }} refs inside frontmatter values (variable_resolver.rb equivalent)
  const withSiteRefs = contents.filter((c) => c.includes('{{ site.brand.name }}'));
  assert.ok(withSiteRefs.length >= 90, `${withSiteRefs.length} pages reference {{ site.brand.name }}`);

  // Layout distribution matches somiibo
  const layoutCount = (name) => contents.filter((c) => c.includes(`layout: ${name}\n`)).length;
  assert.strictEqual(layoutCount('platform-bot'), 59);
  assert.strictEqual(layoutCount('solution'), 32);
  assert.strictEqual(layoutCount('package'), 5);
  assert.strictEqual(layoutCount('themes/[ site.theme.id ]/frontend/core/base'), 6);

  // site-data.json provides the resolution source
  const siteData = jetpack.read(path.join(out, 'site-data.json'), 'json');
  assert.strictEqual(siteData.brand.name, 'Bakeoff');
  assert.strictEqual(siteData.theme.id, 'classy');

  jetpack.remove(out);
});
