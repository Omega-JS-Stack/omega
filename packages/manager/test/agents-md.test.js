// Tests for src/lib/agents-md.js + the workspace `agents` ensure op — the
// brand agent-docs chain (Ian 2026-07-20, amended 2026-07-27): AGENTS.md
// line 1 imports the TOP-LEVEL omega AGENTS.md through the scope path
// `node_modules/@omega.js/AGENTS.md` (a symlink this service maintains),
// CLAUDE.md is the one-line `@AGENTS.md` pointer. Create / present / heal
// are idempotent, consumer content survives every path, content-bearing
// CLAUDE.md warns (never clobbered), and no package ships agent docs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  IMPORT_LINE,
  LEGACY_GUIDE_SUBPATH,
  LEGACY_MARKER_PREFIX,
  CLAUDE_POINTER,
  ensureAgentsMd,
  ensureClaudePointer,
  ensureGuideLink,
} = require('../src/lib/agents-md.js');
const agentsOp = require('../src/services/workspace/ensure/agents.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-agents-md-'));
}

function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

// ─── The map is the target — no package ships agent docs ─────────────────────

test('agents-md: no package agent docs — the top-level map is the one entry', () => {
  const pkgRoot = path.join(__dirname, '..');
  assert.ok(!fs.existsSync(path.join(pkgRoot, 'AGENTS.md')), 'packages/manager must carry NO AGENTS.md (Ian 2026-07-27)');

  const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
  assert.ok(!pkg.files.includes('AGENTS.md'), 'files whitelist must not ship AGENTS.md');

  assert.ok(fs.existsSync(path.join(pkgRoot, '..', '..', 'AGENTS.md')), 'the top-level AGENTS.md map must exist — it is the import target');
});

test('agents-md: the import line is the scope path to the top-level map', () => {
  assert.equal(IMPORT_LINE, '@node_modules/@omega.js/AGENTS.md');
  assert.ok(!IMPORT_LINE.includes('/Users/'), 'never an absolute machine path');
});

test('agents-md: resolveImportLine walks up to a hoisted install and falls back to canonical', () => {
  const { resolveImportLine, GUIDE_SUBPATH } = require('../src/lib/agents-md.js');
  const root = tmpdir();

  // Nothing installed anywhere → canonical brand-local path
  const brand = path.join(root, 'apps', 'my-brand');
  fs.mkdirSync(brand, { recursive: true });
  assert.equal(resolveImportLine(brand), IMPORT_LINE);

  // Hoisted two levels up (in-repo brand shape) → upward relative path
  fs.mkdirSync(path.join(root, 'node_modules', '@omega.js'), { recursive: true });
  assert.equal(resolveImportLine(brand), `@../../${GUIDE_SUBPATH}`);

  // Brand-local install wins over the hoisted one
  fs.mkdirSync(path.join(brand, 'node_modules', '@omega.js'), { recursive: true });
  assert.equal(resolveImportLine(brand), IMPORT_LINE);
});

test('agents-md: a legacy manager-package import heals to the scope path', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `@${LEGACY_GUIDE_SUBPATH}\n\n# Notes survive\n`);

  assert.equal(ensureAgentsMd(dir, 'X'), 'healed');
  const lines = read(dir, 'AGENTS.md').split('\n');
  assert.equal(lines[0], IMPORT_LINE, 'the legacy manager-package target rewritten to the scope path');
  assert.ok(!read(dir, 'AGENTS.md').includes(LEGACY_GUIDE_SUBPATH), 'no legacy target remains');
  assert.match(read(dir, 'AGENTS.md'), /# Notes survive/);
});

// ─── ensureGuideLink ─────────────────────────────────────────────────────────

// A fixture consumer: a fake monorepo (top-level AGENTS.md + packages/manager)
// and a brand whose node_modules/@omega.js/manager symlinks into it — the
// local-era file: shape.
function linkFixture() {
  const root = tmpdir();
  const monorepo = path.join(root, 'omega');
  fs.mkdirSync(path.join(monorepo, 'packages', 'manager'), { recursive: true });
  fs.writeFileSync(path.join(monorepo, 'AGENTS.md'), '# the map\n');

  const brand = path.join(root, 'brand');
  fs.mkdirSync(path.join(brand, 'node_modules', '@omega.js'), { recursive: true });
  fs.symlinkSync(path.join(monorepo, 'packages', 'manager'), path.join(brand, 'node_modules', '@omega.js', 'manager'));
  return { monorepo, brand };
}

test('agents-md: ensureGuideLink links the scope AGENTS.md at the top-level map, idempotently', () => {
  const { monorepo, brand } = linkFixture();

  assert.equal(ensureGuideLink(brand), 'created');
  const link = path.join(brand, 'node_modules', '@omega.js', 'AGENTS.md');
  assert.equal(fs.readFileSync(link, 'utf8'), '# the map\n', 'the link resolves to the live map');
  assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(monorepo, 'AGENTS.md')));

  assert.equal(ensureGuideLink(brand), 'present');
});

test('agents-md: ensureGuideLink replaces a stale regular file and skips when nothing resolves', () => {
  const { brand } = linkFixture();
  const link = path.join(brand, 'node_modules', '@omega.js', 'AGENTS.md');
  fs.writeFileSync(link, 'stale copy\n');

  assert.equal(ensureGuideLink(brand), 'healed');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'the stale copy became the live link');

  const bare = tmpdir();
  assert.equal(ensureGuideLink(bare), 'skipped', 'no scope directory → skipped');
});

