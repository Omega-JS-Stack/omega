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

module.exports = {
  omegaAllRulesRegex,
  loadJSON,
  saveJSON5,
  hasContent,
};
