// Source pins for wave-5 fixes whose behavior lives behind Electron SDK
// surfaces the build layer can't execute (contextBridge). The renderer-layer
// suite proves the HARNESS mirror; these pin the PRODUCTION sources.

const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', '..', '..');

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'wave-5 source pins (desktop)',
  tests: [
    {
      // wave-5 F4: ipc.on returned ipcRenderer (useless across the bridge)
      // and never tracked the wrapped handler.
      name: 'preload ipc.on returns an unsubscribe closure over removeListener',
      run: (ctx) => {
        const source = fs.readFileSync(path.join(SRC, 'preload.js'), 'utf8');
        const ipcBlock = source.slice(source.indexOf('ipc: {'), source.indexOf('storage: {'));
        ctx.expect(ipcBlock.includes('removeListener(channel, wrapped)')).toBe(true);
      },
    },
    {
      // wave-5 F1: main.js must release the deep-link boot queue after full init.
      name: 'main.js drains the deep-link boot queue via markManagerReady()',
      run: (ctx) => {
        const source = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
        ctx.expect(source.includes('deepLink.markManagerReady()')).toBe(true);
      },
    },
  ],
};
