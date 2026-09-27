/**
 * The `.env` pass of `omega migrate`: the brand root's `.env` and its
 * environment overlays, then each target's own, the files the loader reads.
 * Lines name keys only: a value never reaches the report.
 */
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const { ENV_ENVIRONMENTS } = require('@omega.js/config');
const { findRetiredEnvKeys } = require('./retired-env.js');

/**
 * Every `.env` file of the brand that exists: the brand root's and its
 * overlays, then each discovered target's and its overlays.
 * @param {string} brandRoot
 * @param {Array<object>} targets - discoverTargets entries.
 * @returns {string[]}
 */
function envFiles(brandRoot, targets) {
  const layer = (dir) => ['.env', ...ENV_ENVIRONMENTS.map((environment) => `.env.${environment}`)]
    .map((name) => path.join(dir, name))
    .filter((file) => fs.existsSync(file));

  return [...layer(brandRoot), ...targets.flatMap((entry) => layer(entry.path))];
}

/**
 * The pass over one `.env` file. A key renamed inside .env is renamed in place
 * under `execute` (the value's bytes untouched); a value that moved into
 * config, or a key retired outright, is a by-hand step.
 * @param {string} envPath
 * @param {boolean} execute
 * @returns {{ due: string[], changed: string[], errors: string[] }}
 */
function migrateEnv(envPath, execute) {
  const source = fs.readFileSync(envPath, 'utf8');
  const present = dotenv.parse(source);
  const result = { due: [], changed: [], errors: [] };
  let written = source;

  for (const { key, replacement, why, home } of findRetiredEnvKeys(present)) {
    if (!replacement) {
      result.due.push(`delete ${key} by hand: retired outright, nothing replaces it (${why})`);
      continue;
    }

    if (home !== 'env') {
      result.due.push(`move ${key} → ${replacement} in config/omega.json5 by hand, then delete the .env line: ${why}`);
      continue;
    }

    // Two lines for one name would let dotenv's last-wins pick the value
    if (replacement in present) {
      result.errors.push(`refused ${key} → ${replacement}: ${replacement} is already in this file; keep one of the two lines by hand, then run \`omega migrate --execute\` again`);
      continue;
    }

    if (!execute) {
      result.due.push(`rename ${key} → ${replacement} (the value stays): ${why}`);
      continue;
    }

    const renamed = renameEnvKey(written, key, replacement);
    if (renamed === written) {
      result.errors.push(`refused ${key} → ${replacement}: no line in this file spells it in a form the rename can find; rename it by hand`);
      continue;
    }

    written = renamed;
    result.changed.push(`renamed ${key} → ${replacement} in place, value untouched: ${why}`);
  }

  if (written !== source) fs.writeFileSync(envPath, written);

  return result;
}

/**
 * Rename every line that assigns `key`, in either spelling dotenv reads
 * (`KEY=value`, `KEY: value`, optionally `export`-prefixed); values untouched.
 * @param {string} source - The file's text.
 * @param {string} key
 * @param {string} replacement
 * @returns {string} The text, unchanged when no line assigns `key`.
 */
function renameEnvKey(source, key, replacement) {
  return source.replace(new RegExp(`^(\\s*(?:export\\s+)?)${key}(?=\\s*(?:=|:))`, 'gm'), `$1${replacement}`);
}

module.exports = { envFiles, migrateEnv, renameEnvKey };
