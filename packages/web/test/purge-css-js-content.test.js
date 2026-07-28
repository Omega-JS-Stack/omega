/**
 * #66 — a class that first appears in JS-rendered markup (a client-rendered
 * app builds its own DOM, so the class exists in no .html file) must survive
 * the purge pass: the built JS is content too. Zero config — a consumer's own
 * classes survive `omega build` without a safelist.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { purgeCss } = require('../src/assets.js');

test('purge content: classes referenced only from built JS survive', async () => {
  const outDir = path.join(__dirname, '..', '.omega', 'purge-js-content-test-out');
  const cssDir = path.join(outDir, 'assets', 'css');
  const jsDir = path.join(outDir, 'assets', 'js');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(cssDir, { recursive: true });
  fs.mkdirSync(jsDir, { recursive: true });

  fs.writeFileSync(path.join(cssDir, 'main.css'), [
    '.js-rendered-card{border:1px solid #111}',
    '.statically-used{color:blue}',
    '.never-referenced{color:red}',
  ].join('\n'));
  fs.writeFileSync(path.join(outDir, 'index.html'), '<div class="statically-used" id="app"></div>');
  fs.writeFileSync(
    path.join(jsDir, 'app.js'),
    'document.getElementById("app").innerHTML = `<div class="js-rendered-card">hi</div>`;\n',
  );

  await purgeCss({ outDir, manifest: { css: { main: '/assets/css/main.css' } } });

  const purged = fs.readFileSync(path.join(cssDir, 'main.css'), 'utf8');
  assert.ok(purged.includes('.js-rendered-card'), 'class from JS-built markup survives (#66)');
  assert.ok(purged.includes('.statically-used'), 'statically referenced rule survives');
  assert.ok(!purged.includes('.never-referenced'), 'genuinely unused rule still purges');
});
