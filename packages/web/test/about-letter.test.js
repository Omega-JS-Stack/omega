/**
 * #456 — the about page's letter band. Two consumer holes, one file each:
 * the layout rendered the band unconditionally (only the gallery had a gate),
 * and the section hardcoded a demo ops feed, so every brand's /about claimed
 * "v2.4 shipped to production" with no way out. The band now takes the
 * gallery's `letter: false` gate, and the feed rides args whose defaults are
 * the placeholder copy (the photo-band idiom). Pinned over real builds: the
 * packaged default page for the untouched rendering, a consumer sidecar
 * (#269, the page-level data lane) for both overrides.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

/** A consumer /about riding the blueprint, with its band data in the sidecar. */
function makeConsumer(sidecar) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-about-letter-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(
    path.join(consumerDir, 'pages', 'about.md'),
    ['---', 'layout: blueprint/about', 'permalink: /about', '---', ''].join('\n'),
  );
  fs.writeFileSync(
    path.join(consumerDir, 'pages', 'about.11tydata.json'),
    `${JSON.stringify(sidecar, null, 2)}\n`,
  );
  return { tmp, consumerDir };
}

test('#456: letter: false kills the band — the gallery gate, on the letter', async () => {
  const { tmp, consumerDir } = makeConsumer({ letter: false });
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'about-letter-off');
    const html = pages.get('/about');
    assert.ok(html, 'the about page built');

    assert.ok(!html.includes('omega-fragment'), 'the ops feed is gone');
    assert.ok(!html.includes('omega-statement'), 'and so are the mission/vision statements');
    assert.ok(!html.includes('All systems go'), 'no status chip survives the opt-out');
    // The rest of the composition is untouched — the gate kills one band.
    assert.ok(html.includes('omega-timeline'), 'the journey still renders');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#456: a brand\'s own feed items and status chip replace the placeholder copy', async () => {
  const { tmp, consumerDir } = makeConsumer({
    letter: {
      feed_items: [
        { icon: 'code-branch', text: 'The <strong>2.0</strong> rewrite landed' },
        { icon: 'user-plus', text: 'Priya joined the support desk' },
      ],
      feed_status: 'Shipping daily',
    },
  });
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'about-letter-feed');
    const html = pages.get('/about');
    assert.ok(html, 'the about page built');

    assert.ok(html.includes('The <strong>2.0</strong> rewrite landed'), 'the brand item renders, markup and all');
    assert.ok(html.includes('Priya joined the support desk'), 'every supplied item renders');
    assert.ok(html.includes('Shipping daily'), 'the brand names its own status chip');
    assert.equal((html.match(/omega-fragment__msg"/g) || []).length, 2, 'exactly the supplied items — the demo feed is REPLACED, not appended to');
    assert.ok(!html.includes('shipped to production'), 'no fabricated release claim survives');
    assert.ok(!html.includes('All systems go'), 'nor the default chip');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#456: no letter data — the packaged about page renders the placeholder feed, unchanged', async () => {
  const pages = await buildSite(BARE, bareData, { environment: 'development' }, 'about-letter-default');
  const html = pages.get('/about');
  assert.ok(html, 'the packaged about page built');

  assert.ok(html.includes('This week at BareCo'), 'the feed label still liquifies against the brand');
  assert.ok(html.includes('<strong>v2.4</strong> shipped to production'), 'the placeholder feed is byte-identical');
  assert.ok(html.includes('Two new faces on support'), 'item two, unchanged');
  assert.ok(html.includes('"Best tool we\'ve adopted this year"'), 'item three, unchanged');
  assert.ok(html.includes('All systems go'), 'and the status chip');
  assert.equal((html.match(/omega-fragment__msg"/g) || []).length, 3, 'three feed messages, as before');
});
