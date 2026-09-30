/**
 * agents-md: the one builder of every project-root AGENTS.md, brand root or a
 * framework used alone. The Default section imports the installed manager's
 * AGENTS.md, the Custom section holds the project's notes and survives every
 * path, every older shape converges, and a brand target keeps none. Real
 * directories in an os.tmpdir() scratch, no mocks.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const agentsMd = require('../src/agents-md.js');
const { DEFAULT_MARKER, CUSTOM_MARKER, sectionMarkers } = require('../src/merge-line-files.js');

const { IMPORT_LINE, GUIDE_SUBPATH, RETIRED_SUBPATH, ensureAgentsMd, removeRetiredLink, resolveImportLine, retireAgentsMd, scaffoldAgentsMd } = agentsMd;
const EM_DASH = String.fromCharCode(0x2014);
const MD = sectionMarkers('AGENTS.md');

// The one project-root shape: the import under Default, the notes under Custom.
function shaped(notes = '', importLine = IMPORT_LINE) {
  return `${MD.defaultMarker}\n${importLine}\n\n${MD.customMarker}\n${notes}`;
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-agents-md-'));
}

function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

// The retired per-framework template's shape: a framework section above the
// Custom marker, its shipped boilerplate below it.
function oldTemplate(customBody) {
  return `${DEFAULT_MARKER}\n# OMEGA Backend consumer project\n\n## Framework\n\nframework guidance\n\n${CUSTOM_MARKER}\n\n## Project-specific notes\n\nAdd anything specific to THIS project here. Edits below this line are preserved across runs.\n${customBody}`;
}

// The defaults engine's result shape, the vocabulary scaffoldAgentsMd records into.
function engineResult() {
  return { written: [], merged: [], skipped: [], removed: [] };
}

function recordingLogger() {
  const lines = { log: [], warn: [] };
  return { lines, logger: { log: (m) => lines.log.push(m), warn: (m) => lines.warn.push(m), error() {} } };
}

// ─── The import line and the scope walk ──────────────────────────────────────

test('agents-md: the import line is the scope path to the manager\'s AGENTS.md', () => {
  assert.equal(IMPORT_LINE, '@node_modules/@omega.js/manager/AGENTS.md');
});

test('agents-md: resolveImportLine walks up to a hoisted install and falls back to canonical', () => {
  const root = tmpdir();
  const brand = path.join(root, 'targets', 'my-brand');
  fs.mkdirSync(brand, { recursive: true });
  assert.equal(resolveImportLine(brand), IMPORT_LINE, 'nothing installed: the canonical project-local path');

  fs.mkdirSync(path.join(root, 'node_modules', '@omega.js', 'manager'), { recursive: true });
  assert.equal(resolveImportLine(brand), `@../../${GUIDE_SUBPATH}`, 'hoisted two levels up');

  fs.mkdirSync(path.join(brand, 'node_modules', '@omega.js', 'manager'), { recursive: true });
  assert.equal(resolveImportLine(brand), IMPORT_LINE, 'a project-local install wins');
});

test('agents-md: an @omega.js dir without the manager never wins the scope walk', () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, 'node_modules', '@omega.js', 'manager'), { recursive: true });
  const targetDir = path.join(root, 'targets', 'website');
  fs.mkdirSync(path.join(targetDir, 'node_modules', '@omega.js', 'web'), { recursive: true });

  assert.equal(resolveImportLine(targetDir), `@../../${GUIDE_SUBPATH}`);
});

// ─── The retired scope link ──────────────────────────────────────────────────

test('agents-md: the retired import line converges to the manager import, notes kept', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `@${RETIRED_SUBPATH}\n\n# Notes survive\n`);

  assert.equal(ensureAgentsMd(dir), 'converged');
  assert.equal(read(dir, 'AGENTS.md'), shaped('# Notes survive\n'));
});

test('agents-md: removeRetiredLink removes the old scope link once, dangling or not', () => {
  const brand = tmpdir();
  const scope = path.join(brand, 'node_modules', '@omega.js');
  fs.mkdirSync(path.join(scope, 'manager'), { recursive: true });
  const link = path.join(scope, 'AGENTS.md');
  fs.symlinkSync(path.join(brand, 'gone.md'), link);

  assert.equal(removeRetiredLink(brand, { dryRun: true }), 'removed');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'a dry run removes nothing');

  assert.equal(removeRetiredLink(brand), 'removed');
  assert.equal(fs.lstatSync(link, { throwIfNoEntry: false }), undefined);
  assert.equal(removeRetiredLink(brand), 'absent');
  assert.equal(removeRetiredLink(tmpdir()), 'absent', 'no scope at all');
});

// ─── ensureAgentsMd ──────────────────────────────────────────────────────────

test('agents-md: missing AGENTS.md is created: the import under Default, an empty Custom section, no heading', () => {
  const dir = tmpdir();
  assert.equal(ensureAgentsMd(dir), 'created');

  assert.equal(read(dir, 'AGENTS.md'), shaped());
  assert.ok(!read(dir, 'AGENTS.md').includes(EM_DASH), 'no em dash in the written AGENTS.md');

  assert.equal(ensureAgentsMd(dir), 'present');
});

test('agents-md: a stale-depth import in the Default section is healed, the Custom section untouched', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), shaped('# Notes survive\n', `@../../${GUIDE_SUBPATH}`));

  assert.equal(ensureAgentsMd(dir), 'healed');
  assert.equal(read(dir, 'AGENTS.md'), shaped('# Notes survive\n'));
  assert.equal(ensureAgentsMd(dir), 'present');
});

test('agents-md: the import-on-line-1 shape converges: the skeleton heading drops, every other line lands under Custom in order', () => {
  for (const heading of ['# OMEGA Playground: brand notes', '# acme-site: project notes']) {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `@../../${GUIDE_SUBPATH}\n<!-- keep this -->\n\n${heading}\n\nOur deploy needs the VPN up.\n\n## Later\n`);

    assert.equal(ensureAgentsMd(dir), 'converged');
    assert.equal(read(dir, 'AGENTS.md'), shaped('<!-- keep this -->\n\nOur deploy needs the VPN up.\n\n## Later\n'));
    assert.equal(ensureAgentsMd(dir), 'present', 'a second run writes nothing');
  }
});

test('agents-md: a heading-only file converges to the fresh file', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `${IMPORT_LINE}\n\n# The Daily Build: brand notes\n`);

  assert.equal(ensureAgentsMd(dir), 'converged');
  assert.equal(read(dir, 'AGENTS.md'), shaped());
});

test('agents-md: a hand-written file without the import converges, every line kept under Custom', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# My brand\n\nHand-written notes that must survive.\n');

  assert.equal(ensureAgentsMd(dir), 'converged');
  assert.equal(read(dir, 'AGENTS.md'), shaped('# My brand\n\nHand-written notes that must survive.\n'));
  assert.equal(ensureAgentsMd(dir), 'present');
});

test('agents-md: converging removes a stray mid-file copy of the import, no duplicates ever', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# Notes\n\n${IMPORT_LINE}\n\nMore notes.\n`);

  assert.equal(ensureAgentsMd(dir), 'converged');
  const content = read(dir, 'AGENTS.md');
  assert.equal(content.split('\n').filter((line) => line.trim() === IMPORT_LINE).length, 1);
  assert.equal(content, shaped('# Notes\n\nMore notes.\n'));
});

// ─── The retired per-framework template converges ────────────────────────────

test('agents-md: an old-template AGENTS.md converges: framework section gone, consumer notes kept under Custom', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), oldTemplate('\nOur deploy needs the VPN up.\n'));

  assert.equal(ensureAgentsMd(dir), 'converged');
  assert.equal(read(dir, 'AGENTS.md'), shaped('Our deploy needs the VPN up.\n'));

  assert.equal(ensureAgentsMd(dir), 'present', 'a converged file is the one shape: the next run is a no-op');
});

test('agents-md: an old template carrying only its shipped boilerplate converges to the fresh file', () => {
  for (const custom of [oldTemplate(''), `${DEFAULT_MARKER}\nguidance\n\n${CUSTOM_MARKER}\n<!-- Add your project-specific notes below this line -->\n`]) {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), custom);

    assert.equal(ensureAgentsMd(dir), 'converged');
    assert.equal(read(dir, 'AGENTS.md'), shaped());
  }
});

test('agents-md: notes quoting the # markers converge once as plain notes, never as the retired template', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `${IMPORT_LINE}\n\n# Acme: project notes\n\nThe old template split on:\n${DEFAULT_MARKER}\n${CUSTOM_MARKER}\n`);

  assert.equal(ensureAgentsMd(dir), 'converged');
  assert.equal(read(dir, 'AGENTS.md'), shaped(`The old template split on:\n${DEFAULT_MARKER}\n${CUSTOM_MARKER}\n`));
  assert.equal(ensureAgentsMd(dir), 'present');
});

test('agents-md: notes quoting the markdown markers inline take the converge path and lose nothing', () => {
  const dir = tmpdir();
  const notes = `# Acme\n\nWe split on \`${MD.defaultMarker}\` and \`${MD.customMarker}\`.\n`;
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), notes);

  assert.equal(ensureAgentsMd(dir), 'converged');
  assert.equal(read(dir, 'AGENTS.md'), shaped(notes));
  assert.equal(ensureAgentsMd(dir), 'present');
});

test('agents-md: a title above the Default marker of a marked file moves to the top of Custom', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# Acme\n\n${shaped('Our deploy needs the VPN up.\n')}`);

  assert.equal(ensureAgentsMd(dir), 'healed');
  assert.equal(read(dir, 'AGENTS.md'), shaped('# Acme\n\nOur deploy needs the VPN up.\n'));
  assert.equal(ensureAgentsMd(dir), 'present');
});

test('agents-md: a Custom section holding the import converges once, then is present', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), oldTemplate(`\n${IMPORT_LINE}\n\n# Acme: project notes\n\nOur deploy needs the VPN up.\n`));

  assert.equal(ensureAgentsMd(dir), 'converged');
  assert.equal(read(dir, 'AGENTS.md'), shaped('Our deploy needs the VPN up.\n'));
  assert.equal(ensureAgentsMd(dir), 'present');
});

test('agents-md: a dry run reports the convergence and the heal, and writes nothing', () => {
  const dir = tmpdir();
  const content = oldTemplate('\nkeep me\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), content);

  assert.equal(ensureAgentsMd(dir, { dryRun: true }), 'converged');
  assert.equal(read(dir, 'AGENTS.md'), content);

  const stale = shaped('', `@../${GUIDE_SUBPATH}`);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), stale);
  assert.equal(ensureAgentsMd(dir, { dryRun: true }), 'healed');
  assert.equal(read(dir, 'AGENTS.md'), stale);
});

// ─── A brand target keeps none ───────────────────────────────────────────────

test('agents-md: retireAgentsMd removes a copy holding nothing the consumer wrote', () => {
  for (const content of [shaped(), `${IMPORT_LINE}\n\n# web: project notes\n`, oldTemplate('')]) {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), content);
    assert.equal(retireAgentsMd(dir), 'removed');
    assert.equal(fs.existsSync(path.join(dir, 'AGENTS.md')), false);
  }

  assert.equal(retireAgentsMd(tmpdir()), 'absent');
});

test('agents-md: retireAgentsMd keeps a copy carrying consumer notes, any shape', () => {
  for (const content of [shaped('Our deploy needs the VPN up.\n'), oldTemplate('\nOur deploy needs the VPN up.\n'), `${IMPORT_LINE}\n\n# web: project notes\n\nOur deploy needs the VPN up.\n`, '# Hand-written\n']) {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), content);

    assert.equal(retireAgentsMd(dir), 'kept');
    assert.equal(read(dir, 'AGENTS.md'), content);
  }
});

// ─── The framework scaffold step ─────────────────────────────────────────────

test('agents-md: scaffoldAgentsMd writes a standalone project the builder\'s file and records it', () => {
  const dir = path.join(tmpdir(), 'acme-site');
  fs.mkdirSync(dir);
  const result = engineResult();
  const { lines, logger } = recordingLogger();

  scaffoldAgentsMd({ outputDir: dir, standalone: true, result, logger });
  assert.equal(read(dir, 'AGENTS.md'), shaped());
  assert.deepEqual(result.written, ['AGENTS.md']);
  assert.ok(lines.log.some((m) => m.includes('AGENTS.md')), 'the write is logged');

  const again = engineResult();
  scaffoldAgentsMd({ outputDir: dir, standalone: true, result: again, logger });
  assert.deepEqual(again, { written: [], merged: [], skipped: ['AGENTS.md'], removed: [] }, 'a rerun writes nothing');
});

test('agents-md: scaffoldAgentsMd converges a standalone old template loudly', () => {
  const dir = path.join(tmpdir(), 'acme-site');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), oldTemplate('\nOur deploy needs the VPN up.\n'));
  const result = engineResult();
  const { lines, logger } = recordingLogger();

  scaffoldAgentsMd({ outputDir: dir, standalone: true, result, logger });
  assert.deepEqual(result.merged, ['AGENTS.md']);
  assert.ok(lines.warn.some((m) => /Converged AGENTS\.md/.test(m)), 'the convergence warns');
  assert.equal(read(dir, 'AGENTS.md'), shaped('Our deploy needs the VPN up.\n'));
});

test('agents-md: scaffoldAgentsMd keeps a brand target free of AGENTS.md, never destroying notes', () => {
  const dir = tmpdir();
  const result = engineResult();
  const { lines, logger } = recordingLogger();

  scaffoldAgentsMd({ outputDir: dir, standalone: false, result, logger });
  assert.equal(fs.existsSync(path.join(dir, 'AGENTS.md')), false, 'a brand target never gets one');

  fs.writeFileSync(path.join(dir, 'AGENTS.md'), oldTemplate(''));
  scaffoldAgentsMd({ outputDir: dir, standalone: false, result, logger });
  assert.deepEqual(result.removed, ['AGENTS.md']);
  assert.ok(lines.warn.some((m) => /Retired AGENTS\.md/.test(m)));

  fs.writeFileSync(path.join(dir, 'AGENTS.md'), oldTemplate('\nOur deploy needs the VPN up.\n'));
  scaffoldAgentsMd({ outputDir: dir, standalone: false, result, logger });
  assert.match(read(dir, 'AGENTS.md'), /VPN/);
  assert.ok(lines.warn.some((m) => m.includes('consumer content')), 'a move-it-to-the-brand-root warning prints');
  assert.ok(!lines.warn.join('\n').includes(EM_DASH), 'no em dash in the messages');
});

// ─── No CLAUDE.md: Claude Code reads AGENTS.md itself ────────────────────────

test('agents-md: the lib carries no CLAUDE.md pointer helper', () => {
  assert.deepEqual(Object.keys(agentsMd).filter((key) => /claude/i.test(key)), []);
});
