/**
 * The verb registry: every row well-formed, every token meaning one verb per
 * CLI, and every CLI's own table covered, so a verb added to a CLI without a
 * registry row fails here. The CLIs are read from their real source files.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('fs');
const path = require('path');

const { VERBS, TARGET_ORDER, SCOPES, FANOUTS, tokensOf, findVerb } = require('../src/verbs.js');

const PACKAGES = path.join(__dirname, '..', '..');
const FIELDS = ['name', 'aliases', 'scope', 'owners', 'fanout', 'order', 'dryRun', 'readOnly', 'passThrough'];

/**
 * A router CLI's alias table, read from its source: the object literal after
 * `marker`, evaluated as the literal it is (comments and all).
 */
function aliasTable(expect, pkg, marker) {
  const source = fs.readFileSync(path.join(PACKAGES, pkg, 'src', 'cli.js'), 'utf8');
  const open = source.indexOf('{', source.indexOf(marker));
  expect(source.includes(marker) && open !== -1, `${pkg}/src/cli.js carries "${marker}"`).toBeTruthy();

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

/** A CLI's surface as { verb: aliases }: its alias table plus every command file. */
function withCommandFiles(pkg, table) {
  const surface = { help: [], ...table };
  for (const verb of commandFiles(pkg)) surface[verb] = surface[verb] || [];
  return surface;
}

/** A router CLI's surface, its alias table read from the literal after `marker`. */
function routerSurface(expect, pkg, marker) {
  return withCommandFiles(pkg, aliasTable(expect, pkg, marker));
}

const BACKEND_COMMANDS = require(path.join(PACKAGES, 'backend', 'src', 'cli', 'command-table.js')).COMMANDS;

/** Every CLI's surface by package name; `expect` is the calling case's. */
function clis(expect) {
  return {
    '@omega.js/manager': withCommandFiles('manager', require(path.join(PACKAGES, 'manager', 'src', 'cli.js')).config.aliases),
    '@omega.js/web': routerSurface(expect, 'web', 'const ALIASES ='),
    '@omega.js/desktop': routerSurface(expect, 'desktop', 'aliases: {'),
    '@omega.js/extension': routerSurface(expect, 'extension', 'aliases: {'),
    '@omega.js/backend': Object.fromEntries(BACKEND_COMMANDS.map((command) => [command.name, command.aliases || []])),
  };
}

module.exports = defineCases({
  type: 'group',
  description: 'verbs',
  tests: [
    {
      name: 'verbs: every row carries every field, each with an allowed value',
      run: (ctx) => {
        const CLIS = clis(ctx.expect);
        for (const entry of VERBS) {
          ctx.expect(Object.keys(entry).sort(), `${entry.name} carries exactly the registry fields`).toEqual([...FIELDS].sort());
          ctx.expect(typeof entry.name).toBe('string');
          ctx.expect(Array.isArray(entry.aliases), `${entry.name}.aliases is an array`).toBeTruthy();
          ctx.expect(SCOPES.includes(entry.scope), `${entry.name}.scope "${entry.scope}"`).toBeTruthy();
          ctx.expect(FANOUTS.includes(entry.fanout), `${entry.name}.fanout "${entry.fanout}"`).toBeTruthy();
          ctx.expect(entry.owners.length > 0, `${entry.name} has an owner`).toBeTruthy();
          for (const owner of entry.owners) ctx.expect(owner in CLIS, `${entry.name} owner ${owner} is one of the five CLIs`).toBeTruthy();
          // The one order constant, by reference: a per-row copy is the drift this table exists to stop
          ctx.expect(entry.order, `${entry.name}.order`).toBe(entry.fanout === 'each' ? TARGET_ORDER : null);
          ctx.expect(typeof entry.dryRun, `${entry.name}.dryRun`).toBe('boolean');
          ctx.expect(typeof entry.readOnly, `${entry.name}.readOnly`).toBe('boolean');
        }
      },
    },

    {
      name: 'verbs: names and aliases are unique, and the one shared token means one verb per CLI',
      run: (ctx) => {
        const CLIS = clis(ctx.expect);
        const names = VERBS.map((entry) => entry.name);
        ctx.expect(names, 'no name repeats').toEqual([...new Set(names)]);

        const aliases = VERBS.flatMap((entry) => entry.aliases);
        ctx.expect(aliases, 'no alias repeats').toEqual([...new Set(aliases)]);

        const rowsOf = (token) => VERBS.filter((entry) => tokensOf(entry).includes(token));
        const shared = [...new Set(VERBS.flatMap(tokensOf))].filter((token) => rowsOf(token).length > 1);
        ctx.expect(shared, 'serve (a dev alias AND the backend verb) is the only token two rows share').toEqual(['serve']);

        const [dev, serve] = rowsOf('serve');
        // A CLI owning both rows answers the token as the row that NAMES it, so its dev never lists it
        for (const owner of dev.owners.filter((owner) => serve.owners.includes(owner))) {
          ctx.expect((CLIS[owner].dev || []).includes('serve'), `${owner} answers serve as its own verb, never as dev`).toBe(false);
        }
        ctx.expect(findVerb('serve'), 'the row that NAMES a token answers it').toBe(serve);
      },
    },

    {
      name: 'verbs: every CLI\'s alias table and command set is a subset of the registry',
      run: (ctx) => {
        for (const [owner, surface] of Object.entries(clis(ctx.expect))) {
          for (const [verb, aliases] of Object.entries(surface)) {
            const entry = VERBS.find((row) => row.name === verb);
            ctx.expect(entry, `${owner} answers "${verb}", which has no registry row`).toBeTruthy();
            ctx.expect(entry.owners.includes(owner), `the "${verb}" row names ${owner} among its owners`).toBeTruthy();
            for (const alias of aliases) {
              ctx.expect(entry.aliases.includes(alias), `${owner}'s "${verb}" alias "${alias}" is in the registry row`).toBeTruthy();
            }
          }
        }
      },
    },

    {
      name: 'verbs: every owner a row names really answers that verb',
      run: (ctx) => {
        const CLIS = clis(ctx.expect);
        for (const entry of VERBS) {
          for (const owner of entry.owners) {
            ctx.expect(entry.name in CLIS[owner], `${owner} is listed as owning "${entry.name}" but its CLI has no such verb`).toBeTruthy();
          }
        }
      },
    },

    {
      name: 'verbs: status is contextless, the manager\'s alone, and runs once natively',
      run: (ctx) => {
        const row = findVerb('status');
        ctx.expect(row, 'the status row exists').toBeTruthy();
        ctx.expect({ scope: row.scope, owners: row.owners, fanout: row.fanout }).toEqual({ scope: 'contextless', owners: ['@omega.js/manager'], fanout: 'root' });
      },
    },

    {
      name: 'verbs: status says on its row that it reads only, and a verb that writes says it does not',
      run: (ctx) => {
        ctx.expect(findVerb('status').readOnly).toBe(true);
        for (const name of ['onboard', 'manage', 'deploy']) ctx.expect(findVerb(name).readOnly, name).toBe(false);
      },
    },

    {
      name: 'verbs: the dispatcher derives its contextless and box sets from the registry',
      run: (ctx) => {
        const { CONTEXTLESS_VERBS, BOX_VERBS } = require('../src/omega-bin.js');
        const contextless = VERBS.filter((entry) => entry.scope === 'contextless').flatMap(tokensOf);

        ctx.expect([...CONTEXTLESS_VERBS].sort()).toEqual(contextless.sort());
        ctx.expect([...BOX_VERBS].sort()).toEqual(['runner', 'sign-windows']);
      },
    },

    {
      name: 'verbs: the brand guide\'s verb table lists every root verb, and names no verb the registry lacks',
      run: (ctx) => {
        const guide = fs.readFileSync(path.join(PACKAGES, '..', 'docs', 'manager', 'brand.md'), 'utf8');
        const section = guide.slice(guide.indexOf('## Verbs'), guide.indexOf('\n## ', guide.indexOf('## Verbs') + 1));
        // The table's first column is the verb's name in a code span
        const documented = [...section.matchAll(/^\| `([^`]+)` \|/gm)].map(([, name]) => name);

        const root = VERBS.filter((entry) => entry.scope === 'root').map((entry) => entry.name);
        ctx.expect(root.filter((name) => !documented.includes(name)), 'every root verb has a row in docs/manager/brand.md § Verbs').toEqual([]);
        ctx.expect(documented.filter((name) => !root.includes(name)), 'every row there names a root verb of the registry').toEqual([]);
      },
    },
  ],
});
