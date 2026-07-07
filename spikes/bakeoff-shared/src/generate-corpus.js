/**
 * generate-corpus.js — deterministic synthetic corpus generator for the SSG bake-off.
 *
 * Generates a content tree statistically identical to the real somiibo-website
 * (the heaviest OMEGA consumer): 1030 posts, 105 pages, 20 alternatives docs,
 * with matching year distribution, word-count quartiles, page-archetype mix,
 * and `{{ site.* }}` refs inside frontmatter values (the variable-resolver
 * stressor). All shape numbers live in corpus-spec.js (SSOT).
 *
 * Byte-reproducible: same seed → identical tree. No Math.random / Date.now.
 *
 * Usage:
 *   node src/generate-corpus.js [--out=corpus] [--seed=42]
 *
 * Output tree:
 *   <out>/
 *   ├── corpus-manifest.json      # seed + counts + word stats (deterministic)
 *   ├── site-data.json            # synthetic site.* data (brand, meta, theme)
 *   ├── _posts/{2017..2026,other,seo}/YYYY-MM-DD-slug.md
 *   ├── pages/…                   # platform-bot / solution / package / theme-base / blueprint pages
 *   └── _alternatives/*.md
 */

// Libraries
const path = require('path');
const jetpack = require('fs-jetpack');
const { createRng } = require('./prng.js');
const spec = require('./corpus-spec.js');

// Constants
const DEFAULT_SEED = 42;
const DEFAULT_OUT = 'corpus';

/**
 * Slugify a title into a filename-safe slug.
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build one sentence from the word pools.
 * @param {object} rng
 * @returns {string}
 */
function sentence(rng) {
  const { adjectives, nouns, verbs, connectors } = spec.WORDS;
  const parts = [
    `A ${rng.pick(adjectives)} ${rng.pick(nouns)} helps you ${rng.pick(verbs)} your ${rng.pick(nouns)}`,
    `${rng.pick(connectors)} you can ${rng.pick(verbs)} a ${rng.pick(adjectives)} ${rng.pick(nouns)} over time`,
  ];
  return `${parts.join(' ')}.`;
}

/**
 * Build one paragraph (3-5 sentences).
 * @param {object} rng
 * @returns {string}
 */
function paragraph(rng) {
  const count = rng.int(3, 5);
  const sentences = [];
  for (let i = 0; i < count; i++) {
    sentences.push(sentence(rng));
  }
  return sentences.join(' ');
}

/**
 * Count words the same way the somiibo measurement did (wc -w).
 * @param {string} text
 * @returns {number}
 */
function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Build a markdown post body of ~targetWords, with headings, lists,
 * blockquotes, links, and images interleaved like real posts.
 * @param {object} rng
 * @param {number} targetWords
 * @returns {string}
 */
function postBody(rng, targetWords) {
  const { nouns, verbs, adjectives } = spec.WORDS;
  const blocks = [];
  let words = 0;
  let sinceHeading = 0;

  while (words < targetWords) {
    if (blocks.length > 0 && sinceHeading >= rng.int(2, 3)) {
      const level = rng.chance(0.7) ? '##' : '###';
      blocks.push(`${level} ${rng.pick(['Understanding', 'Building', 'Optimizing', 'Mastering'])} your ${rng.pick(nouns)}`);
      sinceHeading = 0;
    }

    let block = paragraph(rng);

    // Sprinkle inline links and the occasional structural block
    if (rng.chance(0.2)) {
      block += ` Learn more about [${rng.pick(adjectives)} ${rng.pick(nouns)}s](https://bakeoff.example.com/${rng.pick(nouns)}).`;
    }
    blocks.push(block);

    if (rng.chance(0.15)) {
      const items = [];
      for (let i = 0; i < 4; i++) {
        items.push(`- ${rng.pick(['Set up', 'Review', 'Automate', 'Track'])} your ${rng.pick(adjectives)} ${rng.pick(nouns)}`);
      }
      blocks.push(items.join('\n'));
    }
    if (rng.chance(0.1)) {
      blocks.push(`> The fastest way to ${rng.pick(verbs)} is a ${rng.pick(adjectives)} ${rng.pick(nouns)} you actually stick to.`);
    }
    if (rng.chance(0.08)) {
      blocks.push(`![${rng.pick(nouns)} illustration](https://cdn.bakeoff.example.com/images/${rng.pick(nouns)}-${rng.int(1, 99)}.jpg)`);
    }

    words = countWords(blocks.join('\n\n'));
    sinceHeading++;
  }

  return blocks.join('\n\n');
}

