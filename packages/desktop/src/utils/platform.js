// The ONE translation of Node's platform word into OMEGA's platform
// vocabulary ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)).
//
// OMEGA says `mac`, `windows`, `linux` everywhere it speaks for itself: the
// config declaration (`platforms.windows.formats.nsis`), the icon dirs
// (`config/icons/mac/`), the workflow's `platforms` input, the site's
// `/download/<platform>/<format>` links, and a stored login record. Node says
// `darwin`/`win32`/`linux`, and electron-builder says `mac`/`win`/`linux`.
// Those are FOREIGN vocabularies: each is translated at exactly one point, and
// for Node's that point is here.
//
// A bare OS branch (`if (process.platform === 'darwin')`) needs no translation
// and stays as it is: it reads Node's word to decide Node's behavior and never
// produces a name anything else consumes. This function is for the places that
// turn the OS into a NAME: an icon directory, a release directory, the platform
// a deploy reports building.

// Node's process.platform → OMEGA's word. Electron runs on exactly these three.
const NODE_PLATFORMS = {
  darwin: 'mac',
  win32: 'windows',
  linux: 'linux',
};

/**
 * This machine's platform in OMEGA's vocabulary.
 *
 * @param {string} [nodePlatform] - A `process.platform` value (defaults to this
 *   process's own).
 * @returns {string|null} 'mac' | 'windows' | 'linux', or null for an OS OMEGA
 *   has no word for (the caller decides whether that is fatal).
 */
function desktopPlatform(nodePlatform = process.platform) {
  return NODE_PLATFORMS[nodePlatform] || null;
}

module.exports = { desktopPlatform, NODE_PLATFORMS };
