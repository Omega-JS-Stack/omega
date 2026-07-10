/**
 * omega-bin — the context-aware dispatcher behind every framework's `omega`/`omg` bin.
 *
 * Problem: every OMEGA framework ships the same bin names (`omega`, `omg`, `mgr`).
 * In a brand monorepo with several apps, npm hoists all of them to the brand root
 * and only ONE framework's file wins the node_modules/.bin link — so the bin that
 * actually runs is arbitrary. This module makes any winner correct: it resolves
 * which framework owns the CALLER'S app (nearest package.json walking up from cwd,
 * including the backend's functions/ layout) and runs THAT framework's CLI.
 *
 * Contract: every framework exposes `exports['./cli']` → a module with `run()`
 * that parses process.argv itself, and a bin shim that calls
 * `run({ hostName, hostRun })` — hostRun executes the host's own CLI via a
 * RELATIVE require (vendor-safe), so the host never resolves itself by name.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const FRAMEWORKS = [
  '@omega.js/web',
  '@omega.js/backend',
  '@omega.js/desktop',
  '@omega.js/extension',
];

function readPackage(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

function frameworkOf(pkg) {
  if (!pkg) return null;
  const declared = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
  return FRAMEWORKS.find((name) => declared[name]) || null;
}

/**
 * Walk up from startDir to the nearest package.json that declares an OMEGA
 * framework. Backend consumers declare @omega.js/backend in functions/package.json,
 * so each level also peeks one directory DOWN into functions/.
 *
 * @returns {{ name: string, dir: string } | null} dir = where the dep is declared
 */
function findTargetFramework(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    const own = frameworkOf(readPackage(dir));
    if (own) return { name: own, dir };

    const fnDir = path.join(dir, 'functions');
    if (frameworkOf(readPackage(fnDir)) === '@omega.js/backend') {
      return { name: '@omega.js/backend', dir: fnDir };
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function run({ hostName, hostRun }) {
  const target = findTargetFramework(process.cwd());

  // No app context — the bootstrap case (`omega setup` in a fresh directory has
  // no framework dep yet, by definition). Run the HOST framework's CLI, exactly
  // like the pre-dispatcher bins did, and say which one so a hoist-winner at a
  // brand root is never a silent mystery.
  if (!target) {
    console.error(`omega: no app context found from ${process.cwd()} — running ${hostName}`);
    return hostRun();
  }

  // The bin that won npm's .bin link belongs to this app's framework — run it directly.
  if (target.name === hostName) {
    return hostRun();
  }

  // The app belongs to a DIFFERENT framework — resolve its CLI from where the
  // dependency is declared and hand over.
  const req = createRequire(path.join(target.dir, 'package.json'));
  let cliPath;
  try {
    cliPath = req.resolve(`${target.name}/cli`);
  } catch (e) {
    console.error(`omega: found ${target.name} (declared in ${target.dir}) but could not resolve '${target.name}/cli': ${e.message}`);
    console.error('Is the framework installed? Try npm install, or `mgr i local` for a monorepo link.');
    process.exit(1);
  }
  return require(cliPath).run();
}

module.exports = { run, findTargetFramework, FRAMEWORKS };