test('agents-md: a stale-depth import line is healed to the resolved path', () => {
  const { GUIDE_SUBPATH } = require('../src/lib/agents-md.js');
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `@../../${GUIDE_SUBPATH}\n\n# Notes survive\n`);

  assert.equal(ensureAgentsMd(dir, 'X'), 'healed');
  const lines = read(dir, 'AGENTS.md').split('\n');
  assert.equal(lines[0], IMPORT_LINE, 'stale ../../ depth rewritten to the resolved (canonical) path');
  assert.equal(lines.filter((line) => line.trim().endsWith(GUIDE_SUBPATH)).length, 1);
  assert.match(read(dir, 'AGENTS.md'), /# Notes survive/);
});

// ─── ensureAgentsMd ──────────────────────────────────────────────────────────

test('agents-md: missing AGENTS.md is created — import first, then a short brand-notes heading (Ian: keep it short)', () => {
  const dir = tmpdir();
  assert.equal(ensureAgentsMd(dir, 'Fixture Brand'), 'created');

  const lines = read(dir, 'AGENTS.md').split('\n');
  assert.equal(lines[0], IMPORT_LINE);
  assert.equal(lines[1], '');
  assert.equal(lines[2], '# Fixture Brand — brand notes');
  assert.ok(!read(dir, 'AGENTS.md').includes('<!--'), 'no marker comment (culled 2026-07-20)');

  assert.equal(ensureAgentsMd(dir, 'Fixture Brand'), 'present');
});

test('agents-md: a correct import with a legacy marker below still heals (present requires cruft-free)', () => {
  const dir = tmpdir();
  const legacyMarker = `${LEGACY_MARKER_PREFIX} … -->`;
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `${IMPORT_LINE}\n${legacyMarker}\n\n# Notes\n`);

  assert.equal(ensureAgentsMd(dir, 'X'), 'healed');
  const content = read(dir, 'AGENTS.md');
  assert.ok(!content.includes('<!--'));
  assert.equal(ensureAgentsMd(dir, 'X'), 'present');
});

test('agents-md: healing scrubs the legacy cp244 marker comment', () => {
  const dir = tmpdir();
  const legacyMarker = `${LEGACY_MARKER_PREFIX} — maintained by \`npm start\`; keep this import first. -->`;
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `@../../${IMPORT_LINE.slice(1)}\n${legacyMarker}\n\n# Notes survive\n`);

  assert.equal(ensureAgentsMd(dir, 'X'), 'healed');
  const content = read(dir, 'AGENTS.md');
  assert.equal(content.split('\n')[0], IMPORT_LINE);
  assert.ok(!content.includes('<!--'), 'legacy marker gone');
  assert.match(content, /# Notes survive/);
});

test('agents-md: existing file without the import is healed in place — content preserved, import at line 1', () => {
  const dir = tmpdir();
  const consumer = '# My brand\n\nHand-written notes that must survive.\n';
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), consumer);

  assert.equal(ensureAgentsMd(dir, 'X'), 'healed');
  const content = read(dir, 'AGENTS.md');
  assert.equal(content.split('\n')[0], IMPORT_LINE);
  assert.match(content, /Hand-written notes that must survive\./);

  // Idempotent: a second run is a no-op
  assert.equal(ensureAgentsMd(dir, 'X'), 'present');
  assert.equal(read(dir, 'AGENTS.md'), content);
});

test('agents-md: healing removes a stray mid-file copy of the import — no duplicates ever', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# Notes\n\n${IMPORT_LINE}\n\nMore notes.\n`);

  assert.equal(ensureAgentsMd(dir, 'X'), 'healed');
  const content = read(dir, 'AGENTS.md');
  const importCount = content.split('\n').filter((line) => line.trim() === IMPORT_LINE).length;
  assert.equal(importCount, 1);
  assert.equal(content.split('\n')[0], IMPORT_LINE);
  assert.match(content, /More notes\./);
});

// ─── ensureClaudePointer ─────────────────────────────────────────────────────

test('agents-md: missing CLAUDE.md is created as the one-line pointer; pointer-bearing is present', () => {
  const dir = tmpdir();
  assert.equal(ensureClaudePointer(dir), 'created');
  assert.equal(read(dir, 'CLAUDE.md'), `${CLAUDE_POINTER}\n`);
  assert.equal(ensureClaudePointer(dir), 'present');
});

test('agents-md: content-bearing CLAUDE.md is NEVER clobbered — reported for the move-it warning', () => {
  const dir = tmpdir();
  const content = '# Real content someone wrote\n\nRules live here.\n';
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), content);

  assert.equal(ensureClaudePointer(dir), 'content-bearing');
  assert.equal(read(dir, 'CLAUDE.md'), content);
});

// ─── The workspace ensure op ─────────────────────────────────────────────────

test('agents-md: op creates both files on a fresh brand and is a no-op second run', async () => {
  const dir = tmpdir();
  const context = { brandRoot: dir, brand: { id: 'fixture', config: { brand: { name: 'Fixture' } } } };

  const first = await agentsOp(context);
  assert.deepEqual(first.output, { guide: 'skipped', agents: 'created', claude: 'created' });
  assert.equal(read(dir, 'AGENTS.md').split('\n')[0], IMPORT_LINE);
  assert.equal(read(dir, 'CLAUDE.md'), `${CLAUDE_POINTER}\n`);

  assert.equal(await agentsOp(context), null);
});

test('agents-md: op warns (status warned) on a content-bearing CLAUDE.md', async () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# content\n');

  const result = await agentsOp({ brandRoot: dir, brand: { id: 'fixture', config: {} } });
  assert.equal(result.status, 'warned');
  assert.equal(result.output.claude, 'content-bearing');
});
