// Boot-layer proof that electron-store ships INSIDE the esbuild bundle.
//
// Why this suite exists: electron-store is ESM-only and used to be loaded via a
// `webpackIgnore`'d dynamic import — a runtime resolution that accidentally worked
// in this harness (the fixture lives inside the @omega.js/desktop repo, so Node's upward
// node_modules walk finds @omega.js/desktop's copy) but FAILED in real packaged consumers, where
// @omega.js/desktop is a devDependency that never ships in the asar. Storage silently became a
// no-op. The functional round-trip below would therefore pass either way — the
// regression assertion is the BUNDLE TEXT one: no live `import('electron-store')`
// call may survive the bundle (esbuild's eager bundling inlines the module).
//
// NOTE: inspect bodies are serialized to the spawned Electron process — no closures.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  description: 'storage — electron-store bundled into main.bundle.js (no runtime resolution)',
  timeout: 30000,
  tests: [
    {
      description: 'no live import("electron-store") remains in the bundle; module source is inlined',
      inspect: async ({ expect, appRoot }) => {
        const fs = require('fs');
        const path = require('path');
        const bundle = fs.readFileSync(path.join(appRoot, 'dist', 'main.bundle.js'), 'utf8');

        // A surviving dynamic import (with or without magic comments) means the bundler
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
        manager.storage.set('desktop:boot:storageProof', 'bundled');
        expect(manager.storage.get('desktop:boot:storageProof')).toBe('bundled');

        const storePath = manager.storage.getPath();
        expect(Boolean(storePath)).toBe(true);
        expect(storePath.endsWith('omega-storage.json')).toBe(true);
        expect(fs.existsSync(storePath)).toBe(true);

        manager.storage.delete('desktop:boot:storageProof');
      },
    },
  ],
});
