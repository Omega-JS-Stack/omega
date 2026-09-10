// Loads a JS module from an arbitrary path on disk (e.g. consumer's src/tray/index.js).
//
// Used by tray/menu/context-menu to load consumer-defined definition files. A bundler would
// normally try to resolve `require(<dynamicPath>)` at build time, which can never work for a
// runtime path, so we use Node's `module.createRequire(...)` to get a real require function.
// (In the webpack era this also drew a noisy "Critical dependency" warning at build time; the
// runtime behavior was correct then too.)

const path   = require('path');
const Module = require('module');

// Returns the module.exports of the file, or null if the file doesn't exist.
// THROWS if the file exists but fails to load (syntax error, throws at module-eval, etc.).
// Callers can decide whether to treat load errors as fatal — most should.
// On success, also clears Node's require cache for the file so subsequent reloads pick up edits.
function loadConsumerFile(absPath) {
  const fs = require('fs');
  if (!fs.existsSync(absPath)) return null;

  const consumerRequire = Module.createRequire(path.join(process.cwd(), 'package.json'));
  const resolved = consumerRequire.resolve(absPath);
  delete consumerRequire.cache[resolved];
  return consumerRequire(resolved);
}

module.exports = loadConsumerFile;
