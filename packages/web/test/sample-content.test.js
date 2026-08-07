/**
 * Sample content generation (spec §8) — rolling dates + the gitignored
 * materialized tree:
 *  1. anchor resolution: option > OMEGA_SAMPLE_ANCHOR env > today; strict
 *  2. anchor === corpus epoch reproduces the authored corpus exactly (the
 *     determinism pin the harness and goldens ride)
 *  3. any other anchor shifts every date uniformly — filenames (posts) and
 *     frontmatter date lines (updates) — order, slugs, and bodies untouched
 *  4. reconcileSampleContent materializes under .omega/sample-content with a
 *     self-.gitignore, removes collections the consumer owns, idempotently
 *  5. the rolled dates render through the real engine (page.date from the
 *     virtual filename, update.date from frontmatter)
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { buildSite, BARE } = require('./lib/build.js');
const {
  SAMPLE_EPOCH_UTC,
  SAMPLE_SETS,
  resolveAnchor,
  generateSampleSet,
  reconcileSampleContent,
} = require('../src/sample-content.js');
const { PATHS } = require('../src/paths.js');

const EPOCH_DAY = '2026-07-18';
const PLUS_30 = '2026-08-17';
const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

const authoredNames = (samplesDir) => fs.readdirSync(path.join(PATHS.defaults, samplesDir))
  .filter((name) => name.endsWith('.md'))
  .sort();

test('resolveAnchor: option beats env beats today, garbage is loud', () => {
  const saved = process.env.OMEGA_SAMPLE_ANCHOR;
  try {
    process.env.OMEGA_SAMPLE_ANCHOR = '2030-01-01';
    assert.strictEqual(resolveAnchor('2026-07-18'), SAMPLE_EPOCH_UTC, 'explicit option wins over env');
    assert.strictEqual(resolveAnchor(), Date.UTC(2030, 0, 1), 'env pin applies when no option');

    delete process.env.OMEGA_SAMPLE_ANCHOR;
    const now = new Date();
    assert.strictEqual(resolveAnchor(), Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()), 'unpinned → today (UTC midnight)');

    assert.throws(() => resolveAnchor('July 4th'), /Invalid sample-content anchor/, 'non-ISO anchors throw');
  } finally {
    process.env.OMEGA_SAMPLE_ANCHOR = saved;
  }
});

test('anchor === epoch reproduces the authored corpus (names, dates, bodies)', () => {
  for (const set of SAMPLE_SETS) {
    const generated = generateSampleSet(PATHS.defaults, set, SAMPLE_EPOCH_UTC);
    assert.deepStrictEqual(generated.map((f) => f.name), authoredNames(set.samplesDir), `${set.samplesDir}: filenames identical at epoch`);

    for (const file of generated) {
      const corpus = fs.readFileSync(path.join(PATHS.defaults, set.samplesDir, file.name), 'utf8');
      assert.ok(file.content.includes('# Generated sample content'), `${file.name}: generated header present`);
      // Removing the injected block — the two header comments and the #208
      // `generated: true` marker — restores the corpus byte-for-byte; at epoch
      // the date transforms are all identity.
      const withoutHeader = file.content.replace(/^# Generated sample content[^\n]*\n# Do not edit[^\n]*\ngenerated: true\n/m, '');
      assert.strictEqual(withoutHeader, corpus, `${file.name}: content identical at epoch (header aside)`);
    }
  }
});

test('a shifted anchor rolls every date uniformly — order, slugs, bodies untouched', () => {
  const postsSet = SAMPLE_SETS.find((s) => s.samplesDir === 'sample-posts');
  const rolled = generateSampleSet(PATHS.defaults, postsSet, resolveAnchor(PLUS_30));
  const authored = authoredNames('sample-posts');

  assert.strictEqual(rolled.length, authored.length, 'every post generates');
  rolled.forEach((file, i) => {
    const [, day, slug] = authored[i].match(/^(\d{4}-\d{2}-\d{2})-(.*)$/);
    const shifted = new Date(Date.parse(`${day}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
    assert.strictEqual(file.name, `${shifted}-${slug}`, `${authored[i]} shifts +30 days, slug intact`);
  });
  // Newest authored post (2026-07-08) lands 20 days BEFORE the +30 anchor —
  // the "virgin blog always looks alive" guarantee.
  assert.strictEqual(rolled[rolled.length - 1].name.slice(0, 10), '2026-08-07', 'newest post stays near the anchor');

  const updatesSet = SAMPLE_SETS.find((s) => s.samplesDir === 'sample-updates');
  for (const file of generateSampleSet(PATHS.defaults, updatesSet, resolveAnchor(PLUS_30))) {
    const corpus = fs.readFileSync(path.join(PATHS.defaults, 'sample-updates', file.name), 'utf8');
    const corpusDay = corpus.match(/^\s*date: (\d{4}-\d{2}-\d{2})$/m)[1];
    const rolledDay = file.content.match(/^\s*date: (\d{4}-\d{2}-\d{2})$/m)[1];
    const expected = new Date(Date.parse(`${corpusDay}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
    assert.strictEqual(rolledDay, expected, `${file.name}: update.date shifts +30 days`);
    // The body below the frontmatter is byte-identical
    assert.strictEqual(file.content.slice(file.content.indexOf('\n---')), corpus.slice(corpus.indexOf('\n---')), `${file.name}: body untouched`);
  }

  const teamSet = SAMPLE_SETS.find((s) => s.samplesDir === 'sample-team');
  for (const file of generateSampleSet(PATHS.defaults, teamSet, resolveAnchor(PLUS_30))) {
    const corpus = fs.readFileSync(path.join(PATHS.defaults, 'sample-team', file.name), 'utf8');
    const withoutHeader = file.content.replace(/^# Generated sample content[^\n]*\n# Do not edit[^\n]*\ngenerated: true\n/m, '');
    assert.strictEqual(withoutHeader, corpus, `${file.name}: dateless team files pass through verbatim`);
  }
});

test('reconcileSampleContent: materialize, self-gitignore, step aside per collection, idempotent', () => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-sample-app-'));
  const consumerDir = path.join(appRoot, 'src');
  fs.mkdirSync(consumerDir, { recursive: true });
  try {
    const first = reconcileSampleContent({ appRoot, consumerDir, defaultsDir: PATHS.defaults, anchor: EPOCH_DAY });
    const root = path.join(appRoot, '.omega', 'sample-content');
    assert.strictEqual(first.root, root);
    assert.strictEqual(first.written.length, 19, 'all three sets materialize (11 posts + 4 team + 4 updates)');
    assert.strictEqual(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), '*\n', 'self-.gitignore makes the tree uncommittable');
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '_posts')).sort(), authoredNames('sample-posts'), 'epoch anchor materializes authored names');

    // Idempotent: same inputs → same tree, same accounting
    const second = reconcileSampleContent({ appRoot, consumerDir, defaultsDir: PATHS.defaults, anchor: EPOCH_DAY });
    assert.deepStrictEqual(second.written, first.written, 'rerun rewrites the same set');

    // The consumer takes over posts → the posts dir is removed, others stay
    fs.mkdirSync(path.join(consumerDir, '_posts'));
    fs.writeFileSync(path.join(consumerDir, '_posts', 'real.md'), '---\ntitle: Real\n---\nReal.\n');
    const third = reconcileSampleContent({ appRoot, consumerDir, defaultsDir: PATHS.defaults, anchor: EPOCH_DAY });
    assert.deepStrictEqual(third.removed, ['_posts'], 'owned collection reported removed');
    assert.ok(!fs.existsSync(path.join(root, '_posts')), 'owned collection leaves the tree');
    assert.ok(fs.existsSync(path.join(root, '_team')), 'unowned collections stay');

    // The consumer owns everything → the whole tree is gone
    for (const dir of ['_team', '_updates']) {
      fs.mkdirSync(path.join(consumerDir, dir));
      fs.writeFileSync(path.join(consumerDir, dir, 'real.md'), '---\ntitle: Real\n---\nReal.\n');
    }
    reconcileSampleContent({ appRoot, consumerDir, defaultsDir: PATHS.defaults, anchor: EPOCH_DAY });
    assert.ok(!fs.existsSync(root), 'nothing to materialize → no .omega/sample-content at all');
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
});

test('rolled dates render through the engine — filename lane and frontmatter lane', async () => {
  const pages = await buildSite(BARE, bareData, { environment: 'development', sampleAnchor: PLUS_30 }, 'sample-roll');

  // Posts: page.date comes from the virtual filename prefix (2026-01-12 + 30)
  const welcome = pages.get('/blog/welcome-to-the-blog');
  assert.ok(welcome, 'slug URL is date-free and stable under rolling');
  assert.ok(welcome.includes('February 11, 2026'), 'post date rolls with the anchor');

  // Updates: update.date comes from the rewritten frontmatter line (2026-07-10 + 30)
  assert.ok(pages.get('/updates/v1.3.0').includes('August 09, 2026'), 'update date rolls with the anchor');

  // Rolling never changes the URL surface: same set as an epoch-anchored build
  const epochPages = await buildSite(BARE, bareData, { environment: 'development', sampleAnchor: EPOCH_DAY }, 'sample-epoch');
  assert.deepStrictEqual([...pages.keys()].sort(), [...epochPages.keys()].sort(), 'URL set identical across anchors');
  assert.ok(epochPages.get('/blog/welcome-to-the-blog').includes('January 12, 2026'), 'epoch anchor reproduces the authored date');
});
