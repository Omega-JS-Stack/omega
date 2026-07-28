/**
 * The scaffolded starter walkthrough (#97): src/pages/ used to ship nothing
 * but a .gitkeep, so a fresh consumer had zero in-repo demonstration of the
 * section-composition contract. `scaffold/src/pages/example.md.txt` is that
 * demonstration — and its `.txt` suffix is load-bearing: the file must sit in
 * a consumer project WITHOUT ever becoming a page.
 *
 * Two builds over the bare fixture: one with the example file dropped in
 * verbatim (nothing may render from it), one with its walkthrough body
 * extracted into a real .md page (every idiom it teaches must actually work —
 * a stale example is worse than none). Its central CLAIM — the meta-only
 * frontmatter allow-list — is pinned against the engine's real set, so a key
 * added or dropped there fails here instead of quietly making the walkthrough
 * a lie.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { buildSite, BARE, PKG } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));
const EXAMPLE = path.join(PKG, 'scaffold', 'src', 'pages', 'example.md.txt');

/** Copy the bare fixture into a temp consumer dir. @returns {{ tmp: string, src: string }} */
function bareConsumer(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const src = path.join(tmp, 'src');
  fs.cpSync(BARE, src, { recursive: true });
  return { tmp, src };
}

/** The walkthrough body between the rule lines — what a consumer copies out. */
function walkthroughBody() {
  const parts = fs.readFileSync(EXAMPLE, 'utf8').split(/^─+$/m);
  assert.strictEqual(parts.length, 3, 'the example carries exactly one ruled block');
  return parts[1].replace(/^\n/, '');
}

/**
 * Extract a `const NAME = new Set([...])` literal's quoted members from a
 * source file. PAGE_FRONTMATTER_ALLOW is engine-internal (configureOmega is
 * the module's only export) and stays that way — a doc test is no reason to
 * widen the API surface.
 * @param {string} source
 * @param {string} name
 * @returns {string[]}
 */
function setMembers(source, name) {
  const match = source.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  assert.ok(match, `${name} is still a Set literal in engine.js`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('the documented frontmatter allow-list IS the engine\'s allow-list', () => {
  const engine = fs.readFileSync(path.join(PKG, 'src', 'engine.js'), 'utf8');

  // What the engine really permits on a page: the meta-only allow set, plus
  // the plumbing keys the guard never inspects (they're filtered upstream by
  // readOwnFrontmatter's RESOLVED_OMIT pass, so they're legal on any page).
  const allowed = new Set(setMembers(engine, 'PAGE_FRONTMATTER_ALLOW'));
  for (const plumbing of ['layout', 'permalink']) {
    assert.ok(setMembers(engine, 'RESOLVED_OMIT').includes(plumbing), `${plumbing} is still engine plumbing`);
    allowed.add(plumbing);
  }

  // What the walkthrough tells a consumer: the key column of its frontmatter
  // comment table (`#   <key>   <description>`).
  const documented = [...walkthroughBody().matchAll(/^#\s{3}(\w+)\s{2,}\S/gm)].map((m) => m[1]);
  assert.ok(documented.length > 0, 'the walkthrough still documents the allow-list as a key table');

  assert.deepStrictEqual(
    documented.slice().sort(),
    [...allowed].sort(),
    'the walkthrough documents exactly the keys the engine accepts — no more, no fewer',
  );
});

test('the scaffolded example never becomes a page', async () => {
  const { tmp, src } = bareConsumer('omega-example-inert-');
  fs.copyFileSync(EXAMPLE, path.join(src, 'pages', 'example.md.txt'));

  try {
    const pages = await buildSite(src, bareData, {}, 'scaffold-example-inert');
    assert.ok(pages.size > 0, 'the fixture still builds');
    const leaked = [...pages.keys()].filter((url) => /example/i.test(url));
    assert.deepStrictEqual(leaked, [], 'the walkthrough emits no URL');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the walkthrough body renders exactly what it claims', async () => {
  const { tmp, src } = bareConsumer('omega-example-live-');
  fs.writeFileSync(path.join(src, 'pages', 'walkthrough.md'), walkthroughBody());

  try {
    const pages = await buildSite(src, bareData, {}, 'scaffold-example-live');
    const page = pages.get('/example');
    assert.ok(page, 'the permalink the frontmatter names is the URL it serves');

    // Meta-only frontmatter reaches the <head>
    assert.match(page, /<title>Example page<\/title>/, 'meta.title lands');

    // Inline form — args passed on the tag
    assert.ok(page.includes('Everything you need'), 'inline hero headline renders');

    // No args — the section's own defaults fill the band
    assert.ok(page.includes('50,000+'), 'the bare stats call renders its defaults');

    // Block form — YAML args, including nested items
    assert.ok(page.includes('Questions, answered'), 'block-form faq headline renders');
    assert.ok(page.includes('Do I have to write every page?'), 'block-form nested items render');

    // Slot — finished markup passed where a string will not do
    assert.ok(page.includes('my-demo'), 'the demo_html slot reaches the section');

    // The walkthrough's own notes are Liquid comments, which the render
    // drops — an HTML comment would have been shipped bytes ([#92](https://github.com/Omega-JS-Stack/omega/issues/92)),
    // publishing every explanatory aside to the live page.
    assert.ok(!page.includes('stack of full-width bands'), 'commentary never reaches the rendered page');
    assert.ok(!page.includes('Inline form'), 'per-call notes never reach the rendered page');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
