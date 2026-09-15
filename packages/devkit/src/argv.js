/**
 * The ONE argv parse behind every OMEGA CLI: node's `util.parseArgs` wearing
 * the yargs conveniences the bins and their commands still read
 * ([#920](https://github.com/Omega-JS-Stack/omega/issues/920)). yargs is gone;
 * this is what replaced it, in one place so the five CLIs can never drift.
 *
 * THE VALUE RULE, which is yargs' own: a flag named in `booleans` never takes a
 * value, and every OTHER flag takes the next token as its value when that token
 * exists and does not start with `-`, else it is `true`. `--flag=value` always
 * wins. So a CLI declares only what is value-LESS, and a flag nobody declared
 * still carries its value: the brand root forwards `omega test --filter foo` to
 * a target whose parse has never heard of `--filter`, and CI really runs
 * `sign-windows --in release --out release/signed`.
 *
 * What the builtin does NOT do, and what this adds back:
 *   1. THE VALUE RULE above. To `parseArgs` an undeclared flag is boolean, so
 *      the value of a space-separated `--only hosting` would fall through to
 *      `_`. The line is PRE-SCANNED to build the options map instead: every
 *      flag whose occurrence takes a value is declared a string, and parseArgs
 *      still does all the tokenizing.
 *   2. CAMEL TWINS. `parseArgs` gives `--dry-run` exactly one key, `dry-run`.
 *      Dozens of reads say `options.dryRun` (the manager alone has ~100) with
 *      no kebab fallback, and the manager's buildForwardedFlags skips a camel
 *      key whose kebab original exists. So every kebab flag lands under BOTH
 *      spellings, exactly as yargs minted them.
 *   3. NEGATION. `parseArgs` reads `--no-secrets` as a flag NAMED `no-secrets`.
 *      Every consumer tests the positive key against false (`argv.https !==
 *      false`, the deploy precheck's `secrets: false`), so `--no-<x>` sets
 *      `<x>` to false, never takes a value, and never survives under its own
 *      name.
 *   4. REPEATS. A repeated flag overwrites unless it is declared `multiple`,
 *      and an array of one is not what a single occurrence meant: the backend's
 *      `--where` accumulates into an array and one clause stays a string.
 *
 * Positionals come back at `_`, the key every consumer already reads. The
 * router owns `--help`/`--version`, so nothing here is reserved.
 *
 * Stdlib-only on purpose: a vendored module must not push a dependency onto
 * its hosts.
 */

const { parseArgs } = require('node:util');

/** `signed-dir` becomes `signedDir` (the twin yargs minted beside every kebab key). */
function camelCase(name) {
  return name.replace(/-([a-z0-9])/g, (match, character) => character.toUpperCase());
}

/**
 * The options map for THIS line: the declarations plus every flag the value
 * rule says carries a value. A clustered short (`-abc`) declares nothing and
 * stays boolean, and so does a `--no-<x>` negation.
 */
function declarationsFor(args, booleans, multiples) {
  const options = {};

  for (const name of booleans) options[name] = { type: 'boolean' };
  for (const name of multiples) options[name] = { type: 'string', multiple: true };

  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === '--') break;

    const flag = /^--([^-=][^=]*)(=)?/.exec(token) || /^-([^-])$/.exec(token);
    if (!flag) continue;

    const name = flag[1];
    if (options[name]) continue;

    // A negation is value-LESS (rule 3), so the token behind it is a positional
    // of its own and never the negation's value.
    if (name.startsWith('no-')) {
      options[name] = { type: 'boolean' };
      continue;
    }

    const next = args[index + 1];
    if (flag[2] || (next !== undefined && !next.startsWith('-'))) {
      options[name] = { type: 'string' };
    }
  }

  return options;
}

/**
 * Parse a CLI argv tail into the yargs-shaped options object the CLIs read.
 *
 * @param {string[]} args - The argv tail (`process.argv.slice(2)`).
 * @param {object} [declarations]
 * @param {string[]} [declarations.booleans] - Value-less flags (`--extended`), the only list a CLI owes
 * @param {string[]} [declarations.multiples] - Value flags that accumulate when repeated (`--where`).
 * @returns {object} `{ _: positionals, ...flags }`, each kebab flag under both spellings
 */
function parseArgv(args, declarations = {}) {
  const { booleans = [], multiples = [] } = declarations;
  const options = declarationsFor(args, booleans, multiples);

  const { values, positionals } = parseArgs({ args, options, strict: false, allowPositionals: true });
  const parsed = { _: positionals };

  for (const [key, raw] of Object.entries(values)) {
    // A repeated declaration always answers an array; one occurrence is one value.
    const value = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;

    // Negation names the POSITIVE flag. Last spelling wins, as it did under
    // yargs: `--secrets --no-secrets` ends false.
    const negated = key.startsWith('no-');
    const name = negated ? key.slice(3) : key;

    parsed[name] = negated ? false : value;
    if (name.includes('-')) parsed[camelCase(name)] = parsed[name];
  }

  return parsed;
}

module.exports = { parseArgv };
