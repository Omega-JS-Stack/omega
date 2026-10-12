// Boot-layer proof that electron-store ships INSIDE the esbuild bundle: in a
// packaged consumer @omega.js/desktop never ships in the asar, so a runtime
// import of it is a silent no-op store. The bundle-text case is the regression
// pin. `run` bodies are serialized to the spawned Electron process: no closures.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  description: 'storage — electron-store bundled into main.bundle.js (no runtime resolution)',
  tests: [
    {
      name: 'no live import("electron-store") remains in the bundle; module source is inlined',
      run: async (ctx) => {
        const fs = require('fs');
        const path = require('path');
        const bundle = fs.readFileSync(path.join(ctx.appRoot, 'dist', 'main.bundle.js'), 'utf8');

        // A surviving dynamic import (with or without magic comments) means the bundler
        // was told to ignore it → packaged consumers would hit the no-op fallback.
        const liveImport = /import\s*\(\s*(\/\*[\s\S]*?\*\/\s*)?['"]electron-store['"]/.test(bundle);
        ctx.expect(liveImport).toBe(false);

        // Positive proof the module got inlined: 'electron-store-get-data' is a
        // runtime string literal inside electron-store's own source (its internal
        // IPC channel), so it survives minification.
        ctx.expect(bundle.includes('electron-store-get-data')).toBe(true);
      },
    },

    {
      name: 'storage is a REAL store through the bundle (not the no-op fallback)',
      run: async (ctx) => {
        const fs = require('fs');

        // The no-op fallback leaves _store null → getPath() null and get() always default.
        ctx.omega.storage.set('desktop:boot:storageProof', 'bundled');
        ctx.expect(ctx.omega.storage.get('desktop:boot:storageProof')).toBe('bundled');

        const storePath = ctx.omega.storage.getPath();
        ctx.expect(Boolean(storePath)).toBe(true);
        ctx.expect(storePath.endsWith('omega-storage.json')).toBe(true);
        ctx.expect(fs.existsSync(storePath)).toBe(true);

        ctx.omega.storage.delete('desktop:boot:storageProof');
      },
    },
  ],
});
