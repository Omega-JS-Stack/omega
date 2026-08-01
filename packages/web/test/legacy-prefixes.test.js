/**
 * Legacy-prefix guard (#44): the retired manager prefixes stay retired.
 *
 * The `uj_*` filters/tags, the `site.uj.*` globals, the `uj-*` classes and the
 * `__UJM_*` window flags were renamed to their `omega` spellings in one sweep
 * with no aliases, so a single re-introduced `uj_icon` (copy-pasted from a
 * legacy repo or an old brand) renders nothing and fails silently at build.
 * This walks the SHIPPED surfaces — core, defaults, themes, runtime, src, and
 * the template-kit source web registers — and fails on the first sighting.
 *
 * Prose naming the legacy managers (UJM, jekyll-uj-powertools, the migrate
 * lane's `ultimate-jekyll-manager.json` reader) is history, not API: only the
 * prefixed identifiers below are banned.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const PKG = path.resolve(__dirname, '..');
const KIT = path.resolve(PKG, '..', 'template-kit', 'src');

// The retired spellings, each with the name that replaced it.
const RETIRED = [
  [/\buj_[a-z]/, 'omega_*'],
  [/\bsite\.uj\b/, 'site.omega'],
  [/\buj-(?:password|language|schema)-/, 'omega-*'],
  [/\bdata-uj-/, 'data-omega-*'],
  [/__UJM_/, '__OMEGA_*'],
  [/\b_ujLibrary\b/, 'omega._library'],
];

const SURFACES = ['core', 'defaults', 'runtime', 'src', 'themes', KIT];

// The ONE file that must still spell the retired names: `omega migrate`'s
// codemod reads them out of a legacy consumer and writes the omega spellings.
const EXEMPT = path.join(PKG, 'src', 'migrate', 'rules.js');

// Vendored third-party trees carry their own vocabulary and never see the sweep.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'bootstrap']);
const SCAN_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.json5', '.html', '.md', '.scss', '.css', '.txt', '.yml']);

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...walk(path.join(dir, entry.name)));
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

test('#44: no retired legacy prefix survives on a shipped surface', () => {
  const sightings = [];

  for (const surface of SURFACES) {
    const dir = path.isAbsolute(surface) ? surface : path.join(PKG, surface);
    for (const file of walk(dir)) {
      if (file === EXEMPT) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const [pattern, replacement] of RETIRED) {
        if (!pattern.test(text)) continue;
        const line = text.split('\n').findIndex((each) => pattern.test(each)) + 1;
        sightings.push(`${path.relative(PKG, file)}:${line} — ${pattern} (use ${replacement})`);
      }
    }
  }

  assert.deepStrictEqual(sightings, [], `retired prefixes are back:\n${sightings.join('\n')}`);
});
