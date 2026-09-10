/**
 * The opt-in test lanes THIS framework serves.
 *
 * A lane is two halves that must agree: a gate module at
 * `src/cli/commands/test-lanes/<name>.js`, and a suite directory `test/<name>/`
 * the runner keeps unreachable until that gate opens it. The NAME binding them
 * has one home, the framework's own package.json `omega.testLanes`, because a
 * third party reads it too: the brand-root `omega test --lane=<name>` fan-out
 * asks each target's framework which lanes it declares before forwarding the
 * flag ([#775](https://github.com/Omega-JS-Stack/omega/issues/775)). Two
 * hardcoded copies of the string is exactly how a lane goes silently
 * unreachable, or worse, silently open.
 *
 * Plain `fs` and a resolve from this file: the manifest sits two levels up in
 * both layouts, `src/utils/` in the monorepo and `dist/utils/` in an install.
 */
const fs = require('fs');
const path = require('path');

const MANIFEST = path.resolve(__dirname, '..', '..', 'package.json');

let cached = null;

/**
 * Every lane this framework declares.
 *
 * @returns {string[]} The declared lane names (empty when none are declared)
 */
function declaredLanes() {
  if (cached) return cached;

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const lanes = manifest.omega && manifest.omega.testLanes;
  cached = Array.isArray(lanes) ? [...lanes] : [];

  return cached;
}

/**
 * The lane's own name, proved against the declaration.
 *
 * A gate module names itself with this, so a module whose file name drifted
 * from the manifest fails LOUDLY at load instead of gating a lane nothing can
 * reach.
 *
 * @param {string} name - The lane name (a gate module passes its own basename)
 * @returns {string} The same name
 * @throws {Error} When the manifest does not declare it
 */
function assertDeclaredLane(name) {
  const lanes = declaredLanes();
  if (!lanes.includes(name)) {
    throw new Error(
      `test lane "${name}" is not declared in ${MANIFEST} (omega.testLanes: ${JSON.stringify(lanes)}) — `
      + 'declare it there, or rename the lane module to a declared name.',
    );
  }

  return name;
}

module.exports = { declaredLanes, assertDeclaredLane, MANIFEST };