/**
 * Generate all posts into <out>/_posts, mirroring somiibo's per-dir counts,
 * date convention (YYYY-MM-DD-slug.md), and word-count quartiles.
 * @param {object} rng
 * @param {string} outDir
 * @returns {{count: number, wordCounts: number[]}}
 */
function generatePosts(rng, outDir) {
  const usedSlugs = new Set();
  const wordCounts = [];
  let postIndex = 0;

  for (const [dir, count] of Object.entries(spec.POSTS_PER_DIR)) {
    // Non-year dirs still need dated filenames (Jekyll convention)
    const year = /^\d{4}$/.test(dir) ? Number(dir) : (dir === 'seo' ? 2018 : 2019);

    for (let i = 0; i < count; i++) {
      const title = `How to ${rng.pick(spec.WORDS.verbs)} your ${rng.pick(spec.WORDS.nouns)} with ${rng.pick(spec.WORDS.adjectives)} ${rng.pick(spec.WORDS.nouns)}s`;
      let slug = slugify(title);
      if (usedSlugs.has(slug)) slug = `${slug}-${postIndex}`;
      usedSlugs.add(slug);

      const month = String(1 + (postIndex % 12)).padStart(2, '0');
      const day = String(1 + (postIndex % 28)).padStart(2, '0');

      const bucket = spec.POST_WORD_BUCKETS[postIndex % spec.POST_WORD_BUCKETS.length];
      const targetWords = rng.int(bucket.min, bucket.max);
      const body = postBody(rng, targetWords);
      wordCounts.push(countWords(body));

      const frontmatter = [
        '---',
        '### ALL PAGES ###',
        'layout: blueprint/blog/post',
        '',
        '### POST ONLY ###',
        'post:',
        `  title: "${title}"`,
        `  description: "${sentence(rng)}"`,
        `  author: ${rng.pick(spec.AUTHORS)}`,
        `  id: ${1000000 + postIndex}`,
        `  tags: ${JSON.stringify(rng.picks(spec.TAGS, rng.int(3, 5)))}`,
        `  categories: ${JSON.stringify(rng.picks(spec.CATEGORIES, rng.int(1, 3)))}`,
        '---',
      ].join('\n');

      jetpack.write(
        path.join(outDir, '_posts', dir, `${year}-${month}-${day}-${slug}.md`),
        `${frontmatter}\n\n${body}\n`
      );
      postIndex++;
    }
  }

  return { count: postIndex, wordCounts };
}

/**
 * Build the YAML frontmatter for a platform-bot page (data-heavy, mirrors
 * somiibo's 74-line platform pages incl. site.* refs and HTML-in-YAML).
 * @param {object} rng
 * @param {string} platform
 * @param {string} permalink
 * @returns {string}
 */
function platformBotPage(rng, platform, permalink) {
  const cards = [];
  const cardCount = rng.int(4, 6);
  for (let i = 0; i < cardCount; i++) {
    cards.push([
      `    - color: "${rng.pick(spec.COLORS)}"`,
      `      icon: "${rng.pick(spec.ICONS)}"`,
      `      title: "${rng.pick(['Follow automation', 'View automation', 'Like automation', 'Comment automation', 'Share automation', 'Schedule automation'])}"`,
      `      description: "${sentence(rng)}"`,
    ].join('\n'));
  }

  return [
    '---',
    '### ALL PAGES ###',
    'layout: platform-bot',
    `permalink: ${permalink}`,
    '',
    '### REGULAR PAGES ###',
    'meta:',
    `  title: "${platform} Bot - Grow Your Audience Automatically - {{ site.brand.name }}"`,
    `  description: "${sentence(rng)}"`,
    `  breadcrumb: "${platform} bot"`,
    '',
    'platform:',
    `  name: "${platform}"`,
    `  icon: "${rng.pick(spec.ICONS)}"`,
    `  color: "${rng.pick(spec.HEX_COLORS)}"`,
    `  gradient: "linear-gradient(135deg, ${rng.pick(spec.HEX_COLORS)} 0%, ${rng.pick(spec.HEX_COLORS)} 100%)"`,
    '',
    'hero:',
    `  headline: "Grow your ${platform} audience <span class='text-accent'>automatically</span>"`,
    `  subheadline: "${sentence(rng)}"`,
    '  demo:',
    `    title: "${platform} growth"`,
    `    platform: "${platform}"`,
    '    stat1_label: "Followers"',
    '    stat2_label: "Views"',
    '    stat3_label: "Engagement"',
    '',
    'features:',
    `  heading: "Everything you need to grow on <span class='text-accent'>${platform}</span>"`,
    `  subheading: "${sentence(rng)}"`,
    '  cards:',
    cards.join('\n'),
    '---',
    '',
  ].join('\n');
}

