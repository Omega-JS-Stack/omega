/**
 * Sample content (spec §8): the shared filler that keeps a content-less brand
 * alive in development — posts, teammates, updates. One corpus for every
 * theme, auto-generated with ROLLING dates: each file's authored date is a
 * rhythm relative to SAMPLE_EPOCH_UTC, and generation re-anchors that rhythm
 * to "now" (or an explicit anchor), so a virgin blog always looks alive —
 * never "6 months stale". `omega dev` also materializes the generated set
 * under the target's gitignored `.omega/sample-content/` so humans can read and
 * copy the files; the tree is machine-owned and regenerated every boot.
 */
const fs = require('node:fs');
const path = require('node:path');
const reads = require('@omega.js/devkit/reads');

// The day the sample corpus dates were authored against (spec §8 ruling,
// Ian 2026-07-18). Anchor === epoch reproduces the authored dates exactly —
// the determinism pin the test harness uses.
const SAMPLE_EPOCH_UTC = Date.UTC(2026, 6, 18);

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Collection dir (consumer + injection lane) ↔ packaged corpus dir.
const SAMPLE_SETS = [
  { collectionDir: '_posts', samplesDir: 'sample-posts' }, // the blog (11 posts — enough to exercise pagination at size 6)
  { collectionDir: '_team', samplesDir: 'sample-team' }, // the /team portrait grid + member pages
  { collectionDir: '_updates', samplesDir: 'sample-updates' }, // the /updates release feed
];

/**
 * Parse a YYYY-MM-DD string to a UTC-midnight timestamp.
 * @param {string} value
 * @returns {number}
 */
function parseDay(value) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * Format a UTC timestamp as YYYY-MM-DD.
 * @param {number} ms
 * @returns {string}
 */
function formatDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Resolve the rolling-date anchor (UTC-midnight ms). Precedence: explicit
 * option > OMEGA_SAMPLE_ANCHOR env (the harness determinism pin) > today.
 * @param {string} [explicit] - YYYY-MM-DD
 * @returns {number}
 */
function resolveAnchor(explicit) {
  const value = explicit || process.env.OMEGA_SAMPLE_ANCHOR;
  if (!value) {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }
  if (!DATE_RE.test(value)) {
    throw new Error(`Invalid sample-content anchor "${value}" — expected YYYY-MM-DD`);
  }
  return parseDay(value);
}

/**
 * Shift a YYYY-MM-DD string by the anchor's offset from the corpus epoch.
 * @param {string} value
 * @param {number} anchorMs
 * @returns {string}
 */
function shiftDay(value, anchorMs) {
  return formatDay(parseDay(value) + (anchorMs - SAMPLE_EPOCH_UTC));
}

/**
 * Roll one corpus file: date-prefixed filenames shift (posts — Eleventy reads
 * page.date from the prefix), `date: YYYY-MM-DD` lines inside the frontmatter
 * block shift (updates), a generated-content header comment lands inside
 * the frontmatter (inert in YAML, never rendered), and the `generated: true`
 * marker lands with it — the RENDER-visible half (#208), which templates key
 * the TEST badge off so filler can never be mistaken for the brand's own
 * writing on screen. It rides the generator, never the corpus files, so every
 * sample document carries it and no fixture can forget to.
 * @param {string} name - corpus filename
 * @param {string} content - corpus file content
 * @param {number} anchorMs
 * @param {string} collectionDir - for the header's "real files" hint
 * @returns {{ name: string, content: string }}
 */
function rollFile(name, content, anchorMs, collectionDir) {
  const dated = name.match(/^(\d{4}-\d{2}-\d{2})-(.*)$/);
  const outName = dated ? `${shiftDay(dated[1], anchorMs)}-${dated[2]}` : name;

  let outContent = content;
  const fmEnd = content.startsWith('---\n') ? content.indexOf('\n---', 4) : -1;
  if (fmEnd !== -1) {
    const header = '# Generated sample content (@omega.js/web) — dates roll with each dev build.\n'
      + `# Do not edit: real files in ${collectionDir}/ replace this whole set.\n`
      + 'generated: true\n';
    const frontmatter = content
      .slice(4, fmEnd)
      .replace(/^(\s*date: )(\d{4}-\d{2}-\d{2})$/gm, (_, prefix, day) => `${prefix}${shiftDay(day, anchorMs)}`);
    outContent = `---\n${header}${frontmatter}${content.slice(fmEnd)}`;
  }
  return { name: outName, content: outContent };
}

