/**
 * resolved parity repair (found by content pass A, cp225): Eleventy's data
 * cascade CONCATS a page array onto a layout-default array and lets a
 * layout-default object beat a page scalar — breaking the documented
 * inject-properties.rb contract ("page wins its own keys"). The engine now
 * re-applies the page's own frontmatter over the cascade with the shared
 * deepMerge. Pinned against the real classy about layout (arrays, object
 * kill switch, partial-object override) through a real build.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

test('page frontmatter beats layout defaults: arrays replace, false kills, partials keep siblings', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-resolved-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'about.md'), [
    '---',
    'layout: blueprint/about',
    'permalink: /about',
    '',
    '# Partial object override — headline replaces, the layout default',
    '# description must survive as a sibling.',
    'hero:',
    '  headline: "Our page-owned <em>headline</em>"',
    '',
    '# Array override — these TWO items must be the whole timeline.',
    'story:',
    '  items:',
    '    - year: "2001"',
    '      title: "Page moment one for {{ site.brand.name }}"',
    '      description: "First"',
    '    - year: "2002"',
    '      title: "Page moment two"',
    '      description: "Second"',
    '',
    '# Scalar kill switch over an object default.',
    'gallery: false',
    '---',
  ].join('\n'));

  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'resolved-wins');
    const page = pages.get('/about');
    assert.ok(page, 'about page built');

    // Arrays REPLACE — the page's two moments, and NONE of the layout's four
    assert.ok(page.includes('Page moment two'), 'page timeline items render');
    assert.ok(page.includes(`Page moment one for ${bareData.brand.name}`), 'page items liquify against site scope');
    assert.ok(!page.includes('The beginning'), 'layout default timeline items are GONE (no concat)');
    assert.ok(!page.includes('Rapid growth'), 'no concatenated leftovers');

    // Scalar false kills the layout's object default
    assert.ok(!page.includes('unsplash'), 'gallery: false kills the photo band');

    // Partial object override keeps layout siblings
    assert.ok(page.includes('Our page-owned <em>headline</em>'), 'page hero headline wins');
    assert.ok(page.includes('stubborn opinions'), 'layout hero description default survives the partial override');

    // Untouched keys keep full layout defaults
    assert.ok(page.includes('Innovation first'), 'values untouched by the page keep layout defaults');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
