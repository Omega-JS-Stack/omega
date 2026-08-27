/**
 * markdown-it typographer (#547): Kramdown smartened quotes, apostrophes,
 * dashes and ellipses at build time, so every brand converted off Jekyll drifts
 * the moment its prose renders straight. `typographer: true` is the hard
 * default on BOTH markdown instances — Eleventy's own (a .md body) and the
 * engine's (template-kit's markdownify filter) — so the same prose is the same
 * punctuation wherever it renders.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

function makeConsumer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-typographer-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'prose.md'), [
    '---',
    'layout: frontend/core/base',
    'permalink: /prose',
    '---',
    '',
    'It\'s the brand\'s "flagship" plan -- the one everyone asks about...',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(consumerDir, 'pages', 'filtered.html'), [
    '---',
    'layout: frontend/core/base',
    'permalink: /filtered',
    '---',
    '<div id="apostrophe">{{ "It\'s here" | markdownify }}</div>',
    '<div id="quotes">{{ \'He said "hi"\' | markdownify }}</div>',
    '',
  ].join('\n'));
  return { tmp, consumerDir };
}

test('#547: a .md body renders straight punctuation as smart (Kramdown parity)', async () => {
  const { tmp, consumerDir } = makeConsumer();
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'typographer-md');
    const html = pages.get('/prose');
    assert.ok(html, 'the prose page built');

    assert.ok(html.includes('It’s the brand’s'), 'apostrophes curl');
    assert.ok(html.includes('“flagship”'), 'double quotes curl');
    assert.ok(html.includes('plan – the one'), '-- becomes an en dash');
    assert.ok(html.includes('asks about…'), '... becomes an ellipsis');
    assert.ok(!html.includes("It's the brand's"), 'no straight apostrophes survive in the body');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#547: the markdownify filter smartens the same way (one markdown contract)', async () => {
  const { tmp, consumerDir } = makeConsumer();
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'typographer-filter');
    const html = pages.get('/filtered');
    assert.ok(html, 'the filtered page built');

    assert.ok(html.includes('It’s here'), 'the engine markdown instance curls apostrophes');
    assert.ok(html.includes('He said “hi”'), 'the engine markdown instance curls quotes');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
