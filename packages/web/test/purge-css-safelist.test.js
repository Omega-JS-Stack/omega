/**
 * Wave-3 W3/W10 — the PurgeCSS safelist keeps what the content scan can
 * never see: Bootstrap's JS-toggled transition classes (`.collapsing` and
 * friends snap without it — M19, verified empirically on the mobile nav)
 * and every omega-namespaced selector (runtime-stamped attributes like
 * data-omega-scrolled, which neobrutalism's navbar shadow now rides).
 * Anything genuinely unused still purges.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { purgeCss } = require('../src/assets.js');

test('purge safelist: Bootstrap runtime classes + omega-stamped attributes survive; unused rules purge', async () => {
  const outDir = path.join(__dirname, '..', '.omega', 'purge-safelist-test-out');
  const cssDir = path.join(outDir, 'assets', 'css');
  fs.mkdirSync(cssDir, { recursive: true });

  fs.writeFileSync(path.join(cssDir, 'main.css'), [
    '.collapsing{height:0;transition:height .35s ease}',
    '.fade{transition:opacity .15s linear}',
    ".navbar-floating[data-omega-scrolled='true']{box-shadow:0 2px 0 #111}",
    '.statically-used{color:blue}',
    '.never-referenced{color:red}',
  ].join('\n'));
  fs.writeFileSync(path.join(outDir, 'index.html'), '<div class="statically-used navbar-floating"></div>');

  await purgeCss({ outDir, manifest: { css: { main: '/assets/css/main.css' } } });

  const purged = fs.readFileSync(path.join(cssDir, 'main.css'), 'utf8');
  assert.ok(purged.includes('.collapsing'), 'Bootstrap collapse transition survives (M19)');
  assert.ok(purged.includes('.fade'), 'Bootstrap fade survives');
  assert.ok(purged.includes("data-omega-scrolled"), 'omega-stamped attribute selector survives (W10)');
  assert.ok(purged.includes('.statically-used'), 'statically referenced rule survives');
  assert.ok(!purged.includes('.never-referenced'), 'genuinely unused rule still purges');
});
