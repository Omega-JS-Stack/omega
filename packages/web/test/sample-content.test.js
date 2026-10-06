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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

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

module.exports = defineCases({
  type: 'group',
  description: 'sample-content',
  tests: [
    {
      name: 'resolveAnchor: option beats env beats today, garbage is loud',
      run: (ctx) => {
        const saved = process.env.OMEGA_SAMPLE_ANCHOR;
        try {
          process.env.OMEGA_SAMPLE_ANCHOR = '2030-01-01';
          ctx.expect(resolveAnchor('2026-07-18'), 'explicit option wins over env').toBe(SAMPLE_EPOCH_UTC);
          ctx.expect(resolveAnchor(), 'env pin applies when no option').toBe(Date.UTC(2030, 0, 1));

          delete process.env.OMEGA_SAMPLE_ANCHOR;
          const now = new Date();
          ctx.expect(resolveAnchor(), 'unpinned → today (UTC midnight)').toBe(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

          ctx.expect(() => resolveAnchor('July 4th'), 'non-ISO anchors throw').toThrow(/Invalid sample-content anchor/);
        } finally {
          process.env.OMEGA_SAMPLE_ANCHOR = saved;
        }
      },
    },

    {
      name: 'anchor === epoch reproduces the authored corpus (names, dates, bodies)',
      run: (ctx) => {
        for (const set of SAMPLE_SETS) {
          const generated = generateSampleSet(PATHS.defaults, set, SAMPLE_EPOCH_UTC);
          ctx.expect(generated.map((f) => f.name), `${set.samplesDir}: filenames identical at epoch`).toEqual(authoredNames(set.samplesDir));

          for (const file of generated) {
            const corpus = fs.readFileSync(path.join(PATHS.defaults, set.samplesDir, file.name), 'utf8');
            ctx.expect(file.content.includes('# Generated sample content'), `${file.name}: generated header present`).toBeTruthy();
            // Removing the injected block — the two header comments and the #208
            // `generated: true` marker — restores the corpus byte-for-byte; at epoch
            // the date transforms are all identity.
            const withoutHeader = file.content.replace(/^# Generated sample content[^\n]*\n# Do not edit[^\n]*\ngenerated: true\n/m, '');
            ctx.expect(withoutHeader, `${file.name}: content identical at epoch (header aside)`).toBe(corpus);
          }
        }
      },
    },

    {
      name: 'a shifted anchor rolls every date uniformly — order, slugs, bodies untouched',
      run: (ctx) => {
        const postsSet = SAMPLE_SETS.find((s) => s.samplesDir === 'sample-posts');
        const rolled = generateSampleSet(PATHS.defaults, postsSet, resolveAnchor(PLUS_30));
        const authored = authoredNames('sample-posts');

        ctx.expect(rolled.length, 'every post generates').toBe(authored.length);
        rolled.forEach((file, i) => {
          const [, day, slug] = authored[i].match(/^(\d{4}-\d{2}-\d{2})-(.*)$/);
          const shifted = new Date(Date.parse(`${day}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
          ctx.expect(file.name, `${authored[i]} shifts +30 days, slug intact`).toBe(`${shifted}-${slug}`);
        });
        // Newest authored post (2026-07-08) lands 20 days BEFORE the +30 anchor —
        // the "virgin blog always looks alive" guarantee.
        ctx.expect(rolled[rolled.length - 1].name.slice(0, 10), 'newest post stays near the anchor').toBe('2026-08-07');

        const updatesSet = SAMPLE_SETS.find((s) => s.samplesDir === 'sample-updates');
        for (const file of generateSampleSet(PATHS.defaults, updatesSet, resolveAnchor(PLUS_30))) {
          const corpus = fs.readFileSync(path.join(PATHS.defaults, 'sample-updates', file.name), 'utf8');
          const corpusDay = corpus.match(/^\s*date: (\d{4}-\d{2}-\d{2})$/m)[1];
          const rolledDay = file.content.match(/^\s*date: (\d{4}-\d{2}-\d{2})$/m)[1];
          const expected = new Date(Date.parse(`${corpusDay}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
          ctx.expect(rolledDay, `${file.name}: update.date shifts +30 days`).toBe(expected);
          // The body below the frontmatter is byte-identical
          ctx.expect(file.content.slice(file.content.indexOf('\n---')), `${file.name}: body untouched`).toBe(corpus.slice(corpus.indexOf('\n---')));
        }

        const teamSet = SAMPLE_SETS.find((s) => s.samplesDir === 'sample-team');
        for (const file of generateSampleSet(PATHS.defaults, teamSet, resolveAnchor(PLUS_30))) {
          const corpus = fs.readFileSync(path.join(PATHS.defaults, 'sample-team', file.name), 'utf8');
          const withoutHeader = file.content.replace(/^# Generated sample content[^\n]*\n# Do not edit[^\n]*\ngenerated: true\n/m, '');
          ctx.expect(withoutHeader, `${file.name}: dateless team files pass through verbatim`).toBe(corpus);
        }
      },
    },

    {
      name: 'reconcileSampleContent: materialize, self-gitignore, step aside per collection, idempotent',
      run: (ctx) => {
        const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-sample-app-'));
        const consumerDir = path.join(targetRoot, 'src');
        fs.mkdirSync(consumerDir, { recursive: true });
        try {
          const first = reconcileSampleContent({ targetRoot, consumerDir, defaultsDir: PATHS.defaults, anchor: EPOCH_DAY });
          const root = path.join(targetRoot, '.omega', 'sample-content');
          ctx.expect(first.root).toBe(root);
          ctx.expect(first.written.length, 'all three sets materialize (11 posts + 4 team + 4 updates)').toBe(19);
          ctx.expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'self-.gitignore makes the tree uncommittable').toBe('*\n');
          ctx.expect(fs.readdirSync(path.join(root, '_posts')).sort(), 'epoch anchor materializes authored names').toEqual(authoredNames('sample-posts'));

          // Idempotent: same inputs → same tree, same accounting
          const second = reconcileSampleContent({ targetRoot, consumerDir, defaultsDir: PATHS.defaults, anchor: EPOCH_DAY });
          ctx.expect(second.written, 'rerun rewrites the same set').toEqual(first.written);

          // The consumer takes over posts → the posts dir is removed, others stay
          fs.mkdirSync(path.join(consumerDir, '_posts'));
          fs.writeFileSync(path.join(consumerDir, '_posts', 'real.md'), '---\ntitle: Real\n---\nReal.\n');
          const third = reconcileSampleContent({ targetRoot, consumerDir, defaultsDir: PATHS.defaults, anchor: EPOCH_DAY });
          ctx.expect(third.removed, 'owned collection reported removed').toEqual(['_posts']);
          ctx.expect(!fs.existsSync(path.join(root, '_posts')), 'owned collection leaves the tree').toBeTruthy();
          ctx.expect(fs.existsSync(path.join(root, '_team')), 'unowned collections stay').toBeTruthy();

          // The consumer owns everything → the whole tree is gone
          for (const dir of ['_team', '_updates']) {
            fs.mkdirSync(path.join(consumerDir, dir));
            fs.writeFileSync(path.join(consumerDir, dir, 'real.md'), '---\ntitle: Real\n---\nReal.\n');
          }
          reconcileSampleContent({ targetRoot, consumerDir, defaultsDir: PATHS.defaults, anchor: EPOCH_DAY });
          ctx.expect(!fs.existsSync(root), 'nothing to materialize → no .omega/sample-content at all').toBeTruthy();
        } finally {
          fs.rmSync(targetRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'rolled dates render through the engine — filename lane and frontmatter lane',
      run: async (ctx) => {
        const pages = await buildSite(BARE, bareData, { environment: 'development', sampleAnchor: PLUS_30 }, 'sample-roll');

        // Posts: page.date comes from the virtual filename prefix (2026-01-12 + 30)
        const welcome = pages.get('/blog/welcome-to-the-blog');
        ctx.expect(welcome, 'slug URL is date-free and stable under rolling').toBeTruthy();
        ctx.expect(welcome.includes('February 11, 2026'), 'post date rolls with the anchor').toBeTruthy();

        // Updates: update.date comes from the rewritten frontmatter line (2026-07-10 + 30)
        ctx.expect(pages.get('/updates/v1.3.0').includes('August 09, 2026'), 'update date rolls with the anchor').toBeTruthy();

        // Rolling never changes the URL surface: same set as an epoch-anchored build
        const epochPages = await buildSite(BARE, bareData, { environment: 'development', sampleAnchor: EPOCH_DAY }, 'sample-epoch');
        ctx.expect([...pages.keys()].sort(), 'URL set identical across anchors').toEqual([...epochPages.keys()].sort());
        ctx.expect(epochPages.get('/blog/welcome-to-the-blog').includes('January 12, 2026'), 'epoch anchor reproduces the authored date').toBeTruthy();
      },
    },
  ],
});
