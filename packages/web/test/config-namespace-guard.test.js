/**
 * The template guard lane for the three namespaces (#607).
 *
 * Config lives at `resolved.config.*` and build facts at `site.*`, and a
 * template that reaches for the OLD spelling does not fail — it renders an
 * empty string on every page. That is the whole class of bug this guard
 * exists for, so it is STATIC: it greps the shipped template surfaces and
 * fails on the first sighting, without needing a scenario that exposes the
 * empty render.
 *
 * Two rules, one per direction:
 *   1. `site.<config section>` — config never rides the build-fact global.
 *   2. `resolved.<config section>` — the old FLAT path, before `config:`.
 *      `resolved.meta` is not one: meta is PAGE machinery, never a config
 *      section, so the walk keeps its flat spelling (#607, Ian 2026-08-26).
 *
 * The framework's own surfaces are all this static lane can see. A CONSUMER's
 * pages are guarded at BUILD time by the same census (#611) — the last test
 * here proves that half, because a brand that missed the migration must fail
 * loudly rather than ship every page with a blank brand name.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  CONFIG_SECTIONS, SITE_FACT_KEYS, RANDOM_ID_ASSIGN_IDIOM,
  templateReads, randomIdReads, assignsRandomId,
} = require('../src/config-sections.js');
const { buildSite, BARE } = require('./lib/build.js');

const PKG = path.resolve(__dirname, '..');
const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

// The shipped template surfaces plus the scaffold a new brand starts from.
const SURFACES = ['core', 'defaults', 'themes', 'scaffold'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'bootstrap']);
const SCAN_EXTENSIONS = new Set(['.html', '.md', '.liquid', '.json', '.json5', '.txt', '.xml', '.js']);

// The census is src/config-sections.js's `templateReads` — the SAME one the
// engine's build guard and `omega migrate`'s rule 24 run (#611). One home, so
// this lane and a consumer's build can never disagree about what a read is: a
// hostname, a filename, a fenced code sample and a `{% raw %}` body are not
// reads on any of the three.

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...walk(path.join(dir, entry.name)));
      continue;
    }
    const name = entry.name.endsWith('.txt') ? entry.name.replace(/\.txt$/, '') : entry.name;
    if (SCAN_EXTENSIONS.has(path.extname(name)) || SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

/** Every read off one root in the shipped templates, as { file, line, key }. */
function reads(root) {
  const found = [];
  for (const surface of SURFACES) {
    for (const file of walk(path.join(PKG, surface))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const read of templateReads(source)) {
        if (read.root !== root) continue;
        found.push({ file: path.relative(PKG, file), line: read.line, key: read.key });
      }
    }
  }
  return found;
}

test('#607: no template reads a config section off the `site` global', () => {
  const offenders = reads('site').filter((entry) => !SITE_FACT_KEYS.includes(entry.key));

  assert.deepEqual(offenders, [], offenders.map((entry) => (
    `${entry.file}:${entry.line} reads site.${entry.key} — `
    + `\`site.*\` is BUILD FACTS only (${SITE_FACT_KEYS.join(', ')}); config reads are resolved.config.${entry.key} (#607)`
  )).join('\n'));
});

test('#607: no template reads a config section off the old flat `resolved` path', () => {
  const offenders = reads('resolved').filter((entry) => CONFIG_SECTIONS.has(entry.key));

  assert.deepEqual(offenders, [], offenders.map((entry) => (
    `${entry.file}:${entry.line} reads resolved.${entry.key} — the flat config path is gone; `
    + `spell it resolved.config.${entry.key} (#607)`
  )).join('\n'));
});

test('#595: no shipped template reads the retired UJM `random_id` global', () => {
  const offenders = [];
  for (const surface of SURFACES) {
    for (const file of walk(path.join(PKG, surface))) {
      const source = fs.readFileSync(file, 'utf8');
      if (assignsRandomId(source)) continue;
      for (const read of randomIdReads(source)) offenders.push(`${path.relative(PKG, file)}:${read.line}`);
    }
  }

  assert.deepEqual(offenders, [], offenders.map((where) => (
    `${where} reads a bare \`random_id\` — UJM's per-render global is gone and the read renders EMPTY; `
    + `assign it first (${RANDOM_ID_ASSIGN_IDIOM}) (#595)`
  )).join('\n'));
});

