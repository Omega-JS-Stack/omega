/**
 * filters.test.js — omega_* filter semantics, incl. Ruby-parity pins.
 *
 * Parity values verified against real Ruby (ruby 4.0.0, 2026-07-06):
 *   Digest::MD5.hexdigest('hello').hex % 1000 == 994
 *   Digest::MD5.hexdigest('somiibo').hex % 360 == 305
 *   'hello WORLD' per-word capitalize == 'Hello World'
 * Documented divergence: Ruby's omega_commaify groups DECIMAL digits too
 * ('1234.5678' => '1,234.5,678' — a latent bug); ours commas only the whole
 * part ('1,234.5678') per the best-implementation-wins rule.
 */

const test = require('node:test');
const assert = require('node:assert');
const filters = require('../src/filters.js');

test('omegaStripAds removes ad-unit blocks and adunit includes', () => {
  const input = 'before\n<ad-unit>\nstuff\n</ad-unit>\nafter {% include /master/modules/adunits/banner.html %} end';
  const out = filters.omegaStripAds(input);
  assert.ok(!out.includes('ad-unit'));
  assert.ok(!out.includes('adunits'));
  assert.ok(out.includes('before'));
  assert.ok(out.includes('after'));
  assert.ok(out.includes('end'));
});

test('omegaJsonEscape escapes without surrounding quotes', () => {
  assert.strictEqual(filters.omegaJsonEscape('say "hi"\nnow'), 'say \\"hi\\"\\nnow');
  assert.strictEqual(filters.omegaJsonEscape('back\\slash'), 'back\\\\slash');
});

test('omegaHash matches Ruby full-hexdigest BigInt semantics', () => {
  assert.strictEqual(filters.omegaHash('hello', 1000), 994);
  assert.strictEqual(filters.omegaHash('somiibo', 360), 305);
  // Deterministic
  assert.strictEqual(filters.omegaHash('hello', 1000), filters.omegaHash('hello', 1000));
});

test('omegaRandom stays in [0, max)', () => {
  for (let i = 0; i < 50; i++) {
    const value = filters.omegaRandom(10);
    assert.ok(value >= 0 && value < 10 && Number.isInteger(value));
  }
});

test('omegaTitleCase matches Ruby per-word capitalize', () => {
  assert.strictEqual(filters.omegaTitleCase('hello WORLD'), 'Hello World');
  assert.strictEqual(filters.omegaTitleCase('social media automation'), 'Social Media Automation');
});

test('omegaJsonify pretty-prints with configurable indent', () => {
  assert.strictEqual(filters.omegaJsonify({ a: 1 }), '{\n  "a": 1\n}');
  assert.strictEqual(filters.omegaJsonify({ a: 1 }, 4), '{\n    "a": 1\n}');
});

test('omegaAppendParam handles bare and existing query strings', () => {
  assert.strictEqual(filters.omegaAppendParam('https://x.com/img.png', 'cb', '123'), 'https://x.com/img.png?cb=123');
  assert.strictEqual(filters.omegaAppendParam('https://x.com/img.png?w=200', 'cb', '123'), 'https://x.com/img.png?w=200&cb=123');
  assert.strictEqual(filters.omegaAppendParam('', 'cb', '1'), '');
  assert.strictEqual(filters.omegaAppendParam(null, 'cb', '1'), null);
});

test('omegaCachebreak appends a process-consistent cb param', () => {
  const a = filters.omegaCachebreak('https://x.com/a.png');
  const b = filters.omegaCachebreak('https://x.com/b.png?w=1');
  assert.match(a, /^https:\/\/x\.com\/a\.png\?cb=\d+$/);
  assert.match(b, /&cb=\d+$/);
  assert.strictEqual(a.split('cb=')[1], b.split('cb=')[1]);
  assert.strictEqual(a.split('cb=')[1], filters.CACHE_TIMESTAMP);
});

test('omegaPluralize picks singular only for exactly 1', () => {
  assert.strictEqual(filters.omegaPluralize(1, 'post', 'posts'), 'post');
  assert.strictEqual(filters.omegaPluralize(5, 'post', 'posts'), 'posts');
  assert.strictEqual(filters.omegaPluralize(0, 'post', 'posts'), 'posts');
  assert.strictEqual(filters.omegaPluralize(2, 'box'), 'boxs'); // Ruby parity: naive default
});

test('omegaCommaify formats integers and passes junk through', () => {
  assert.strictEqual(filters.omegaCommaify(10000), '10,000');
  assert.strictEqual(filters.omegaCommaify('1234567'), '1,234,567');
  assert.strictEqual(filters.omegaCommaify('-1234567'), '-1,234,567');
  assert.strictEqual(filters.omegaCommaify('1234.5678'), '1,234.5678'); // divergence: Ruby gives '1,234.5,678'
  assert.strictEqual(filters.omegaCommaify('not a number'), 'not a number');
  assert.strictEqual(filters.omegaCommaify(''), '');
  assert.strictEqual(filters.omegaCommaify(null), null);
  assert.strictEqual(filters.omegaCommaify(123), '123');
});

test('createIncrementReturn accumulates per registers object', () => {
  const registers = {};
  const increment = filters.createIncrementReturn(() => registers);
  assert.strictEqual(increment(1), 1);
  assert.strictEqual(increment(1), 2);
  assert.strictEqual(increment(5), 7);

  const fresh = {};
  const increment2 = filters.createIncrementReturn(() => fresh);
  assert.strictEqual(increment2(1), 1);
});

test('createLiquify renders recursively with depth + no-change guards', () => {
  const scope = { a: '{{ b }}', b: 'done' };
  const render = (str) => str.replace(/\{\{ *(\w+) *\}\}/g, (m, key) => scope[key] ?? m);

  const liquify = filters.createLiquify(render);
  assert.strictEqual(liquify('x {{ a }} y'), 'x done y');
  assert.strictEqual(liquify(null), '');
  // Unresolvable syntax stops on no-change instead of looping
  assert.strictEqual(liquify('{{ missing }}'), '{{ missing }}');
});

test('createContentFormat markdownifies only .md pages', () => {
  const render = (str) => str;
  const markdown = (str) => `<p>${str}</p>`;

  const forMd = filters.createContentFormat(render, { markdown, getPage: () => ({ extension: '.md' }) });
  assert.strictEqual(forMd('hello'), '<p>hello</p>');

  const forHtml = filters.createContentFormat(render, { markdown, getPage: () => ({ extension: '.html' }) });
  assert.strictEqual(forHtml('hello'), 'hello');

  assert.strictEqual(forMd(null), '');
});