/**
 * Build a solution page (mirrors somiibo's 122-line solution pages).
 * @param {object} rng
 * @param {string} label
 * @param {string} permalink
 * @returns {string}
 */
function solutionPage(rng, label, permalink) {
  const stats = [];
  for (let i = 0; i < 3; i++) {
    stats.push([
      `    - icon: "${rng.pick(spec.ICONS)}"`,
      `      value: "+${rng.int(1, 99)}.${rng.int(0, 9)}K"`,
      `      label: "${rng.pick(['Followers', 'Likes', 'Views', 'Shares'])}"`,
    ].join('\n'));
  }
  const painPoints = [];
  const painCount = rng.int(3, 4);
  for (let i = 0; i < painCount; i++) {
    painPoints.push([
      `      - icon: "${rng.pick(spec.ICONS)}"`,
      `        color: "${rng.pick(spec.COLORS)}"`,
      `        title: "${rng.pick(['Hours wasted daily', 'Slow organic growth', 'Inconsistent posting', 'Burnout is real'])}"`,
      `        description: "${sentence(rng)}"`,
    ].join('\n'));
  }

  return [
    '---',
    'layout: solution',
    `permalink: ${permalink}`,
    '',
    'meta:',
    `  title: "${label} - {{ site.brand.name }}"`,
    `  description: "${sentence(rng)}"`,
    '',
    'solution:',
    `  label: "${label}"`,
    '  headline: "Automate your"',
    `  headline_accent: "${label.toLowerCase()}"`,
    `  subheadline: "${sentence(rng)}"`,
    '',
    '  preview_stats:',
    stats.join('\n'),
    '',
    '  pain_points:',
    `    headline: "${rng.pick(['Doing this manually is brutal', 'Manual growth does not scale', 'There is a better way'])}"`,
    `    subheadline: "${sentence(rng)}"`,
    '    items:',
    painPoints.join('\n'),
    '---',
    '',
  ].join('\n');
}

/**
 * Build a theme-base .html page (bracket-layout hack + Bootstrap body,
 * mirrors somiibo's index.html).
 * @param {object} rng
 * @param {string} permalink
 * @returns {string}
 */
function themeBasePage(rng, permalink) {
  const sections = [];
  const sectionCount = rng.int(3, 5);
  for (let i = 0; i < sectionCount; i++) {
    sections.push([
      `<section class="py-5 ${rng.pick(['bg-body', 'bg-body-tertiary', 'bg-gradient-rainbow text-light'])}">`,
      '  <div class="container">',
      '    <div class="row align-items-center">',
      '      <div class="col-lg-6">',
      `        <h2 class="fw-bold mb-3">${rng.pick(['Grow faster', 'Automate everything', 'Work smarter'])} with {{ site.brand.name }}</h2>`,
      `        <p class="lead">${sentence(rng)}</p>`,
      '      </div>',
      '      <div class="col-lg-6 text-center">',
      `        <img src="https://cdn.bakeoff.example.com/images/section-${i}.png" class="img-fluid" alt="section" loading="lazy">`,
      '      </div>',
      '    </div>',
      '  </div>',
      '</section>',
    ].join('\n'));
  }

  return [
    '---',
    '### ALL PAGES ###',
    'layout: themes/[ site.theme.id ]/frontend/core/base',
    `permalink: ${permalink}`,
    '',
    '### REGULAR PAGES ###',
    'meta:',
    '  title: "{{ site.meta.title }}"',
    '  description: "{{ site.meta.description }}"',
    '---',
    '',
    sections.join('\n\n'),
    '',
  ].join('\n');
}

