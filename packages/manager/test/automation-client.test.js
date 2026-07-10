/**
 * AutomationClient protocol tests — a REAL `ws` client stands in for the
 * Chrome extension (the manager side is the server, so the extension's
 * half of the protocol is fully exercisable in-process): connect
 * handshake, command → result correlation, error propagation with codes,
 * progress messages ignored, command timeout, and disconnect cleanup.
 * Every test binds an ephemeral port so parallel runs never collide.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
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

test('automation-client: resolveExtensionPort defaults to 9876 and honors OMEGA_EXTENSION_PORT', () => {
  delete process.env.OMEGA_EXTENSION_PORT;
  assert.equal(resolveExtensionPort(), DEFAULT_PORT);

  process.env.OMEGA_EXTENSION_PORT = '4242';
  try {
    assert.equal(resolveExtensionPort(), 4242);
  } finally {
    delete process.env.OMEGA_EXTENSION_PORT;
  }
});

test('automation-client: command resolves with the extension result', async () => {
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
    assert.deepEqual(result, { value: 'Example Title' });

    // The wire message carries the full protocol envelope
    assert.equal(seen.length, 1);
    assert.equal(seen[0].type, 'OMEGA_AUTOMATE');
    assert.equal(seen[0].command, 'evaluate');
    assert.deepEqual(seen[0].params, { expression: 'document.title' });
    assert.ok(seen[0].id.startsWith('cmd_'));
  } finally {
    ext.close();
    await client.disconnect();
  }
});

test('automation-client: extension errors reject with message + code', async () => {
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
    await assert.rejects(
      client.click('#missing'),
      (err) => err.message === 'no element matches #missing' && err.code === 'ELEMENT_NOT_FOUND',
    );
  } finally {
    ext.close();
    await client.disconnect();
  }
});

test('automation-client: progress messages are ignored, the result still resolves', async () => {
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
    assert.deepEqual(await pending, { loaded: true });
  } finally {
    ext.close();
    await client.disconnect();
  }
});

test('automation-client: command times out when the extension never answers', async () => {
  const port = await freePort();
  const client = new AutomationClient({ port, commandTimeout: 100 });

  const connecting = client.connect();
  const ext = await connectFakeExtension(port, () => null);
  await connecting;

  try {
    await assert.rejects(client.read({ selector: 'body' }), /timed out after 100ms/);
    assert.equal(client.pending.size, 0); // timed-out entry cleaned up
  } finally {
    ext.close();
    await client.disconnect();
  }
});

test('automation-client: connect times out without an extension', async () => {
  const port = await freePort();
  const client = new AutomationClient({ port, connectTimeout: 100 });

  await assert.rejects(client.connect(), /did not connect/);
});

test('automation-client: extension disconnect rejects in-flight commands', async () => {
  const port = await freePort();
  const client = new AutomationClient({ port });

  const connecting = client.connect();
  const ext = await connectFakeExtension(port, () => null);
  await connecting;

  try {
    const pending = client.wait({ delay: 5000 });
    ext.terminate();
    await assert.rejects(pending, /Extension disconnected/);
    assert.equal(client.pending.size, 0);
    assert.equal(client.ws, null);
  } finally {
    await client.disconnect();
  }
});
