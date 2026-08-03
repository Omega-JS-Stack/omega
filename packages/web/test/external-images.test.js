/**
 * External-image guard (#154): a theme never hotlinks a picture. Classy's
 * default about/pricing pages (and the about sections behind them) shipped
 * `images.unsplash.com` URLs, so a consumer's live site pulled its own
 * default imagery off a third-party CDN — the same violation the exit
 * popup's `i.pravatar.cc` faces were fixed for. Default imagery SHIPS with
 * the framework (core/images/*, bridged to /assets/images/core) or the page
 * carries none at all.
 *
 * Scope is the theme layer, where the default pages and section defaults
 * live. Prose elsewhere may still name the hosts (the admin editor's URL
 * input placeholder, cachebreak's external-URL unit fixture) — those load
 * nothing. defaults/sample-posts and defaults/sample-team still hotlink for
 * real and sit outside this walk: that cleanup is #158, which also widens
 * this guard to cover defaults/.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const PKG = path.resolve(__dirname, '..');
const THEMES = path.join(PKG, 'themes');

// Hotlink hosts the framework has already retired once.
const BANNED = [/images\.unsplash\.com/, /i\.pravatar\.cc/];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'bootstrap']);
const SCAN_EXTENSIONS = new Set(['.html', '.json5', '.json', '.md', '.js', '.scss', '.css']);

/**
 * Every scannable file under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...walk(path.join(dir, entry.name)));
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

test('#154: no packaged theme hotlinks an image host', () => {
  const sightings = [];

  for (const file of walk(THEMES)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of BANNED) {
      if (!pattern.test(text)) continue;
      const line = text.split('\n').findIndex((each) => pattern.test(each)) + 1;
      sightings.push(`${path.relative(PKG, file)}:${line} — ${pattern}`);
    }
  }

  assert.deepStrictEqual(sightings, [], `theme imagery is hotlinked again:\n${sightings.join('\n')}`);
});

test('#154: the placeholder imagery the defaults point at ships with the package', () => {
  const referenced = [];
  for (const file of walk(THEMES)) {
    const text = fs.readFileSync(file, 'utf8');
    referenced.push(...[...text.matchAll(/\/assets\/images\/core\/(\S+?\.jpg)/g)].map((match) => match[1]));
  }

  assert.ok(referenced.length >= 3, 'the theme defaults ride the shipped pictures');
  for (const rel of new Set(referenced)) {
    assert.ok(
      fs.existsSync(path.join(PKG, 'core', 'images', ...rel.split('/'))),
      `core/images/${rel} ships with the package`,
    );
  }
});
