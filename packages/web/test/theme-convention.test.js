/**
 * #177 markup-convention guards: the base/skin/fork contract of
 * docs/web/sections.md, "Markup convention: base, skin, fork", pinned
 * mechanically so drift fails the suite.
 *
 * Guard 1 (class discipline): every class token in theme markup is omega-*
 * BEM (legal everywhere), <theme>-* BEM (legal only inside that theme's own
 * forks; classy- is legal nowhere because classy ships no markup), or known
 * shared vocabulary enumerated in fixtures/theme-class-allowlist.json5. A
 * new bare class fails until it is prefixed per the convention or
 * deliberately allowlisted in review.
 *
 * Guard 2 (fork boundaries): each skin theme's README carries a "## Forks"
 * section whose bullets each name exactly one backticked package-relative
 * path; the listed set must equal the theme's markup files on disk in both
 * directions. Classy ships zero markup files, and base appears in no fork
 * list.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const JSON5 = require('json5');

const { PKG } = require('./lib/build.js');

// The four convention themes (base plus every packaged skin).
const THEMES = ['base', 'classy', 'newsflash', 'neobrutalism'];

// Theme dirs the census deliberately skips: bootstrap is the vendored
// Bootstrap source, _template is the rung-1 starter (both ship no markup).
const NON_CENSUS_DIRS = ['bootstrap', '_template'];

// Markup class prefix -> the one theme whose files may carry it. classy maps
// to null: classy has no markup, so a classy-* class is a regression anywhere.
const PREFIX_OWNERS = { 'newsflash-': 'newsflash', 'neo-': 'neobrutalism', 'classy-': null };

// Skin themes with fork lists (theme dir -> its fork class prefix).
const FORK_THEMES = ['newsflash', 'neobrutalism'];

const ALLOWLIST = JSON5.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'theme-class-allowlist.json5'), 'utf8'),
);
const ALLOW_PREFIXES = ALLOWLIST.patterns.map((pattern) => {
  assert.ok(pattern.endsWith('-*'), `allowlist pattern "${pattern}" must end with -*`);
  return pattern.slice(0, -1);
});

// Liquid tags and output are replaced with a sentinel; a class token touching
// the sentinel is interpolated (dynamic) and skipped by the census.
const SENTINEL = '\u0000';

/**
 * Recursively list every file under a directory.
 * @param {string} dir - absolute directory (missing dirs yield [])
 * @param {string[]} [out] - accumulator
 * @returns {string[]} absolute file paths
 */
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** @param {string} file - absolute path @returns {string} posix path relative to the package root */
const rel = (file) => path.relative(PKG, file).split(path.sep).join('/');

/** @param {string} source @returns {string} source with Liquid tags/output replaced by the sentinel */
const stripLiquid = (source) => source
  .replace(/\{%-?[\s\S]*?-?%\}/g, SENTINEL)
  .replace(/\{\{-?[\s\S]*?-?\}\}/g, SENTINEL);

/** @param {string} value - a class attribute value @returns {string[]} static class tokens */
const tokenize = (value) => stripLiquid(value)
  .split(/\s+/)
  .filter((token) => token && !token.includes(SENTINEL));

/** @param {string} source - html source @returns {string[]} class tokens from class attributes */
function collectHtmlTokens(source) {
  const tokens = [];
  const clean = stripLiquid(source);
  for (const match of clean.matchAll(/(?<![-\w])class\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    tokens.push(...tokenize(match[1] ?? match[2]));
  }
  return tokens;
}

/**
 * Class tokens from a section/component json5: string values under class-ish
 * keys (class, classes, *_class) inside the defaults and demo subtrees. The
 * args subtree is type declarations, never class values, so it is skipped.
 * @param {string} source - json5 source
 * @returns {string[]} class tokens
 */
function collectJson5Tokens(source) {
  const tokens = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && /(^|_)class(es)?$/i.test(key)) tokens.push(...tokenize(value));
      else visit(value);
    }
  };
  const parsed = JSON5.parse(source);
  visit(parsed.defaults);
  visit(parsed.demo);
  return tokens;
}

/** @param {string} token @returns {boolean} whether the allowlist sanctions this bare token */
const allowed = (token) => ALLOWLIST.literals.includes(token)
  || ALLOW_PREFIXES.some((prefix) => token.startsWith(prefix) && token.length > prefix.length);

// ─── Guard 1: class-discipline census ───────────────────────────────────────