test('#595: a CONSUMER page that reads `random_id` without assigning it is named at build, with the idiom', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-randomid-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'index.md'), [
    '---', 'layout: blueprint/index', 'permalink: /', '---',
    '<div class="accordion" id="faq-{{ random_id }}"></div>', '',
  ].join('\n'));
  fs.writeFileSync(path.join(consumerDir, 'pages', 'ok.md'), [
    '---', 'layout: blueprint/index', 'permalink: /ok/', '---',
    '{% assign random_id = 100 | omega_random %}',
    '<div class="accordion" id="faq-{{ random_id }}"></div>', '',
  ].join('\n'));

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => warnings.push(parts.join(' '));
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'random-id-census');
    assert.ok(pages.get('/'), 'an empty id is not a build failure — a leftover is FLAGGED, never fatal (the assign may live in a layout)');

    const warning = warnings.find((line) => line.includes('random_id'));
    assert.ok(warning, `the leftover read is named: ${warnings.join(' | ')}`);
    assert.match(warning, /index\.md/, 'the warning names the file');
    assert.match(warning, /omega_random/, '…and the idiom that replaces the global');
    assert.ok(!warnings.some((line) => line.includes('ok.md')), 'a page that assigns it first is not a leftover');
  } finally {
    console.warn = originalWarn;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#611: a CONSUMER page reading a config section off `site` fails the build, naming the file and the expression', async () => {
  const cases = [
    { label: 'a body read', frontmatter: [], body: '<h1>{{ site.brand.name }}</h1>' },
    { label: 'a frontmatter read', frontmatter: ['meta:', '  title: "{{ site.brand.name }} · Home"'], body: '' },
  ];

  for (const scenario of cases) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-configreads-'));
    const consumerDir = path.join(tmp, 'src');
    fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(consumerDir, 'pages', 'index.md'), [
      '---', 'layout: blueprint/index', 'permalink: /', ...scenario.frontmatter, '---', scenario.body, '',
    ].join('\n'));

    try {
      await assert.rejects(
        () => buildSite(consumerDir, bareData, { environment: 'development' }, 'config-reads-build-guard'),
        (error) => {
          // Eleventy wraps a preprocessor throw — the engine's message is down
          // the originalError/cause chain.
          const parts = [];
          for (let node = error; node; node = node.originalError || node.cause) parts.push(node.message);
          const message = parts.join(' | ');
          assert.match(message, /index\.md/, `${scenario.label}: the error names the file`);
          assert.match(message, /site\.brand\.name/, `${scenario.label}: …and the expression it found`);
          assert.match(message, /resolved\.config\.brand\.name/, `${scenario.label}: …and the one that replaces it`);
          assert.match(message, /omega migrate/, `${scenario.label}: …and the verb that rewrites it`);
          return true;
        },
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test('#671: a CONFIG VALUE reading a config section off `site` fails the build, naming the config key', async () => {
  // The per-template census never sees this one: `targets.web.meta.title:
  // "Agency - {{ site.brand.name }}"` is a CONFIG value, and since #611 it
  // renders the brand name empty in every page's <title> with no error.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-configvalue-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'index.md'), ['---', 'layout: blueprint/index', 'permalink: /', '---', 'Home', ''].join('\n'));

  const dead = { ...bareData, meta: { ...(bareData.meta || {}), title: 'Creative agency - {{ site.brand.name }}' } };

  try {
    await assert.rejects(
      () => buildSite(consumerDir, dead, { environment: 'development' }, 'config-value-guard'),
      (error) => {
        const parts = [];
        for (let node = error; node; node = node.originalError || node.cause) parts.push(node.message);
        const message = parts.join(' | ');
        assert.match(message, /meta\.title/, 'the error names the config KEY, the only address a config value has');
        assert.match(message, /site\.brand\.name/, '…and the expression it found');
        assert.match(message, /resolved\.config\.brand\.name/, '…and the one that replaces it');
        assert.match(message, /omega migrate/, '…and the verb that rewrites it');
        return true;
      },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/**
 * The false-positive floor (the blind-verifier walk, 2026-08-25). The guard's
 * whole value is that a dead read fails LOUDLY — which makes every false
 * positive a build a brand cannot fix. Four shapes were failing that had no
 * business failing, each proven by execution:
 *   F1  `{{ site.url }}` — the canonical idiom `omega migrate` rule 7 itself
 *       writes. `toSiteGlobal` always derives a top-level `url`, so the old
 *       `Object.hasOwn(config, key)` widening claimed it as config.
 *   F2  `{{ site.omega.* }}` / `{{ site.characters.* }}` on a brand that
 *       OVERRIDES those keys in omega.json5 (engine.js supports exactly that).
 *       Same widening, same wrong answer.
 *   F3  the old spelling shown in a fenced code block or `{% raw %}` — code
 *       display is not markup (#521).
 *   F4  a hostname (`https://site.company.com/x`) — not a Liquid read at all.
 * The census is the section list from config-sections.js and nothing else, and
 * it only counts what sits in LIQUID context outside a display block.
 */
test('#611: the guard answers to the schema\'s config sections alone — build facts and brand overrides build', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-configreads-ok-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'index.md'), [
    '---', 'layout: blueprint/index', 'permalink: /', '---',
    // F1: the canonical idiom rule 7 writes.
    '<link rel="canonical" href="{{ site.url }}{{ page.url }}">',
    // F2: build facts this brand OVERRIDES in its own omega.json5.
    '<p>{{ site.omega.date.year }} · {{ site.characters.copyright }} · {{ site.posts.size }}</p>',
    '<p>{{ resolved.config.brand.name }}</p>',
    '',
  ].join('\n'));

  // A brand that really does override both — `hasOwn` said "config" for these.
  const overriding = {
    ...bareData,
    omega: { date: { year: 1999 } },
    characters: { copyright: '(c)' },
  };

  try {
    const pages = await buildSite(consumerDir, overriding, { environment: 'development' }, 'config-reads-build-ok');
    assert.ok(pages.get('/'), 'the page built');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#611: code DISPLAY and plain prose are not reads — a fence, a raw block, a hostname (F3, F4)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-configreads-display-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'index.md'), [
    '---', 'layout: blueprint/index', 'permalink: /',
    // A hostname in a frontmatter value — not a Liquid read.
    'meta:', '  title: "Docs"', '  image: "https://site.company.com/og.png"', '---',
    'Before the migration a page wrote it like this:',
    '',
    '```liquid',
    '{{ site.brand.name }} — {{ site.theme.id }}',
    '```',
    '',
    'The escape hatch spells it the same way:',
    '',
    '{% raw %}{{ site.inbound.chat.providers.chatsy.enabled }}{% endraw %}',
    '',
    'Read more at https://site.company.com/x and at site.marketing.example.com.',
    '',
  ].join('\n'));

  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'config-reads-build-display');
    const html = pages.get('/');
    assert.ok(html, 'the page built — none of that is a read');
    assert.ok(html.includes('https://site.company.com/x'), 'and the hostname is still a hostname');
    // What the guard owes a display block is a build that RUNS — that is the
    // whole finding. What the rendered fence then shows is the content
    // pipeline's own business (a fence stops markdown, not Liquid, and this
    // shell re-renders `content`), and the SOURCE side is pinned where it is
    // owned: test/migrate.test.js holds rule 24 off fences and raw blocks.
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#607: `meta` keeps its flat spelling — it is PAGE machinery, never a config section', () => {
  assert.ok(!CONFIG_SECTIONS.has('meta'), 'omega.json5 declares no meta section (Ian 2026-08-26)');
  assert.ok(
    reads('resolved').some((entry) => entry.key === 'meta'),
    'the head include still reads resolved.meta — the merged page → layout walk',
  );
});
