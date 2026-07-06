// Boot-layer proof that electron-store ships INSIDE the webpack bundle.
//
// Why this suite exists: electron-store is ESM-only and used to be loaded via a
// `webpackIgnore`'d dynamic import — a runtime resolution that accidentally worked
// in this harness (the fixture lives inside the EM repo, so Node's upward
// node_modules walk finds EM's copy) but FAILED in real packaged consumers, where
// EM is a devDependency that never ships in the asar. Storage silently became a
// no-op. The functional round-trip below would therefore pass either way — the
// regression assertion is the BUNDLE TEXT one: no live `import('electron-store')`
// call may survive webpack (eager bundling compiles it to __webpack_require__).
//
// NOTE: inspect bodies are serialized to the spawned Electron process — no closures.

module.exports = {
  type: 'group',
  layer: 'boot',
  description: 'storage — electron-store bundled into main.bundle.js (no runtime resolution)',
  timeout: 30000,
  tests: [
    {
      description: 'no live import("electron-store") remains in the bundle; module source is inlined',
      inspect: async ({ expect, projectRoot }) => {
        const fs = require('fs');
        const path = require('path');
        const bundle = fs.readFileSync(path.join(projectRoot, 'dist', 'main.bundle.js'), 'utf8');

        // A surviving dynamic import (with or without magic comments) means webpack
        // was told to ignore it → packaged consumers would hit the no-op fallback.
        const liveImport = /import\s*\(\s*(\/\*[\s\S]*?\*\/\s*)?['"]electron-store['"]/.test(bundle);
        expect(liveImport).toBe(false);

        // Positive proof the module got inlined: 'electron-store-get-data' is a
        // runtime string literal inside electron-store's own source (its internal
        // IPC channel), so it survives minification.
        expect(bundle.includes('electron-store-get-data')).toBe(true);
      },
    },

    {
      description: 'storage is a REAL store through the bundle (not the no-op fallback)',
      inspect: async ({ manager, expect }) => {
        const fs = require('fs');

        // The no-op fallback leaves _store null → getPath() null and get() always default.
        manager.storage.set('em:boot:storageProof', 'bundled');
        expect(manager.storage.get('em:boot:storageProof')).toBe('bundled');

        const storePath = manager.storage.getPath();
        expect(Boolean(storePath)).toBe(true);
        expect(storePath.endsWith('em-storage.json')).toBe(true);
        expect(fs.existsSync(storePath)).toBe(true);

        manager.storage.delete('em:boot:storageProof');
      },
    },
  ],
};
