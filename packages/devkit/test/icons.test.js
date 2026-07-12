/**
 * emitIcons — the runtime icon-set emission (C4 cp112): the site output
 * gains assets/fa/<style>/<name>.svg from the resolved chain, best source
 * winning per file, curated core icons on top.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { emitIcons } = require('../src/icons.js');

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

  const read = (rel) => fs.readFileSync(path.join(out, 'assets', 'fa', rel), 'utf8');
  assert.equal(read('solid/acorn.svg'), '<svg>pro-acorn</svg>');        // pro-only survives
  assert.equal(read('solid/play.svg'), '<svg>core-play</svg>');         // core curation wins
  assert.equal(read('solid/circle-user.svg'), '<svg>free-circle-user</svg>'); // free floor fills in
  assert.equal(read('brands/github.svg'), '<svg>free-github</svg>');
  assert.equal(read('solid/rocket.svg'), '<svg>core-rocket</svg>');
  assert.equal(result.files, 5);
  assert.equal(result.dest, path.join(out, 'assets', 'fa'));

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
