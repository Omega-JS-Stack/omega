const jetpack = require('fs-jetpack');
const JSON5 = require('json5');

// Rules-file marker (shared by setup.js + the firestore/realtime rules tests):
// the ///---omega---/// block marks where the core rules belong. Pre-omega
// formats ({{ backend-manager }} placeholders etc.) are NOT matched here —
// converting legacy files is the migration tooling's job (Ian 2026-07-10).
const omegaAllRulesRegex = /(\/\/\/---omega---\/\/\/)(.*?)(\/\/\/---------end---------\/\/\/)/sgm;

function loadJSON(path) {
  const contents = jetpack.read(path);
  if (!contents) {
    return {};
  }
  return JSON5.parse(contents);
}

function saveJSON5(filePath, data) {
  jetpack.write(filePath, JSON5.stringify(data, null, 2) + '\n');
}

function hasContent(object) {
  return Object.keys(object).length > 0;
}

function isLocal(name) {
  return name && name.indexOf('file:') > -1;
}

module.exports = {
  omegaAllRulesRegex,
  loadJSON,
  saveJSON5,
  hasContent,
  isLocal,
};
