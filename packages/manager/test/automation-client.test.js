/**
 * AutomationClient protocol tests — a REAL `ws` client stands in for the
 * Chrome extension (the manager side is the server, so the extension's
 * half of the protocol is fully exercisable in-process): connect
 * handshake, command → result correlation, error propagation with codes,
 * progress messages ignored, command timeout, and disconnect cleanup.
 * Every test binds an ephemeral port so parallel runs never collide.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const net = require('node:net');
const WebSocket = require('ws');

const { AutomationClient, resolveExtensionPort, DEFAULT_PORT } = require('../src/lib/automation-client.js');

/** Grab an ephemeral port the OS considers free. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Connect a fake extension to the client's server and answer OMEGA_AUTOMATE
 * messages via `respond(msg)` → the JSON to send back (null = stay silent).
 */
function connectFakeExtension(port, respond) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const reply = respond(msg);
      if (reply) {
        ws.send(JSON.stringify(reply));
      }
    });
  });
}

module.exports = defineCases({
  type: 'group',
  description: 'automation-client',
  tests: [
    {
      name: 'automation-client: resolveExtensionPort defaults to 9876 and honors OMEGA_EXTENSION_PORT',
      run: (ctx) => {
        delete process.env.OMEGA_EXTENSION_PORT;
        ctx.expect(resolveExtensionPort()).toBe(DEFAULT_PORT);

        process.env.OMEGA_EXTENSION_PORT = '4242';
        try {
          ctx.expect(resolveExtensionPort()).toBe(4242);
        } finally {
          delete process.env.OMEGA_EXTENSION_PORT;
        }
      },
    },

    {
      name: 'automation-client: command resolves with the extension result',
      run: async (ctx) => {
        const port = await freePort();
        const client = new AutomationClient({ port });

        const seen = [];
        const connecting = client.connect();
        const ext = await connectFakeExtension(port, (msg) => {
          seen.push(msg);
          return { type: 'OMEGA_AUTOMATE_RESULT', id: msg.id, success: true, result: { value: 'Example Title' } };
        });
        await connecting;

        try {
          const result = await client.evaluate('document.title');
          ctx.expect(result).toEqual({ value: 'Example Title' });

          // The wire message carries the full protocol envelope
          ctx.expect(seen.length).toBe(1);
          ctx.expect(seen[0].type).toBe('OMEGA_AUTOMATE');
          ctx.expect(seen[0].command).toBe('evaluate');
          ctx.expect(seen[0].params).toEqual({ expression: 'document.title' });
          ctx.expect(seen[0].id.startsWith('cmd_')).toBeTruthy();
        } finally {
          ext.close();
          await client.disconnect();
        }
      },
    },

    {
      name: 'automation-client: extension errors reject with message + code',
      run: async (ctx) => {
        const port = await freePort();
        const client = new AutomationClient({ port });

        const connecting = client.connect();
        const ext = await connectFakeExtension(port, (msg) => ({
          type: 'OMEGA_AUTOMATE_RESULT',
          id: msg.id,
          success: false,
          error: { message: 'no element matches #missing', code: 'ELEMENT_NOT_FOUND' },
        }));
        await connecting;

        try {
          await ctx.expect(client.click('#missing')).rejects.toThrow((err) => err.message === 'no element matches #missing' && err.code === 'ELEMENT_NOT_FOUND');
        } finally {
          ext.close();
          await client.disconnect();
        }
      },
    },

    {
      name: 'automation-client: progress messages are ignored, the result still resolves',
      run: async (ctx) => {
        const port = await freePort();
        const client = new AutomationClient({ port });

        const connecting = client.connect();
        const ext = await connectFakeExtension(port, (msg) => {
          // Progress first, then the real result — the client must wait for the result
          return { type: 'OMEGA_AUTOMATE_PROGRESS', id: msg.id, step: 1 };
        });
        await connecting;

        try {
          const pending = client.navigate('https://example.com');
          // Send the real result after the progress event landed
          setTimeout(() => {
            ext.send(JSON.stringify({ type: 'OMEGA_AUTOMATE_RESULT', id: [...client.pending.keys()][0], success: true, result: { loaded: true } }));
          }, 50);
          ctx.expect(await pending).toEqual({ loaded: true });
        } finally {
          ext.close();
          await client.disconnect();
        }
      },
    },

    {
      name: 'automation-client: command times out when the extension never answers',
      run: async (ctx) => {
        const port = await freePort();
        const client = new AutomationClient({ port, commandTimeout: 100 });

        const connecting = client.connect();
        const ext = await connectFakeExtension(port, () => null);
        await connecting;

        try {
          await ctx.expect(client.read({ selector: 'body' })).rejects.toThrow(/timed out after 100ms/);
          ctx.expect(client.pending.size).toBe(0); // timed-out entry cleaned up
        } finally {
          ext.close();
          await client.disconnect();
        }
      },
    },

    {
      name: 'automation-client: connect times out without an extension',
      run: async (ctx) => {
        const port = await freePort();
        const client = new AutomationClient({ port, connectTimeout: 100 });

        await ctx.expect(client.connect()).rejects.toThrow(/did not connect/);
      },
    },

    {
      name: 'automation-client: extension disconnect rejects in-flight commands',
      run: async (ctx) => {
        const port = await freePort();
        const client = new AutomationClient({ port });

        const connecting = client.connect();
        const ext = await connectFakeExtension(port, () => null);
        await connecting;

        try {
          const pending = client.wait({ delay: 5000 });
          ext.terminate();
          await ctx.expect(pending).rejects.toThrow(/Extension disconnected/);
          ctx.expect(client.pending.size).toBe(0);
          ctx.expect(client.ws).toBe(null);
        } finally {
          await client.disconnect();
        }
      },
    },
  ],
});