test('#177 guard 1: every theme class token is omega-*, own-theme-*, or allowlisted', () => {
  const violations = [];
  let fileCount = 0;
  let tokenCount = 0;

  for (const theme of THEMES) {
    for (const file of walk(path.join(PKG, 'themes', theme))) {
      let tokens;
      if (file.endsWith('.html')) tokens = collectHtmlTokens(fs.readFileSync(file, 'utf8'));
      else if (file.endsWith('.json5')) tokens = collectJson5Tokens(fs.readFileSync(file, 'utf8'));
      else continue;

      fileCount += 1;
      for (const token of tokens) {
        tokenCount += 1;
        if (!/^[A-Za-z0-9_-]+$/.test(token)) {
          violations.push(`${rel(file)}: "${token}" is not a valid class token`);
          continue;
        }
        if (token.startsWith('omega-')) continue;

        const prefix = Object.keys(PREFIX_OWNERS).find((candidate) => token.startsWith(candidate));
        if (prefix) {
          const owner = PREFIX_OWNERS[prefix];
          if (owner === null) {
            violations.push(`${rel(file)}: "${token}" wears the classy- prefix, which is legal nowhere (classy ships no markup)`);
          }
          else if (owner !== theme) {
            violations.push(`${rel(file)}: "${token}" wears the ${prefix}* prefix, which is legal only inside themes/${owner}`);
          }
          continue;
        }

        if (!allowed(token)) {
          violations.push(`${rel(file)}: bare class "${token}" is not in the allowlist; prefix it per the convention or allowlist it in review (test/fixtures/theme-class-allowlist.json5)`);
        }
      }
    }
  }

  // Tripwire: a broken walk or tokenizer would pass vacuously.
  assert.ok(fileCount >= 50, `census walked only ${fileCount} markup files; the walk is broken`);
  assert.ok(tokenCount >= 1000, `census saw only ${tokenCount} class tokens; the tokenizer is broken`);

  // Tripwire: a theme folder the census does not know is unguarded markup.
  // Adding a theme means adding it to THEMES (and the convention) here.
  const onDisk = fs.readdirSync(path.join(PKG, 'themes'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NON_CENSUS_DIRS.includes(entry.name))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(onDisk, [...THEMES].sort(),
    `themes on disk do not match the census list; register new themes in THEMES (and PREFIX_OWNERS/FORK_THEMES as fits)`);

  assert.deepEqual(violations, [], `class-discipline violations:\n  ${violations.join('\n  ')}`);
});

// ─── Guard 2: fork boundaries ───────────────────────────────────────────────

/**
 * Parse a theme README's "## Forks" section into its listed paths. Each
 * bullet line must carry exactly one backticked package-relative path.
 * @param {string} theme - theme dir name
 * @returns {string[]} listed fork paths (package-relative, posix)
 */
function parseForkList(theme) {
  const readme = fs.readFileSync(path.join(PKG, 'themes', theme, 'README.md'), 'utf8');
  const match = readme.match(/^## Forks$([\s\S]*?)(?=^## |(?![\s\S]))/m);
  assert.ok(match, `themes/${theme}/README.md has no "## Forks" section`);

  const bullets = match[1].split('\n').filter((line) => line.startsWith('- '));
  assert.ok(bullets.length > 0, `themes/${theme}/README.md "## Forks" section lists no bullets`);

  return bullets.map((bullet) => {
    const spans = [...bullet.matchAll(/`([^`]+)`/g)].map((span) => span[1]);
    assert.equal(
      spans.length, 1,
      `themes/${theme}/README.md fork bullet must carry exactly one backticked path, got ${spans.length}: ${bullet}`,
    );
    return spans[0];
  });
}

test('#177 guard 2: skin fork lists match markup on disk in both directions', () => {
  for (const theme of FORK_THEMES) {
    const listed = parseForkList(theme);
    const onDisk = walk(path.join(PKG, 'themes', theme))
      .filter((file) => file.endsWith('.html'))
      .map(rel);

    // Every listed path stays inside its own theme; base is forked by nobody.
    for (const entry of listed) {
      assert.ok(
        entry.startsWith(`themes/${theme}/`),
        `themes/${theme}/README.md lists "${entry}", which is outside themes/${theme}/`,
      );
      assert.ok(!entry.startsWith('themes/base/'), `themes/${theme}/README.md lists a base path: ${entry}`);
    }

    const missing = listed.filter((entry) => !onDisk.includes(entry));
    assert.deepEqual(missing, [], `themes/${theme}/README.md lists forks with no file on disk:\n  ${missing.join('\n  ')}`);

    const unlisted = onDisk.filter((file) => !listed.includes(file));
    assert.deepEqual(unlisted, [], `themes/${theme} markup files missing from the README fork list:\n  ${unlisted.join('\n  ')}`);

    assert.deepEqual(listed.slice().sort(), onDisk.slice().sort(), `themes/${theme} fork list and disk disagree`);
  }
});

test('#177 guard 2: classy is a skin and ships zero markup files', () => {
  const markup = walk(path.join(PKG, 'themes', 'classy'))
    .filter((file) => file.endsWith('.html'))
    .map(rel);
  assert.deepEqual(markup, [], `themes/classy must ship no markup; found:\n  ${markup.join('\n  ')}`);
});
