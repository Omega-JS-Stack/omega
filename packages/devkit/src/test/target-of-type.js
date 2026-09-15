/**
 * WHICH dir a test lane boots for a target TYPE.
 *
 * A brand NAMES its targets ([#886](https://github.com/Omega-JS-Stack/omega/issues/886)),
 * so no lane may assume `targets/web` or `targets/backend`: the leg is
 * whichever declared name carries that `type`. This is the ONE resolution
 * both harnesses use, for the web leg and the backend leg alike, so a brand
 * that renames one target cannot boot green in one lane and fail in the other.
 */
const path = require('path');
const fs = require('fs');

const { loadConfig, targetsOfType } = require('@omega.js/config');

/**
 * The brand's first target of a type, as the name AND the dir it lives in.
 * Lenient by design: a fixture brand whose config will not load still boots
 * its default-named dir (the wizard names a target for its own type), and a
 * name with no dir on disk is no target at all.
 *
 * @param {string} brandRoot - The brand (repo) root
 * @param {string} type - A target type ('web', 'backend', …)
 * @returns {{ name: string, dir: string }|null} The target, or null when the brand runs none
 */
function targetOfType(brandRoot, type) {
  let name = type;

  try {
    const entry = targetsOfType(loadConfig(brandRoot).config, type)[0];
    if (entry) name = entry.name;
  } catch {
    // An unreadable config still leaves the default-named dir to find
  }

  const dir = path.join(brandRoot, 'targets', name);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;

  return { name, dir };
}

module.exports = { targetOfType };
