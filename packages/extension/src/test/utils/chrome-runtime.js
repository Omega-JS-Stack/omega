// The one runtime seam Node lacks for the extension's own modules:
// `chrome.runtime`. lib/extension.js reads it once at load, so it is present
// while a module loads, and it records nothing and answers nothing
// (wave5-messenger.test.js drives the messaging).
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.join(__dirname, '..', '..');

const RUNTIME = {
  onMessage: { addListener: () => {} },
  onInstalled: { addListener: () => {} },
  sendMessage: async () => undefined,
  getManifest: () => ({ version: '1.2.3' }),
};

// Run `fn` with `chrome.runtime` present, the way every context runs
function withRuntime(fn) {
  global.chrome = { runtime: RUNTIME };
  try {
    return fn();
  } finally {
    delete global.chrome;
  }
}

// Import an extension module (path segments under src/) with the runtime
// present. The first load of lib/extension.js binds the runtime, so a copy
// another suite required without one is dropped first.
async function importWithRuntime(...segments) {
  global.chrome = { runtime: RUNTIME };
  for (const file of [['lib', 'extension.js'], ['lib', 'messaging.js']]) {
    delete require.cache[require.resolve(path.join(SRC, ...file))];
  }
  try {
    return await import(pathToFileURL(path.join(SRC, ...segments)).href);
  } finally {
    delete global.chrome;
  }
}

module.exports = { RUNTIME, withRuntime, importWithRuntime };
