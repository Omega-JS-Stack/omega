/**
 * scaffold-guard — the refusal every framework's ensure-target runs before it
 * writes anything.
 *
 * Every verb heals its target on the way past ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)),
 * which makes the cwd load-bearing: `omega deploy` run at a workspace ROOT
 * scaffolded a whole desktop target into it — gulpfile, src/, workflows, rewritten
 * root scripts — before failing anyway ([#699](https://github.com/Omega-JS-Stack/omega/issues/699)).
 * A workspace root is never a target: a target is a MEMBER of one. So a scaffold
 * aimed at a manifest declaring `workspaces` is a misfire, not a fresh project.
 *
 * Twin of the dispatcher's own refusal (`@omega.js/devkit/omega-bin`), one layer
 * lower and same shape: that one catches a verb run where NO context resolves,
 * this one catches a verb that reached a framework CLI anyway. Throwing is the
 * loud stop — every framework CLI prints the message and exits nonzero.
 *
 * Stdlib-only (fs/path), like the dispatcher: it is vendored into every framework
 * dist and runs before the framework's own dependencies matter.
 */
const fs = require('fs');
const path = require('path');

/**
 * The nearest package.json walking up from startDir, BOUNDED at the nearest
 * `.git` (that directory is still checked) — past the repo boundary is somebody
 * else's tree. Same bound as the dispatcher's findTarget.
 *
 * @param {string} startDir - Where to start the walk.
 * @returns {{ dir: string, manifestPath: string }|null} null when nothing is found.
 */
function nearestManifest(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    const manifestPath = path.join(dir, 'package.json');
    if (fs.existsSync(manifestPath)) return { dir, manifestPath };

    if (fs.existsSync(path.join(dir, '.git'))) return null;

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * A refusal: crafted text a human is meant to read, flagged so every surface
 * prints it the same way — the message alone, nothing added. `@omega.js/backend`'s
 * bin and devkit's cli-router both branch on the flag, so a refused command
 * never renders as a bug (a red ✗ there, a raw stack here) ([#706](https://github.com/Omega-JS-Stack/omega/issues/706)).
 *
 * @param {string} message - The lines to print verbatim.
 * @returns {Error} The flagged error to throw.
 */
function refusal(message) {
  const error = new Error(message);
  error.refusal = true;
  return error;
}

/**
 * Throw unless projectDir can legitimately be scaffolded as a target. A fresh
 * directory with no manifest above it stays allowed — that is the standalone
 * bootstrap case every verb supports.
 *
 * @param {string} projectDir - The directory ensure-target is about to write to.
 * @returns {void}
 * @throws {Error} When the nearest manifest declares `workspaces`, or cannot be read.
 */
function assertScaffoldable(projectDir) {
  const nearest = nearestManifest(projectDir);
  if (!nearest) return;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(nearest.manifestPath, 'utf8'));
  } catch (e) {
    // Unreadable is not "not a workspace root". Scaffolding on that guess is the
    // exact accident this guard exists to stop, so it refuses — and names the
    // file, which a raw SyntaxError out of JSON.parse never did.
    throw refusal(
      `omega: refusing to scaffold into ${path.resolve(projectDir)} — ${nearest.manifestPath} could not be read `
      + `(${e.message}), so whether this is a workspace root cannot be known. Nothing was scaffolded.\n`
      + 'Fix that manifest, or run the verb from inside a target (e.g. targets/<name>).',
    );
  }

  if (!manifest.workspaces) return;

  throw refusal(
    `omega: refusing to scaffold into ${path.resolve(projectDir)} — ${nearest.manifestPath} declares "workspaces", `
    + 'so this is a workspace root (a brand or monorepo root), not an OMEGA target. Nothing was scaffolded.\n'
    + 'Run the verb from inside a target (e.g. targets/<name>), or `npx omega onboard` to create one.',
  );
}

module.exports = { assertScaffoldable, nearestManifest };
