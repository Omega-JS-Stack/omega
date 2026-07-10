const jetpack = require('fs-jetpack');
const JSON5 = require('json5');

// Rules-file markers (shared by setup.js + the firestore/realtime rules tests):
// the current ///---omega---/// block, and the legacy mustache placeholder
// ({{ backend-manager }}) still present in un-migrated consumers' rules files —
// both mark where the core rules block belongs. The legacy literal must stay
// `backend-manager`: it matches bytes that exist in the wild, not our name.
const omegaAllRulesRegex = /(\/\/\/---omega---\/\/\/)(.*?)(\/\/\/---------end---------\/\/\/)/sgm;
const legacyRulesPlaceholderRegex = /({{\s*?backend-manager\s*?}})/sgm;

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
  legacyRulesPlaceholderRegex,
  loadJSON,
  saveJSON5,
  hasContent,
  isLocal,
};