/**
 * Generate all 105 pages into <out>/pages, mirroring somiibo's archetype mix
 * and directory structure.
 * @param {object} rng
 * @param {string} outDir
 * @returns {number} pages written
 */
function generatePages(rng, outDir) {
  const pagesDir = path.join(outDir, 'pages');
  let written = 0;

  // platform-bot ×59 — one unique platform each, round-robin across platform dirs
  for (let i = 0; i < spec.PAGE_ARCHETYPES['platform-bot'].count; i++) {
    const platform = spec.PLATFORM_NAMES[i];
    const slug = `${slugify(platform)}-bot`;
    const dir = spec.PLATFORM_DIRS[i % spec.PLATFORM_DIRS.length];
    jetpack.write(path.join(pagesDir, dir, `${slug}.md`), platformBotPage(rng, platform, `/platforms/${slug}`));
    written++;
  }

  // solution ×32 — round-robin across solution dirs; adjective cycles while the
  // noun index shifts by the lap count so every (adjective, noun) pair is unique
  for (let i = 0; i < spec.PAGE_ARCHETYPES['solution'].count; i++) {
    const { adjectives, nouns } = spec.WORDS;
    const label = `${adjectives[i % adjectives.length]} ${nouns[(i + Math.floor(i / adjectives.length)) % nouns.length]} automation`;
    const cap = label.charAt(0).toUpperCase() + label.slice(1);
    const slug = slugify(label);
    const dir = spec.SOLUTION_DIRS[i % spec.SOLUTION_DIRS.length];
    jetpack.write(path.join(pagesDir, dir, `${slug}.md`), solutionPage(rng, cap, `/solutions/${slug}`));
    written++;
  }

  // package ×5
  for (let i = 0; i < spec.PAGE_ARCHETYPES['package'].count; i++) {
    const name = ['starter', 'growth', 'pro', 'agency', 'enterprise'][i];
    jetpack.write(
      path.join(pagesDir, 'packages', `${name}.md`),
      solutionPage(rng, `${name.charAt(0).toUpperCase()}${name.slice(1)} package`, `/packages/${name}`).replace('layout: solution', 'layout: package')
    );
    written++;
  }

  // theme-base ×6 (.html with bracket layout)
  const themePages = ['index', 'download', 'enterprise', 'beta/index', 'affiliates', 'press'];
  for (const name of themePages) {
    const permalink = name === 'index' ? '/' : `/${name.replace(/\/index$/, '')}`;
    jetpack.write(path.join(pagesDir, `${name}.html`), themeBasePage(rng, permalink));
    written++;
  }

  // blueprint singles ×3
  const singles = [
    { file: 'about.md', layout: 'blueprint/index', permalink: '/about' },
    { file: 'pricing.md', layout: 'blueprint/pricing', permalink: '/pricing' },
    { file: 'contact.md', layout: 'blueprint/contact', permalink: '/contact' },
  ];
  for (const page of singles) {
    const content = [
      '---',
      '### ALL PAGES ###',
      `layout: ${page.layout}`,
      `permalink: ${page.permalink}`,
      '',
      '### PAGE CONFIG ###',
      'meta:',
      `  title: "${page.file.replace('.md', '')} - {{ site.brand.name }}"`,
      `  description: "${sentence(rng)}"`,
      '',
      'hero:',
      '  tagline: "{{ site.brand.name }}"',
      `  headline: "${sentence(rng)}"`,
      '---',
      '',
    ].join('\n');
    jetpack.write(path.join(pagesDir, page.file), content);
    written++;
  }

  return written;
}

/**
 * Generate the _alternatives collection docs.
 * @param {object} rng
 * @param {string} outDir
 * @returns {number} docs written
 */
