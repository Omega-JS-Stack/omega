// Tests for the workspace `agents` ensure op, the brand agent-docs chain: the
// op writes the brand root through devkit's one AGENTS.md builder (its own
// cases: packages/devkit/test/agents-md.test.js), so its Default section imports
// the installed manager's AGENTS.md, which imports the omega map from the docs the
// manager ships. The retired scope link is removed and a CLAUDE.md is never
// written or read. A linked brand's full chain is proved with devkit's
// docs-sync prelude, which keeps a linked manager's docs current.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The brand root shape, written out: the import under Default, an empty Custom section.
const BRAND_AGENTS_MD = '<!-- ========== Default Values ========== -->\n@node_modules/@omega.js/manager/AGENTS.md\n\n<!-- ========== Custom Values ========== -->\n';
const agentsOp = require('../src/services/workspace/ensure/agents.js');
const { MAP_FILE } = require('../../devkit/tools/vendor-docs.js');
const docsSync = require('../../devkit/src/preludes/docs-sync.js');

const PKG_ROOT = path.join(__dirname, '..');
const MONOREPO = path.join(PKG_ROOT, '..', '..');
const MAP_IMPORT = `@${MAP_FILE.split(path.sep).join('/')}`;

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-agents-md-'));
}

function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

// Follow each file's first `@` import line, relative to that file, the way
// Claude Code does; returns the files read, in order.
function followChain(file) {
  const chain = [file];
  for (let hops = 0; hops < 5; hops += 1) {
    const found = fs.readFileSync(chain.at(-1), 'utf8').split('\n').find((line) => line.trim().startsWith('@'));
    if (!found) break;
    chain.push(path.join(path.dirname(chain.at(-1)), found.trim().slice(1)));
  }
  return chain;
}

// A locally linked brand: a fake monorepo (docs/ with the map, the manager's
// tracked AGENTS.md, the REAL devkit linked in so its docs lane runs) and a
// brand whose node_modules/@omega.js/manager symlinks into it.
function linkFixture() {
  const root = tmpdir();
  const monorepo = path.join(root, 'omega');
  const manager = path.join(monorepo, 'packages', 'manager');
  fs.mkdirSync(path.join(monorepo, 'docs', 'shared'), { recursive: true });
  fs.mkdirSync(manager, { recursive: true });
  fs.writeFileSync(path.join(monorepo, 'package.json'), JSON.stringify({ name: 'omega' }));
  fs.writeFileSync(path.join(manager, 'package.json'), JSON.stringify({ name: '@omega.js/manager' }));
  fs.symlinkSync(path.join(MONOREPO, 'packages', 'devkit'), path.join(monorepo, 'packages', 'devkit'));
  fs.writeFileSync(path.join(monorepo, MAP_FILE), '# the map\n');
  fs.writeFileSync(path.join(monorepo, 'docs', 'shared', 'config.md'), '# config\n');
  fs.copyFileSync(path.join(PKG_ROOT, 'AGENTS.md'), path.join(manager, 'AGENTS.md'));

  const brand = path.join(root, 'brand');
  fs.mkdirSync(path.join(brand, 'node_modules', '@omega.js'), { recursive: true });
  fs.symlinkSync(manager, path.join(brand, 'node_modules', '@omega.js', 'manager'));
  return { monorepo, manager, brand };
}

// A published brand: a REAL manager package directory (no monorepo above it)
// carrying the docs its prepare lane vendored.
function publishedFixture() {
  const brand = tmpdir();
  const manager = path.join(brand, 'node_modules', '@omega.js', 'manager');
  fs.mkdirSync(path.join(manager, 'docs'), { recursive: true });
  return { brand, manager };
}

// ─── The manager's AGENTS.md: one tracked import of the map ─────────────────

test('agents-md: the manager ships a one-line AGENTS.md importing the map inside its docs', () => {
  assert.equal(read(PKG_ROOT, 'AGENTS.md'), `${MAP_IMPORT}\n`);
  const pkg = JSON.parse(read(PKG_ROOT, 'package.json'));
  assert.ok(pkg.files.includes('AGENTS.md'), 'the files list ships it');
  assert.ok(fs.existsSync(path.join(MONOREPO, MAP_FILE)), 'the map it imports exists in the monorepo docs');
  assert.equal(read(MONOREPO, 'AGENTS.md').split('\n')[0], MAP_IMPORT, 'the root AGENTS.md opens with the same map');
});

// ─── The whole chain on a linked brand ──────────────────────────────────────

test('agents-md: a linked brand resolves the two-import chain (three files) to the live map', async () => {
  const { brand, monorepo } = linkFixture();
  fs.symlinkSync(path.join(monorepo, 'AGENTS.md'), path.join(brand, 'node_modules', '@omega.js', 'AGENTS.md'));

  assert.equal(docsSync.run({ brandRoot: brand, log: () => {} }).synced, true);
  const result = await agentsOp({ brandRoot: brand, brand: { id: 'fixture', config: {} } });
  assert.deepEqual(result.output, { link: 'removed', agents: 'created' });

  const chain = followChain(path.join(brand, 'AGENTS.md'));
  assert.equal(chain.length, 3, 'brand AGENTS.md, then the manager\'s, then the map');
  assert.equal(fs.readFileSync(chain[2], 'utf8'), '# the map\n');
  assert.equal(await agentsOp({ brandRoot: brand, brand: { id: 'fixture', config: {} } }), null, 'a second run is a no-op');
});

// ─── The workspace ensure op ─────────────────────────────────────────────────

test('agents-md: op creates AGENTS.md and no CLAUDE.md on a fresh brand, then is a no-op', async () => {
  const dir = tmpdir();
  const context = { brandRoot: dir, brand: { id: 'fixture', config: { brand: { name: 'Fixture' } } } };

  const first = await agentsOp(context);
  assert.deepEqual(first.output, { link: 'absent', agents: 'created' });
  assert.equal(read(dir, 'AGENTS.md'), BRAND_AGENTS_MD, 'the builder\'s file, no generated heading');
  assert.equal(fs.existsSync(path.join(dir, 'CLAUDE.md')), false, 'a manage run writes no CLAUDE.md');

  assert.equal(await agentsOp(context), null);
});

test('agents-md: op leaves an existing CLAUDE.md alone, content or pointer, with no warning', async () => {
  for (const content of ['# content\n', '@AGENTS.md\n']) {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), BRAND_AGENTS_MD);
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), content);

    assert.equal(await agentsOp({ brandRoot: dir, brand: { id: 'fixture', config: {} } }), null);
    assert.equal(read(dir, 'CLAUDE.md'), content);
  }
});

test('agents-md: op under --dry-run plans the link removal and AGENTS.md, and writes nothing', async () => {
  const { brand, monorepo } = linkFixture();
  const link = path.join(brand, 'node_modules', '@omega.js', 'AGENTS.md');
  fs.symlinkSync(path.join(monorepo, 'AGENTS.md'), link);

  const planned = await agentsOp({ brandRoot: brand, brand: { id: 'fixture', config: {} }, options: { dryRun: true } });

  assert.deepEqual(planned.output, { link: 'planned', agents: 'planned' });
  assert.deepEqual(fs.readdirSync(brand), ['node_modules']);
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'the retired link is still there');
});