/**
 * Generate one sample set from the packaged corpus with dates re-anchored.
 * @param {string} defaultsDir - the package defaults/ root
 * @param {{ collectionDir: string, samplesDir: string }} set
 * @param {number} anchorMs
 * @returns {Array<{ name: string, content: string }>}
 */
function generateSampleSet(defaultsDir, set, anchorMs) {
  const dir = path.join(defaultsDir, set.samplesDir);
  // Through the captured-read helper (#200): configureOmega generates the sets
  // at config time, so the corpus dir becomes a dev config-reset target. The
  // boot-phase caller (reconcileSampleContent) runs outside a capture scope,
  // where the same reads record nothing.
  return reads.readdir(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => rollFile(name, reads.read(path.join(dir, name)), anchorMs, set.collectionDir));
}

/**
 * Does the consumer have any file of their own in a collection dir?
 * Recursive — Jekyll-style year subfolders (_posts/2024/…) count. Dotfiles
 * don't.
 *
 * Reads through the captured-read helper as a RESCAN capture (#200 Lane B):
 * the collection dirs are where the brand's real content lands, so they must
 * never become config-reset targets — the answer is re-scanned and the sample
 * injection gate consults it at render time. Config-time callers wrap this in
 * `reads.rescan(...)` (src/decisions.js); the boot-phase caller
 * (reconcileSampleContent) runs outside a capture scope and records nothing.
 * @param {string} consumerDir
 * @param {string} collectionDir - collection folder name ('_posts', '_team')
 * @returns {boolean}
 */
function hasOwnContent(consumerDir, collectionDir) {
  const root = path.join(consumerDir, collectionDir);
  if (!reads.dirExists(root)) return false;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of reads.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
      else if (entry.isFile()) return true;
    }
  }
  return false;
}

/**
 * Materialize the generated sets under `<targetRoot>/.omega/sample-content/` —
 * the gitignored test path (spec §8). Idempotent: each active collection is
 * rebuilt wholesale, collections the consumer owns are removed, and the tree
 * carries a self-`.gitignore` so it can never be committed regardless of the
 * target's own ignore rules. Never mixed with real brand content.
 * @param {object} options
 * @param {string} options.targetRoot - the target root (owns .omega/)
 * @param {string} options.consumerDir - the site src dir (own-content checks)
 * @param {string} options.defaultsDir - the package defaults/ root
 * @param {string} [options.anchor] - YYYY-MM-DD anchor override
 * @returns {{ root: string, written: string[], removed: string[] }}
 */
function reconcileSampleContent(options) {
  const root = path.join(options.targetRoot, '.omega', 'sample-content');
  const anchorMs = resolveAnchor(options.anchor);
  const written = [];
  const removed = [];

  for (const set of SAMPLE_SETS) {
    const target = path.join(root, set.collectionDir);
    if (hasOwnContent(options.consumerDir, set.collectionDir)) {
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        removed.push(set.collectionDir);
      }
      continue;
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    for (const { name, content } of generateSampleSet(options.defaultsDir, set, anchorMs)) {
      fs.writeFileSync(path.join(target, name), content);
      written.push(path.join(set.collectionDir, name));
    }
  }

  if (written.length) {
    fs.writeFileSync(path.join(root, '.gitignore'), '*\n');
  } else if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return { root, written, removed };
}

module.exports = {
  SAMPLE_EPOCH_UTC,
  SAMPLE_SETS,
  resolveAnchor,
  generateSampleSet,
  hasOwnContent,
  reconcileSampleContent,
};
