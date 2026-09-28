/**
 * The verb registry: every row well-formed, every token meaning one verb per
 * CLI, and every CLI's own table covered, so a verb added to a CLI without a
 * registry row fails here. The CLIs are read from their real source files.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { VERBS, TARGET_ORDER, SCOPES, FANOUTS, tokensOf, findVerb } = require('../src/verbs.js');

const PACKAGES = path.join(__dirname, '..', '..');
const FIELDS = ['name', 'aliases', 'scope', 'owners', 'fanout', 'order', 'dryRun'];

/**
 * A router CLI's alias table, read from its source: the object literal after
 * `marker`, evaluated as the literal it is (comments and all).
 */
function aliasTable(pkg, marker) {
  const source = fs.readFileSync(path.join(PACKAGES, pkg, 'src', 'cli.js'), 'utf8');
  const open = source.indexOf('{', source.indexOf(marker));
  assert.ok(source.includes(marker) && open !== -1, `${pkg}/src/cli.js carries "${marker}"`);

  let depth = 0;
  let close = open;
  for (; close < source.length; close++) {
    if (source[close] === '{') depth++;
    if (source[close] === '}' && --depth === 0) break;
  }
  return new Function(`return (${source.slice(open, close + 1)});`)();
}

/** The verbs a router CLI's commands/ directory answers to, one per file. */
function commandFiles(pkg) {
  return fs.readdirSync(path.join(PACKAGES, pkg, 'src', 'commands'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => file.slice(0, -3));
}

/** Each CLI's surface as { verb: aliases }: the alias table plus every command file. */
function routerSurface(pkg, marker) {
  const table = aliasTable(pkg, marker);
  const surface = { help: [], ...table };
  for (const verb of commandFiles(pkg)) surface[verb] = surface[verb] || [];
  return surface;
}

const BACKEND_COMMANDS = require(path.join(PACKAGES, 'backend', 'src', 'cli', 'command-table.js')).COMMANDS;

const CLIS = {
  '@omega.js/manager': routerSurface('manager', 'const ALIASES ='),
  '@omega.js/web': routerSurface('web', 'const ALIASES ='),
  '@omega.js/desktop': routerSurface('desktop', 'aliases: {'),
  '@omega.js/extension': routerSurface('extension', 'aliases: {'),
  '@omega.js/backend': Object.fromEntries(BACKEND_COMMANDS.map((command) => [command.name, command.aliases || []])),
};

test('verbs: every row carries every field, each with an allowed value', () => {
  for (const entry of VERBS) {
    assert.deepEqual(Object.keys(entry).sort(), [...FIELDS].sort(), `${entry.name} carries exactly the registry fields`);
    assert.equal(typeof entry.name, 'string');
    assert.ok(Array.isArray(entry.aliases), `${entry.name}.aliases is an array`);
    assert.ok(SCOPES.includes(entry.scope), `${entry.name}.scope "${entry.scope}"`);
    assert.ok(FANOUTS.includes(entry.fanout), `${entry.name}.fanout "${entry.fanout}"`);
    assert.ok(entry.owners.length > 0, `${entry.name} has an owner`);
    for (const owner of entry.owners) assert.ok(owner in CLIS, `${entry.name} owner ${owner} is one of the five CLIs`);
    // The one order constant, by reference: a per-row copy is the drift this table exists to stop
    assert.equal(entry.order, entry.fanout === 'each' ? TARGET_ORDER : null, `${entry.name}.order`);
    assert.equal(typeof entry.dryRun, 'boolean', `${entry.name}.dryRun`);
  }
});

test('verbs: names and aliases are unique, and the one shared token means one verb per CLI', () => {
  const names = VERBS.map((entry) => entry.name);
  assert.deepEqual(names, [...new Set(names)], 'no name repeats');

  const aliases = VERBS.flatMap((entry) => entry.aliases);
  assert.deepEqual(aliases, [...new Set(aliases)], 'no alias repeats');

  const rowsOf = (token) => VERBS.filter((entry) => tokensOf(entry).includes(token));
  const shared = [...new Set(VERBS.flatMap(tokensOf))].filter((token) => rowsOf(token).length > 1);
  assert.deepEqual(shared, ['serve'], 'serve (a dev alias AND the backend verb) is the only token two rows share');

  const [dev, serve] = rowsOf('serve');
  // A CLI owning both rows answers the token as the row that NAMES it, so its dev never lists it
  for (const owner of dev.owners.filter((owner) => serve.owners.includes(owner))) {
    assert.equal((CLIS[owner].dev || []).includes('serve'), false, `${owner} answers serve as its own verb, never as dev`);
  }
  assert.equal(findVerb('serve'), serve, 'the row that NAMES a token answers it');
});

test('verbs: every CLI\'s alias table and command set is a subset of the registry', () => {
  for (const [owner, surface] of Object.entries(CLIS)) {
    for (const [verb, aliases] of Object.entries(surface)) {
      const entry = VERBS.find((row) => row.name === verb);
      assert.ok(entry, `${owner} answers "${verb}", which has no registry row`);
      assert.ok(entry.owners.includes(owner), `the "${verb}" row names ${owner} among its owners`);
      for (const alias of aliases) {
        assert.ok(entry.aliases.includes(alias), `${owner}'s "${verb}" alias "${alias}" is in the registry row`);
      }
    }
  }
});

test('verbs: every owner a row names really answers that verb', () => {
  for (const entry of VERBS) {
    for (const owner of entry.owners) {
      assert.ok(entry.name in CLIS[owner], `${owner} is listed as owning "${entry.name}" but its CLI has no such verb`);
    }
  }
});

test('verbs: the dispatcher derives its contextless and box sets from the registry', () => {
  const { CONTEXTLESS_VERBS, BOX_VERBS } = require('../src/omega-bin.js');
  const contextless = VERBS.filter((entry) => entry.scope === 'contextless').flatMap(tokensOf);

  assert.deepEqual([...CONTEXTLESS_VERBS].sort(), contextless.sort());
  assert.deepEqual([...BOX_VERBS].sort(), ['runner', 'sign-windows']);
});

test('verbs: the brand guide\'s verb table lists every root verb, and names no verb the registry lacks', () => {
  const guide = fs.readFileSync(path.join(PACKAGES, '..', 'docs', 'manager', 'brand.md'), 'utf8');
  const section = guide.slice(guide.indexOf('## Verbs'), guide.indexOf('\n## ', guide.indexOf('## Verbs') + 1));
  // The table's first column is the verb's name in a code span
  const documented = [...section.matchAll(/^\| `([^`]+)` \|/gm)].map(([, name]) => name);

  const root = VERBS.filter((entry) => entry.scope === 'root').map((entry) => entry.name);
  assert.deepEqual(root.filter((name) => !documented.includes(name)), [], 'every root verb has a row in docs/manager/brand.md § Verbs');
  assert.deepEqual(documented.filter((name) => !root.includes(name)), [], 'every row there names a root verb of the registry');
});
