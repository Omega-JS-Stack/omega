/**
 * corpus-spec.js — SSOT for the synthetic bake-off corpus shape.
 *
 * Every number in here was measured against the REAL somiibo-website
 * (/Users/ian/Developer/Repositories/Somiibo/somiibo-website, read-only)
 * on 2026-07-06. The corpus generator mirrors these distributions exactly so
 * both bake-off candidates (Eleventy / Astro) build content statistically
 * identical to the heaviest real consumer site. See BASELINE.md for the
 * matching Jekyll build measurement.
 *
 * Measured facts (somiibo src/):
 *   - 1030 posts under src/_posts/{year}/, word counts min=346 p25=875
 *     median=1017 p75=1797 max=7522
 *   - 105 pages under src/pages/: 99 .md + 6 .html; layouts:
 *     59× platform-bot, 32× solution, 5× package, 6× themes-bracket base,
 *     1× blueprint/pricing, 1× blueprint/index, 1× blueprint/contact
 *   - 20 collection docs, all in _alternatives (_team/_updates empty)
 *   - 199 `{{ site.* }}` refs inside page frontmatter values
 */

// Posts per year directory — exact somiibo distribution (total = 1030)
const POSTS_PER_DIR = {
  2017: 12,
  2018: 9,
  2019: 6,
  2020: 104,
  2021: 117,
  2022: 218,
  2023: 160,
  2024: 196,
  2025: 83,
  2026: 104,
  other: 9,
  seo: 12,
};

// Post body word-count quartile ranges — sampled uniformly within each bucket
// so the generated distribution matches somiibo's measured quartiles
const POST_WORD_BUCKETS = [
  { min: 346, max: 875 },   // Q1
  { min: 875, max: 1017 },  // Q2
  { min: 1017, max: 1797 }, // Q3
  { min: 1797, max: 7522 }, // Q4 (long tail)
];

// Page archetypes — exact somiibo layout distribution (total = 105)
const PAGE_ARCHETYPES = {
  'platform-bot': { count: 59, ext: '.md' },
  'solution': { count: 32, ext: '.md' },
  'package': { count: 5, ext: '.md' },
  'theme-base': { count: 6, ext: '.html' },  // layout: themes/[ site.theme.id ]/frontend/core/base
  'blueprint-index': { count: 1, ext: '.md' },
  'blueprint-pricing': { count: 1, ext: '.md' },
  'blueprint-contact': { count: 1, ext: '.md' },
};

// Page subdirectories — mirrors somiibo's src/pages tree; platform/solution
// pages are distributed round-robin across their group dirs
const PLATFORM_DIRS = [
  'platforms/social-main',
  'platforms/social-side',
  'platforms/exchange-main',
  'platforms/exchange-side',
  'platforms/exchange-side-2',
];
const SOLUTION_DIRS = [
  'solutions/general',
  'solutions/industries',
  'solutions/professions',
  'solutions/use-cases',
];

// Collections (somiibo: only _alternatives is populated)
const ALTERNATIVES_COUNT = 20;

// Author pool — post frontmatter `post.author` values
const AUTHORS = ['alex-rivers', 'casey-morgan', 'jordan-blake', 'riley-quinn', 'sam-harper', 'taylor-reed'];

// Tag / category pools for post frontmatter
const TAGS = [
  'social media automation', 'growth hacking', 'content strategy', 'audience targeting',
  'brand awareness', 'creator economy', 'posting cadence', 'engagement tactics',
  'platform growth', 'marketing workflows', 'follower growth', 'niche targeting',
];
const CATEGORIES = ['Marketing', 'Business', 'Technology', 'Growth', 'Strategy', 'Social Media'];

// Word pools for deterministic sentence assembly (blogify.js precedent in UJM)
const WORDS = {
  adjectives: ['consistent', 'organic', 'automated', 'sustainable', 'practical', 'repeatable', 'modern', 'effective', 'scalable', 'proven', 'strategic', 'reliable'],
  nouns: ['workflow', 'audience', 'platform', 'campaign', 'schedule', 'engagement', 'strategy', 'community', 'channel', 'system', 'playbook', 'routine'],
  verbs: ['grow', 'automate', 'streamline', 'schedule', 'optimize', 'measure', 'repurpose', 'target', 'build', 'refine', 'launch', 'scale'],
  connectors: ['so that', 'which means', 'because', 'and then', 'while', 'so'],
};

// Synthetic platform pool for platform-bot pages (59 needed)
const PLATFORM_NAMES = [
  'Vibely', 'Streamly', 'Clipzy', 'Wavecast', 'Snapdeck', 'Loopify', 'Beatsync', 'Chirpr',
  'Framely', 'Glowcast', 'Hublr', 'Jamboard', 'Kliply', 'Lensly', 'Mixtro', 'Notely',
  'Orbitly', 'Pulsecast', 'Quirkly', 'Reelio', 'Soundlyft', 'Trendly', 'Upcastr', 'Vidora',
  'Wispr', 'Xylo', 'Yonder', 'Zephyrly', 'Amplyfi', 'Boostly', 'Castify', 'Dripcast',
  'Echofy', 'Flowly', 'Grooveo', 'Hypely', 'Intently', 'Jivecast', 'Kudosly', 'Livewire',
  'Momently', 'Nichely', 'Octavely', 'Postly', 'Quantcast', 'Risely', 'Streakly', 'Tunely',
  'Upliftr', 'Viewly', 'Whistly', 'Xpandly', 'Yieldly', 'Zoomly', 'Ampward', 'Beamly',
  'Crestly', 'Driftcast', 'Emberly',
];

// Synthetic competitor pool for _alternatives docs (20 needed)
const COMPETITOR_NAMES = [
  'GrowthPilot', 'SocialForge', 'BoostLab', 'FollowerFox', 'EngageBot', 'ViralPath',
  'AudienceIQ', 'ReachRocket', 'TrendTamer', 'PostPulse', 'FameFactory', 'ClickCrew',
  'BuzzBuilder', 'SwayStack', 'NicheNinja', 'LoopLift', 'StarSurge', 'WaveWrangler',
  'HypeHarbor', 'GrowGrid',
];

// Icon / color pools for page frontmatter data blocks
const ICONS = ['rocket', 'chart-line', 'users', 'bolt', 'heart', 'eye', 'star', 'globe', 'clock', 'shield', 'tv', 'music'];
const COLORS = ['primary', 'success', 'info', 'warning', 'danger', 'secondary'];
const HEX_COLORS = ['#9146FF', '#1DB954', '#FF0050', '#1DA1F2', '#FF4500', '#0077B5', '#E60023', '#FE2C55'];

module.exports = {
  POSTS_PER_DIR,
  POST_WORD_BUCKETS,
  PAGE_ARCHETYPES,
  PLATFORM_DIRS,
  SOLUTION_DIRS,
  ALTERNATIVES_COUNT,
  AUTHORS,
  TAGS,
  CATEGORIES,
  WORDS,
  PLATFORM_NAMES,
  COMPETITOR_NAMES,
  ICONS,
  COLORS,
  HEX_COLORS,
};