function generateAlternatives(rng, outDir) {
  for (let i = 0; i < spec.ALTERNATIVES_COUNT; i++) {
    const competitor = spec.COMPETITOR_NAMES[i];
    const features = [];
    for (let f = 0; f < 5; f++) {
      features.push([
        `      - name: "${rng.pick(['Platform coverage', 'Automation depth', 'Pricing', 'Safety controls', 'Scheduling', 'Analytics'])}"`,
        `        icon: "${rng.pick(spec.ICONS)}"`,
        `        ours: "${sentence(rng)}"`,
        `        theirs: "${sentence(rng)}"`,
      ].join('\n'));
    }
    const content = [
      '---',
      'layout: blueprint/alternatives/alternative',
      'sitemap:',
      '  include: true',
      '',
      'alternative:',
      '  competitor:',
      `    name: "${competitor}"`,
      `    description: "${sentence(rng)}"`,
      '',
      '  comparison:',
      '    features:',
      features.join('\n'),
      '---',
      '',
    ].join('\n');
    jetpack.write(path.join(outDir, '_alternatives', `${slugify(competitor)}.md`), content);
  }
  return spec.ALTERNATIVES_COUNT;
}

/**
 * Compute quartile stats from an array of word counts.
 * @param {number[]} counts
 * @returns {object}
 */
function wordStats(counts) {
  const sorted = [...counts].sort((a, b) => a - b);
  const at = (q) => sorted[Math.floor(sorted.length * q)];
  return {
    min: sorted[0],
    p25: at(0.25),
    median: at(0.5),
    p75: at(0.75),
    max: sorted[sorted.length - 1],
  };
}

/**
 * Generate the full corpus.
 * @param {object} options
 * @param {string} options.outDir - absolute or cwd-relative output directory
 * @param {number} [options.seed=42]
 * @returns {object} the manifest that was written
 */
function generateCorpus(options) {
  const outDir = path.resolve(options.outDir);
  const seed = options.seed ?? DEFAULT_SEED;
  const rng = createRng(seed);

  jetpack.remove(outDir);

  const posts = generatePosts(rng, outDir);
  const pages = generatePages(rng, outDir);
  const alternatives = generateAlternatives(rng, outDir);

  // Consumer-LOCAL layouts (somiibo ships platform-bot/solution/package in
  // its own _layouts) — copied from the checked-in replicas; the engine
  // resolves consumer _layouts as the top layout layer.
  const layoutsFixtureDir = path.join(__dirname, '..', 'fixtures', 'consumer-layouts');
  for (const file of jetpack.list(layoutsFixtureDir) || []) {
    jetpack.copy(path.join(layoutsFixtureDir, file), path.join(outDir, '_layouts', file), { overwrite: true });
  }

  // Synthetic site.* data — the resolution source for {{ site.* }} refs
  jetpack.write(path.join(outDir, 'site-data.json'), {
    url: 'https://bakeoff.example.com',
    brand: {
      id: 'bakeoff',
      name: 'Bakeoff',
      description: 'Synthetic bake-off brand',
    },
    meta: {
      title: 'Bakeoff - Synthetic SSG benchmark corpus',
      description: 'A synthetic corpus shaped like the heaviest real OMEGA consumer site.',
    },
    theme: {
      id: 'classy',
      appearance: 'dark',
    },
  }, { jsonIndent: 2 });

  const manifest = {
    seed,
    spec: {
      postsPerDir: spec.POSTS_PER_DIR,
      pageArchetypes: Object.fromEntries(
        Object.entries(spec.PAGE_ARCHETYPES).map(([k, v]) => [k, v.count])
      ),
      alternativesCount: spec.ALTERNATIVES_COUNT,
    },
    counts: {
      posts: posts.count,
      pages,
      alternatives,
    },
    postWordStats: wordStats(posts.wordCounts),
  };
  jetpack.write(path.join(outDir, 'corpus-manifest.json'), manifest, { jsonIndent: 2 });

  return manifest;
}

// CLI
if (require.main === module) {
  const args = Object.fromEntries(
    process.argv.slice(2)
      .filter((a) => a.startsWith('--'))
      .map((a) => a.replace(/^--/, '').split('='))
  );
  const outDir = args.out || path.join(__dirname, '..', DEFAULT_OUT);
  const seed = args.seed ? Number(args.seed) : DEFAULT_SEED;

  const manifest = generateCorpus({ outDir, seed });
  console.log(`Corpus generated at ${path.resolve(outDir)}`);
  console.log(`  posts=${manifest.counts.posts} pages=${manifest.counts.pages} alternatives=${manifest.counts.alternatives} seed=${manifest.seed}`);
  console.log(`  post word stats: ${JSON.stringify(manifest.postWordStats)}`);
}

module.exports = { generateCorpus, slugify, countWords };
