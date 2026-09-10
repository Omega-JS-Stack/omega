const jetpack = require('fs-jetpack');
const JSON5 = require('json5');

// Rules-file marker (shared by setup.js + the firestore/realtime rules tests):
// the OMEGA-managed block marks where the core rules belong, in the one OMEGA
// marker grammar (`<comment> ========== <Label> ==========` — see
// _attic/plans/archive/marker-harmonization.md). The open marker carries the
// rules schema stamp (RULES_VERSION in setup.js), never a package version:
//
//   // ========== OMEGA Rules (v1.0.0) ==========
//   ...core rules (framework-owned, replaced wholesale)...
//   // ========== End OMEGA Rules ==========
//
// Pre-family formats ({{ backend-manager }} placeholders, ///---omega---///
// bracket markers, etc.) are NOT matched here — converting legacy files is
// `npx omega migrate:markers`' job, run alone
// ([#40](https://github.com/Omega-JS-Stack/omega/issues/40); Ian 2026-07-10).
const omegaAllRulesRegex = /(\/\/ ========== OMEGA Rules \(v.*?\) ==========)(.*?)(\/\/ ========== End OMEGA Rules ==========)/sgm;

function loadJSON(path) {
  const contents = jetpack.read(path);
  if (!contents) {
    return {};
  }
  return JSON5.parse(contents);
}

function saveJSON5(filePath, data) {
  jetpack.write(filePath, `${JSON5.stringify(data, null, 2)}\n`);
}

function hasContent(object) {
  return Object.keys(object).length > 0;
}

function isLocal(name) {
  return name && name.indexOf('file:') > -1;
}

/**
 * The install line for the JDK the Firebase emulators need, for THIS host.
 * Every platform gets openjdk from a different manager — Homebrew on macOS,
 * winget on Windows, apt on Linux — so the one string the java-installed check
 * and `omega test`'s preflight both print lives here.
 *
 * Same rule as devkit's `mkcertInstallHint`: the line OPENS with something
 * pasteable, and an alternative goes in a sentence after it, never spliced into
 * the command a reader will copy.
 *
 * @param {string} [platform] - Host platform (test seam)
 * @returns {string} The command to run, then any alternative
 */
function javaInstallHint(platform = process.platform) {
  if (platform === 'darwin') {
    return 'brew install openjdk';
  }

  if (platform === 'win32') {
    return 'winget install Microsoft.OpenJDK.21. Chocolatey works too: choco install openjdk.';
  }

  return 'sudo apt install default-jdk';
}

module.exports = {
  omegaAllRulesRegex,
  loadJSON,
  saveJSON5,
  hasContent,
  isLocal,
  javaInstallHint,
};
