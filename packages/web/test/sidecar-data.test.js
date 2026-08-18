/**
 * The sidecar data lane (#269): consumer page frontmatter is meta-only, so a
 * page's `<page>.11tydata.json` sidecar is the page-level lane for a SHELL
 * layout's band data (its bands read `resolved.*`). Eleventy's cascade CONCATS
 * a sidecar array onto the layout's default array — a page could append to a
 * band, never replace it. `resolved` re-applies the sidecar with the engine's
 * own semantics: arrays REPLACE, objects/strings keep the cascade's merge.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

// A shell layout in miniature: default band data in its own frontmatter, read
// back through `resolved.*` — the shape every packaged shell layout has.
const SHELL_LAYOUT = [
  '---',
  'stats:',
  '  headline: "Layout headline"',
  '  eyebrow: "Layout eyebrow"',
  '  items:',
  '    - label: "Default one"',
  '    - label: "Default two"',
  'contact_methods:',
  '  - label: "Default channel"',
  'note: "layout note"',
  '---',
  '<h2>{{ resolved.stats.headline }}</h2>',
  '<p>{{ resolved.stats.eyebrow }}</p>',
  '<ul>{% for item in resolved.stats.items %}<li>{{ item.label }}</li>{% endfor %}</ul>',
  '<ul>{% for method in resolved.contact_methods %}<li>{{ method.label }}</li>{% endfor %}</ul>',
  '<p>{{ resolved.note }}</p>',
  '',
].join('\n');

function makeConsumer(sidecar) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-sidecar-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(consumerDir, '_layouts'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, '_layouts', 'shell.html'), SHELL_LAYOUT);
  fs.writeFileSync(path.join(consumerDir, 'pages', 'index.html'), [
    '---',
    'layout: shell',
    'permalink: /',
    '---',
    '',
  ].join('\n'));
  if (sidecar) {
    fs.writeFileSync(path.join(consumerDir, 'pages', 'index.11tydata.json'), `${JSON.stringify(sidecar, null, 2)}\n`);
  }
  return { tmp, consumerDir };
}

test('#269: a sidecar array REPLACES the shell layout default — no cascade concat', async () => {
  const { tmp, consumerDir } = makeConsumer({
    stats: { items: [{ label: 'Sidecar only' }] },
    contact_methods: [{ label: 'Sidecar channel' }],
  });
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'sidecar-array');
    const html = pages.get('/');
    assert.ok(html, 'page built');

    assert.ok(html.includes('<li>Sidecar only</li>'), 'the sidecar item renders');
    assert.ok(!html.includes('Default one'), 'the layout default items are REPLACED, not appended to');
    assert.ok(!html.includes('Default two'), 'neither layout default survives the replace');

    // Top-level arrays too — the StudyMonkey `contact_methods: null` trap.
    assert.ok(html.includes('<li>Sidecar channel</li>'), 'a top-level sidecar array renders');
    assert.ok(!html.includes('Default channel'), 'the top-level layout default is replaced');

    assert.equal((html.match(/<li>/g) || []).length, 2, 'exactly the two sidecar items — no concat duplicates');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#269: object and string sidecar keys keep today\'s merge', async () => {
  const { tmp, consumerDir } = makeConsumer({
    stats: { headline: 'Sidecar headline' },
    note: 'sidecar note',
  });
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'sidecar-merge');
    const html = pages.get('/');
    assert.ok(html, 'page built');

    assert.ok(html.includes('<h2>Sidecar headline</h2>'), 'the sidecar string wins its key');
    assert.ok(html.includes('<p>Layout eyebrow</p>'), 'the layout\'s other object keys merge underneath');
    assert.ok(html.includes('<p>sidecar note</p>'), 'a top-level string key wins');
    assert.ok(
      html.includes('<li>Default one</li>') && html.includes('<li>Default two</li>'),
      'arrays the sidecar never names keep the layout defaults',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#269: a page with no sidecar keeps the layout defaults', async () => {
  const { tmp, consumerDir } = makeConsumer(null);
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'sidecar-absent');
    const html = pages.get('/');
    assert.ok(html, 'page built');

    assert.ok(html.includes('<h2>Layout headline</h2>'), 'the layout headline stands');
    assert.ok(html.includes('<li>Default one</li>') && html.includes('<li>Default two</li>'), 'both default items render');
    assert.ok(html.includes('<li>Default channel</li>'), 'the top-level default array renders');
    assert.ok(html.includes('<p>layout note</p>'), 'the layout string stands');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
