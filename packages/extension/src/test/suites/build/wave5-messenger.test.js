// Build-layer coverage for wave-5 F7: `manager.messenger` was documented as
// "wired automatically" but every context assigned null and lib/messaging.js
// was never instantiated. Behavioral test for the Messaging class + source
// pins proving each DOM context constructs it (the context Managers are
// ES modules webpack owns — not requireable from Node, hence the pins).

const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', '..', '..');
const CONTEXTS = ['popup', 'options', 'sidepanel', 'page', 'content'];

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'lib/messaging + per-context messenger wiring (wave-5 F7)',
  tests: [
    {
      name: 'Messaging registers an onMessage listener and send() targets runtime.sendMessage',
      run: async (ctx) => {
        const extPath = require.resolve(path.join(SRC, 'lib', 'extension.js'));
        const msgPath = require.resolve(path.join(SRC, 'lib', 'messaging.js'));
        const listeners = [];
        const sent = [];
        global.chrome = {
          runtime: {
            onMessage: { addListener: (fn) => listeners.push(fn) },
            sendMessage: async (msg) => { sent.push(msg); },
          },
        };
        delete require.cache[extPath];
        delete require.cache[msgPath];
        try {
          const Messaging = require(msgPath);
          const messenger = new Messaging({ sender: 'popup' });
          ctx.expect(listeners.length).toBe(1);

          messenger.send({ destination: 'background', command: 'ping', payload: { a: 1 } });
          ctx.expect(sent.length).toBe(1);
          ctx.expect(sent[0].sender).toBe('popup');
          ctx.expect(sent[0].destination).toBe('background');

          // The degenerate `!init || !init` check claimed to validate sender —
          // now it actually does.
          let threw = null;
          try { new Messaging({}); } catch (e) { threw = e; }
          ctx.expect(threw).not.toBeNull();
        } finally {
          delete global.chrome;
          delete require.cache[extPath];
          delete require.cache[msgPath];
        }
      },
    },
    {
      // wave-5 (history-lens catch): openAuthPage was the un-flipped half of
      // the F9 pair — it still built the sign-in URL from authDomain while
      // background.js watched the brand.url host; the round trip could never
      // complete. Both ends now speak brand.url.
      name: 'openAuthPage derives the sign-in URL from brand.url, never authDomain (source pin)',
      run: (ctx) => {
        const source = fs.readFileSync(path.join(SRC, 'lib', 'auth-helpers.js'), 'utf8');
        const fnSource = source.slice(source.indexOf('export function openAuthPage'));
        ctx.expect(fnSource.includes('brand?.url')).toBe(true);
        // The old read, gone (comments may still NAME authDomain to warn it off)
        ctx.expect(fnSource.includes('config?.authDomain')).toBe(false);
      },
    },
    {
      name: 'every DOM context constructs Messaging with its own sender (source pin)',
      run: (ctx) => {
        for (const name of CONTEXTS) {
          const source = fs.readFileSync(path.join(SRC, `${name}.js`), 'utf8');
          ctx.expect(source.includes(`new Messaging({ sender: '${name}' })`)).toBe(true);
        }
      },
    },
  ],
};
