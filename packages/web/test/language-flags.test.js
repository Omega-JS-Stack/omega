/**
 * The language-flag aliases (#129) — the client switcher fetches a flag by the
 * row's own hreflang code, so the build writes language-named copies of the
 * country-named core set into the emitted icon dir. Runs the REAL emitIcons
 * over the REAL core/icons set (no fixture flags: the point is that the shipped
 * set reaches the shipped path).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { emitIcons } = require('@omega.js/devkit/icons');

const { emitLanguageFlags } = require('../src/language-flags.js');
const { PATHS } = require('../src/paths.js');
const { PKG } = require('./lib/build.js');

const OUT = path.join(PKG, '.omega', 'language-flags-test-out');

/** Emit the icon set (flags included) into a clean output dir. */
function emitInto(outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  emitIcons({ outDir, coreIconsDir: path.join(PATHS.core, 'icons') });

  return path.join(outDir, 'assets', 'fa', 'flags');
}

test('emitIcons already ships the core flag set — the aliases only add names to it', () => {
  const flagsDir = emitInto(OUT);

  assert.ok(fs.existsSync(path.join(flagsDir, 'us.svg')), 'the country-named set is the emitted one');
  assert.ok(!fs.existsSync(path.join(flagsDir, 'lang')), 'and carries no language namespace of its own');
});

test('a language row can fetch its own code: lang/en → the us flag, byte for byte', () => {
  const flagsDir = emitInto(OUT);
  const { files } = emitLanguageFlags({ outDir: OUT });

  assert.ok(files > 0, 'aliases were written');
  assert.deepEqual(
    fs.readFileSync(path.join(flagsDir, 'lang', 'en.svg')),
    fs.readFileSync(path.join(flagsDir, 'us.svg')),
    'lang/en.svg IS the us flag — the map is template-kit\'s, not a second copy',
  );
  assert.ok(fs.existsSync(path.join(flagsDir, 'lang', 'ja.svg')), 'ja → jp');
  assert.ok(fs.existsSync(path.join(flagsDir, 'lang', 'zh.svg')), 'zh → cn');
  assert.ok(fs.existsSync(path.join(flagsDir, 'lang', 'es.svg')), 'a language whose code equals its country is aliased too — the browser path is uniform');
});

test('the language namespace never touches a country flag of the same name', () => {
  const flagsDir = emitInto(OUT);
  const argentina = fs.readFileSync(path.join(flagsDir, 'ar.svg'));
  const canada = fs.readFileSync(path.join(flagsDir, 'ca.svg'));

  emitLanguageFlags({ outDir: OUT });

  // ar = Arabic AND Argentina, ca = Catalan AND Canada; the map sends both
  // languages elsewhere (ar → sa, ca → es), so a flat alias would have
  // overwritten two real flags
  assert.deepEqual(fs.readFileSync(path.join(flagsDir, 'ar.svg')), argentina, 'ar.svg is still Argentina');
  assert.deepEqual(fs.readFileSync(path.join(flagsDir, 'ca.svg')), canada, 'ca.svg is still Canada');
  assert.deepEqual(
    fs.readFileSync(path.join(flagsDir, 'lang', 'ar.svg')),
    fs.readFileSync(path.join(flagsDir, 'sa.svg')),
    'and an Arabic row gets Saudi Arabia, from its own namespace',
  );
  assert.deepEqual(
    fs.readFileSync(path.join(flagsDir, 'lang', 'ca.svg')),
    fs.readFileSync(path.join(flagsDir, 'es.svg')),
    'a Catalan row gets Spain',
  );
});

test('a language whose country has no flag gets none — the row drops its <img>', () => {
  const flagsDir = emitInto(OUT);
  emitLanguageFlags({ outDir: OUT });

  assert.ok(!fs.existsSync(path.join(flagsDir, 'il.svg')), 'the set carries no Israeli flag to alias');
  assert.ok(!fs.existsSync(path.join(flagsDir, 'lang', 'he.svg')), 'so Hebrew stays absent rather than 0 bytes');
  assert.ok(!fs.existsSync(path.join(flagsDir, 'lang', 'uk.svg')), 'Ukrainian likewise — ua.svg is not in the set');
});

test('the pass is idempotent — a second run rewrites the same aliases, never doubles', () => {
  const flagsDir = emitInto(OUT);
  const first = emitLanguageFlags({ outDir: OUT });
  const afterFirst = fs.readdirSync(flagsDir, { recursive: true }).sort();
  const second = emitLanguageFlags({ outDir: OUT });

  assert.equal(second.files, first.files, 'the same alias count');
  assert.deepEqual(fs.readdirSync(flagsDir, { recursive: true }).sort(), afterFirst, 'the same files');
});

test('an output with no emitted icon set is a no-op, not a crash', () => {
  const empty = path.join(PKG, '.omega', 'language-flags-test-empty');
  fs.rmSync(empty, { recursive: true, force: true });

  assert.deepEqual(emitLanguageFlags({ outDir: empty }).files, 0, 'nothing to alias');
});
