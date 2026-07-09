/**
 * Writeback-ready brand roots for service tests. makeBrandRoot(source)
 * builds a temp dir carrying config/omega.json5 with the given JSON5 text;
 * readConfigSource(root) reads it back so tests can pin the
 * comment-preserving guarantee (bytes outside the edited spans survive).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeBrandRoot(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-writeback-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), source);
  return root;
}

function readConfigSource(brandRoot) {
  return fs.readFileSync(path.join(brandRoot, 'config', 'omega.json5'), 'utf8');
}

module.exports = { makeBrandRoot, readConfigSource };
