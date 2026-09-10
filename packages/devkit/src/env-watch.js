/**
 * env-watch — the `.env` chain as a WATCH INPUT for the dev lanes
 * ([#681](https://github.com/Omega-JS-Stack/omega/issues/681)).
 *
 * The backend's stage watch has treated the cascade as an input since #678: an
 * edit to the brand root's `.env` re-stages `dist/.env` and the running
 * emulator picks it up (`envWatchInputs`,
 * packages/backend/src/cli/utils/stage-functions.js). Web, desktop and
 * extension read the cascade once at CLI/gulp boot and never noticed an edit —
 * one target live-reloaded env, three did not. This is that same resolution for
 * the three process.env lanes.
 *
 * Every layer of the chain is watched — company ← brand ← target — and each
 * layer is TWO files, its `.env` and the `.env.<environment>` overlay that wins
 * over it (#586), exactly the set `loadEnv` reads. DIRECTORIES are watched, not
 * the files: an editor's save replaces the inode (a file watch does not survive
 * it), and a layer's `.env` may not exist yet.
 *
 * Values NEVER reach a log line — a `.env` is all secrets, so the one line a
 * reload prints names the FILE that changed.
 */

const fs = require('node:fs');
const path = require('node:path');
const { resolveEnvChain, envLayerFiles, envEnvironment, reloadEnv } = require('@omega.js/config');

// Long enough to collapse an editor's save burst into one reload — the same
// settle the other dev watchers use.
const DEBOUNCE_MS = 250;

/**
 * The `.env` files a dev watcher treats as inputs, weakest layer first: each
 * layer of the chain and the `.env.<environment>` overlay that wins over it.
 * Existence is not checked here — a layer's file can appear mid-session.
 *
 * Named for the CHAIN it resolves, because the backend's stage watch has its
 * own `envWatchInputs` (stage-functions.js) with a different contract — brand
 * and company only, no overlays, no target layer
 * ([#723](https://github.com/Omega-JS-Stack/omega/issues/723)).
 *
 * @param {string} projectDir - The target root (its .env is the local layer).
 * @param {object} [options]
 * @param {string} [options.environment] - The environment whose overlay counts
 *   (defaults to the running one, the same answer loadEnv resolves).
 * @returns {Array<{ layer: 'company'|'brand'|'target', path: string }>} Absolute paths.
 */
function envChainWatchInputs(projectDir, { environment = envEnvironment() } = {}) {
  const chain = resolveEnvChain(projectDir);

  return [
    ...envLayerFiles(chain.company, environment).map((file) => ({ layer: 'company', path: file })),
    ...envLayerFiles(chain.brand, environment).map((file) => ({ layer: 'brand', path: file })),
    ...envLayerFiles(chain.local, environment).map((file) => ({ layer: 'target', path: file })),
  ];
}

/**
 * Watch the whole `.env` chain and reload the cascade into process.env on a
 * change, so the NEXT rebuild reads the new values.
 *
 * SCOPE, exactly: a NEW key AND an EDITED value both land on that next rebuild,
 * and a key dropped from the file is dropped from the process — what a file
 * layer owns, the reload re-reads. A SHELL-set value always wins, whatever any
 * file now says ([#724](https://github.com/Omega-JS-Stack/omega/issues/724)).
 *
 * One `fs.watch` per DIRECTORY (a standalone brand's layers can share one),
 * filtered to the file names that directory contributes — a sibling file's
 * churn never reloads anything. A directory that does not exist is skipped, the
 * same rule the backend's stage watch applies.
 *
 * The reload is `reloadEnv`, which keeps the cascade's own precedence: the shell
 * wins over every file, and a strictly stronger layer wins over a weaker one.
 *
 * @param {object} options
 * @param {string} options.projectDir - The target root.
 * @param {string} [options.target] - Target name ('web', 'desktop', 'extension')
 *   — delivers the schema's `deliverAs` renames, exactly as the boot load did.
 * @param {string} [options.environment] - The environment whose overlay is an
 *   input (defaults to the running one).
 * @param {function} [options.log] - Line logger (silent by default).
 * @param {number} [options.debounceMs]
 * @returns {{ inputs: Array<{ layer: string, path: string }>, close: function }}
 */
function watchEnvChain(options) {
  const projectDir = options.projectDir;
  const environment = options.environment || envEnvironment();
  const log = options.log || (() => {});
  const debounceMs = options.debounceMs || DEBOUNCE_MS;
  const inputs = envChainWatchInputs(projectDir, { environment });

  // dir → the file names that dir contributes to the chain
  const byDir = new Map();
  for (const input of inputs) {
    const dir = path.dirname(input.path);
    if (!byDir.has(dir)) byDir.set(dir, new Set());
    byDir.get(dir).add(path.basename(input.path));
  }

  const watchers = [];
  let timer = null;

  for (const [dir, names] of byDir) {
    if (!fs.existsSync(dir)) continue;

    const watcher = fs.watch(dir, (event, filename) => {
      if (!names.has(filename)) return;

      clearTimeout(timer);
      timer = setTimeout(() => {
        reloadEnv(projectDir, { target: options.target, environment });
        log(`Reloaded the .env cascade — ${path.join(dir, filename)} changed`);
      }, debounceMs);
    });

    // UNREF'd: this watch rides ALONG with a dev lane, it never IS one. An
    // open fs.watch holds the event loop, so a ref'd handle would leave gulp
    // running forever after the app it served quits (desktop's `serve` ends
    // its task on electron's exit, and nothing else keeps that process up).
    watcher.unref();
    watchers.push(watcher);
  }

  return {
    inputs,
    close: () => {
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    },
  };
}

module.exports = { envChainWatchInputs, watchEnvChain, DEBOUNCE_MS };
