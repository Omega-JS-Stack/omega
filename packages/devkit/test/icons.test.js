/**
 * emitIcons — the runtime icon-set emission (C4 cp112): the site output
 * gains assets/icons/<style>/<name>.svg from the resolved chain, best source
 * winning per file, curated core icons on top.
 *
 * createIconLoader — the BUILD-side read of the same chain (#619), so web's
 * build-time inlining and the browser's runtime fetch draw from one set.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { emitIcons, createIconLoader } = require('../src/icons.js');

function makeDir(base, rel, content) {
  const file = path.join(base, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('emitIcons merges the chain best-first with core curation on top', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-emit-'));
  const pro = path.join(tmp, 'pro');
  const free = path.join(tmp, 'free');
  const core = path.join(tmp, 'core-icons');
  const out = path.join(tmp, 'out');

  makeDir(pro, 'solid/acorn.svg', '<svg>pro-acorn</svg>');
  makeDir(pro, 'solid/play.svg', '<svg>pro-play</svg>');
  makeDir(free, 'solid/play.svg', '<svg>free-play</svg>');
  makeDir(free, 'solid/circle-user.svg', '<svg>free-circle-user</svg>');
  makeDir(free, 'brands/github.svg', '<svg>free-github</svg>');
  makeDir(core, 'solid/rocket.svg', '<svg>core-rocket</svg>');
  makeDir(core, 'solid/play.svg', '<svg>core-play</svg>');

  const result = emitIcons({ outDir: out, svgsDirs: [pro, free], coreIconsDir: core });

  const read = (rel) => fs.readFileSync(path.join(out, 'assets', 'icons', rel), 'utf8');
  assert.equal(read('solid/acorn.svg'), '<svg>pro-acorn</svg>');        // pro-only survives
  assert.equal(read('solid/play.svg'), '<svg>core-play</svg>');         // core curation wins
  assert.equal(read('solid/circle-user.svg'), '<svg>free-circle-user</svg>'); // free floor fills in
  assert.equal(read('brands/github.svg'), '<svg>free-github</svg>');
  assert.equal(read('solid/rocket.svg'), '<svg>core-rocket</svg>');
  assert.equal(result.files, 5);
  assert.equal(result.dest, path.join(out, 'assets', 'icons'));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('emitIcons without an explicit chain uses the real resolved roots', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-emit-'));

  const result = emitIcons({ outDir: tmp });
  // The free floor alone guarantees the classic set is present.
  assert.ok(fs.existsSync(path.join(result.dest, 'solid', 'play.svg')));
  assert.ok(fs.existsSync(path.join(result.dest, 'brands', 'github.svg')));
  assert.ok(result.files > 2000);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('#619: createIconLoader walks the chain, falls back to brands, and resolves aliases', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-load-'));
  const brand = path.join(tmp, 'brand');
  const free = path.join(tmp, 'free');

  makeDir(brand, 'solid/rocket.svg', '<svg>brand-rocket</svg>');
  makeDir(free, 'solid/rocket.svg', '<svg>free-rocket</svg>');
  makeDir(free, 'solid/bolt.svg', '<svg>free-bolt</svg>');
  makeDir(free, 'brands/github.svg', '<svg>free-github</svg>');
  makeDir(free, 'solid/magnifying-glass.svg', '<svg>free-magnifier</svg>');
  makeDir(tmp, 'icon-families.json', JSON.stringify({ 'magnifying-glass': { aliases: { names: ['search'] } } }));

  const load = createIconLoader({ svgsDirs: [brand, free], aliasFile: path.join(tmp, 'icon-families.json') });

  assert.equal(load('rocket', 'solid'), '<svg>brand-rocket</svg>', 'the brand set outranks the floor');
  assert.equal(load('bolt', 'solid'), '<svg>free-bolt</svg>', 'a name only the floor has resolves through the chain');
  assert.equal(load('github', 'solid'), '<svg>free-github</svg>', 'brands is the fallback dir for any weight');
  assert.equal(load('search', 'solid'), '<svg>free-magnifier</svg>', 'an alias resolves to its canonical file');
  assert.equal(load('definitely-not-real', 'solid'), null, 'a miss is null — the caller decides what that means');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('#619: createIconLoader strips the flag set\'s hardcoded root dimensions', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-load-'));
  makeDir(tmp, 'flags/us.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><path d="M3 3"/></svg>');

  const load = createIconLoader({ svgsDirs: [tmp] });
  const flag = load('us', 'flags');

  assert.ok(!flag.includes('"512"'), 'a 512px box would blow past the 1em icon sizing');
  assert.ok(flag.includes('viewBox="0 0 512 512"'), 'the viewBox is not a dimension');

  fs.rmSync(tmp, { recursive: true, force: true });
});
