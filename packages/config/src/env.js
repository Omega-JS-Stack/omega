/**
 * .env cascade — the secrets mirror of the omega.json5 hierarchy (D15).
 *
 * Weakest → strongest: company .env ← brand .env ← app .env ← shell.
 *
 * Same walk as the config cascade (load.js owns it): an app inside a brand
 * monorepo ({brand}/apps/{app}) layers the brand root's .env under its own,
 * and a brand stamped with .omega/company.json layers its company root's
 * .env underneath that. Loading uses dotenv's no-override semantics — keys
 * already in process.env (the shell) always win, and files apply
 * innermost-first, so app beats brand beats company.
 *
 * Secrets are DEFINED once at their source level (a brand-wide GH_TOKEN in
 * the brand .env, a company-wide key in the company .env) and RESOLVED here
 * at runtime/build. Only a target that physically ships an env file still
 * gets one materialized (functions/.env rides the Firebase deploy artifact —
 * omega-manager's disperse composes it from this same chain).
 */

const fs = require('node:fs');
const path = require('node:path');

const { findBrandRoot } = require('./load.js');
const { readCompanyRoot } = require('./company.js');

/**
 * Resolve the .env chain for a project dir, strongest file first.
 *
 * `startDir` is the dir whose .env is the app layer — the project root for
 * web/desktop/extension, the functions dir for a backend (its .env rides
 * the deploy artifact). Brand discovery normalizes an app subdir (functions/,
 * dist/) → app root, same as the config loader.
 *
 * @param {string} startDir
 * @returns {{ app: string, brand: string|null, company: string|null }}
 *   Absolute .env paths (existence not checked here).
 */
function resolveEnvChain(startDir) {
  const appDir = path.resolve(startDir);
  const brandRoot = findBrandRoot(appDir);
  // The marker sits at the brand root; when startDir IS a brand root (no
  // apps/ walk above it), its own marker supplies the company layer.
  const companyRoot = readCompanyRoot(brandRoot || appDir);

  return {
    app: path.join(appDir, '.env'),
    brand: brandRoot ? path.join(brandRoot, '.env') : null,
    company: companyRoot ? path.join(companyRoot, '.env') : null,
  };
}

/**
 * Load an ordered list of .env files (strongest first) with dotenv's
 * no-override semantics: keys already in process.env (the shell, or a
 * stronger file) always win, so load order = precedence. Null/missing
 * entries skip silently.
 *
 * One rule on top of plain dotenv (dogfood friction #20): a file layer's
 * EMPTY value (`KEY=` / `KEY=""`) never claims the key — empty means
 * "documented here, value supplied by another layer", so a scaffolded
 * app .env full of placeholders can't shadow the brand root's real
 * values. Only the shell can deliberately set a key to empty.
 *
 * @param {Array<string|null>} envPaths
 * @returns {string[]} The files that existed and were loaded.
 */
function loadEnvChain(envPaths) {
  const loaded = [];

  for (const envPath of envPaths) {
    if (!envPath || !fs.existsSync(envPath)) continue;

    const parsed = require('dotenv').parse(fs.readFileSync(envPath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (value === '' || key in process.env) continue;
      process.env[key] = value;
    }

    loaded.push(envPath);
  }

  return loaded;
}

/**
 * Resolve + load the full .env cascade for a project dir:
 * shell > app .env > brand .env > company .env.
 *
 * @param {string} startDir - See resolveEnvChain.
 * @returns {{ chain: { app: string, brand: string|null, company: string|null }, loaded: string[] }}
 */
function loadEnv(startDir) {
  const chain = resolveEnvChain(startDir);
  const loaded = loadEnvChain([chain.app, chain.brand, chain.company]);
  return { chain, loaded };
}

module.exports = { loadEnv, resolveEnvChain, loadEnvChain };
