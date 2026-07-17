// Unit tests for src/local-https.js — the shared mkcert cert flow + TLS
// forwarding proxy behind `omega serve`/`omega emulator` (backend) and
// `omega dev` (web).
//
// Cert generation and the live proxy round-trips need mkcert on the machine;
// those tests skip cleanly when it's absent (the module's own no-mkcert
// fallback is exactly `null`). The pure checks always run.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { execSync } = require('node:child_process');
const {
  ensureLocalHttpsCerts,
  startLocalHttpsProxy,
  checkCertProblem,
  findCertPair,
} = require('../src/local-https.js');

const hasMkcert = (() => {
  try {
    execSync('which mkcert', { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
})();

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `devkit-https-${name}-`));
}

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

test('exports the expected surface', () => {
  assert.equal(typeof ensureLocalHttpsCerts, 'function');
  assert.equal(typeof startLocalHttpsProxy, 'function');
  assert.equal(typeof checkCertProblem, 'function');
  assert.equal(typeof findCertPair, 'function');
});

test('findCertPair: empty dir → null', () => {
  const dir = tmpDir('empty');
  assert.equal(findCertPair(dir), null);
});

test('checkCertProblem: garbage file → unreadable', () => {
  const dir = tmpDir('garbage');
  const file = path.join(dir, 'localhost.pem');
  fs.writeFileSync(file, 'not a certificate');
  assert.equal(checkCertProblem(file), 'unreadable certificate');
});

test('ensureLocalHttpsCerts: generates then reuses a pair', { skip: !hasMkcert }, async () => {
  const dir = tmpDir('gen');

  const first = await ensureLocalHttpsCerts({ certsDir: dir });
  assert.ok(first, 'pair generated');
  assert.ok(fs.existsSync(first.key), 'key file exists');
  assert.ok(fs.existsSync(first.cert), 'cert file exists');
  assert.equal(checkCertProblem(first.cert), null, 'fresh cert is usable');

  const logs = [];
  const second = await ensureLocalHttpsCerts({ certsDir: dir, log: (line) => logs.push(line) });
  assert.equal(second.cert, first.cert, 'same cert reused');
  assert.ok(logs.some((line) => line.includes('existing mkcert certificates')), 'reuse logged');
});

test('proxy round-trip: TLS in, plain http out, x-forwarded headers set', { skip: !hasMkcert }, async () => {
  const dir = tmpDir('proxy');
  const certs = await ensureLocalHttpsCerts({ certsDir: dir });
  assert.ok(certs, 'certs available');

  // Upstream plain-http server echoing what it saw
  const seen = {};
  const upstream = http.createServer((req, res) => {
    seen.url = req.url;
    seen.proto = req.headers['x-forwarded-proto'];
    seen.host = req.headers['x-forwarded-host'];
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('upstream-ok');
  });
  upstream.listen(0);
  await once(upstream, 'listening');
  const targetPort = upstream.address().port;

  const proxy = startLocalHttpsProxy({ port: 0, targetPort, certs });
  await once(proxy, 'listening');
  const proxyPort = proxy.address().port;

  const body = await new Promise((resolve, reject) => {
    https.get(`https://localhost:${proxyPort}/hello?x=1`, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });

  assert.equal(body, 'upstream-ok');
  assert.equal(seen.url, '/hello?x=1');
  assert.equal(seen.proto, 'https');
  assert.equal(seen.host, `localhost:${proxyPort}`);

  proxy.close();
  proxy.closeAllConnections?.();
  upstream.close();
  upstream.closeAllConnections?.();
});

test('proxy tunnels WebSocket upgrades (dev-server live-reload)', { skip: !hasMkcert }, async () => {
  const dir = tmpDir('ws');
  const certs = await ensureLocalHttpsCerts({ certsDir: dir });
  assert.ok(certs, 'certs available');

  // Upstream that accepts the upgrade and echoes raw bytes back
  const upstream = http.createServer();
  upstream.on('upgrade', (req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (chunk) => socket.write(chunk));
  });
  upstream.listen(0);
  await once(upstream, 'listening');
  const targetPort = upstream.address().port;

  const proxy = startLocalHttpsProxy({ port: 0, targetPort, certs });
  await once(proxy, 'listening');
  const proxyPort = proxy.address().port;

  const client = tls.connect({ port: proxyPort, host: 'localhost', rejectUnauthorized: false });
  await once(client, 'secureConnect');

  client.write([
    'GET /live-reload HTTP/1.1',
    `Host: localhost:${proxyPort}`,
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version: 13',
    '', '',
  ].join('\r\n'));

  // Handshake through the tunnel
  let received = '';
  const sawHandshake = new Promise((resolve) => {
    client.on('data', (chunk) => {
      received += chunk.toString();
      if (received.includes('101 Switching Protocols')) {
        resolve();
      }
    });
  });
  await sawHandshake;

  // Bytes echo through the spliced sockets
  received = '';
  client.write('ping-through-tunnel');
  const sawEcho = new Promise((resolve) => {
    const check = () => {
      if (received.includes('ping-through-tunnel')) {
        resolve();
      }
    };
    client.on('data', (chunk) => {
      received += chunk.toString();
      check();
    });
    check();
  });
  await sawEcho;

  client.destroy();
  proxy.close();
  proxy.closeAllConnections?.();
  upstream.close();
  upstream.closeAllConnections?.();
});
