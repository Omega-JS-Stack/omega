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
  mkcertInstallHint,
  mkcertCaRootPem,
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
  assert.equal(typeof mkcertInstallHint, 'function');
  assert.equal(typeof mkcertCaRootPem, 'function');
});

// The root CA path is what a spawned process trusts through
// NODE_EXTRA_CA_CERTS (#795), so "no mkcert" has to answer null rather than a
// path that verifies nothing. The lookup is injected — no real mkcert runs.
test('mkcertCaRootPem: no mkcert on the host → null', () => {
  const answer = mkcertCaRootPem({ exec: () => { throw new Error('command not found: mkcert'); } });

  assert.equal(answer, null);
});

test('mkcertCaRootPem: a CAROOT holding rootCA.pem → the joined path', () => {
  const dir = tmpDir('caroot');
  fs.writeFileSync(path.join(dir, 'rootCA.pem'), 'root-ca-bytes');

  assert.equal(mkcertCaRootPem({ exec: () => `${dir}\n` }), path.join(dir, 'rootCA.pem'));
});

test('mkcertCaRootPem: a CAROOT without the root file → null', () => {
  const dir = tmpDir('caroot-empty');

  assert.equal(mkcertCaRootPem({ exec: () => `${dir}\n` }), null);
});

test('mkcertCaRootPem: memoised — three call sites, one shell call', () => {
  const dir = tmpDir('caroot-memo');
  fs.writeFileSync(path.join(dir, 'rootCA.pem'), 'root-ca-bytes');

  let calls = 0;
  const exec = () => { calls += 1; return `${dir}\n`; };

  assert.equal(mkcertCaRootPem({ exec }), path.join(dir, 'rootCA.pem'));
  assert.equal(mkcertCaRootPem({ exec }), path.join(dir, 'rootCA.pem'));
  assert.equal(calls, 1, 'the second call answers from the memo');
});

// The hint is the ONLY thing a host without mkcert gets, so it has to name a
// manager that host actually has. Platform is an argument so all three branches
// are pinned from one machine.
test('mkcertInstallHint: every platform gets its own manager', () => {
  assert.equal(mkcertInstallHint('darwin'), 'brew install mkcert && mkcert -install');

  // Windows: Chocolatey IS the command; scoop is named after it, not spliced in.
  assert.equal(mkcertInstallHint('win32').split('.')[0], 'choco install mkcert && mkcert -install');
  assert.match(mkcertInstallHint('win32'), /scoop/i, 'scoop is still named');

  // Linux, per mkcert's README: certutil from apt, mkcert from the release binary.
  assert.match(mkcertInstallHint('linux'), /apt install libnss3-tools/);
  assert.match(mkcertInstallHint('linux'), /github\.com\/FiloSottile\/mkcert\/releases/);

  for (const platform of ['darwin', 'win32', 'linux', 'freebsd']) {
    const hint = mkcertInstallHint(platform);
    assert.match(hint, /mkcert -install/, `${platform} must still trust the CA`);
  }

  // The bug this replaces: every host was told `brew install mkcert`.
  for (const platform of ['win32', 'linux', 'freebsd']) {
    assert.doesNotMatch(mkcertInstallHint(platform), /brew install/, `${platform} has no Homebrew`);
  }
});

test('mkcertInstallHint: the line OPENS with something pasteable', () => {
  // A reader copies the head of the line; an alternative buried inside the
  // command is a command that does not run.
  for (const platform of ['darwin', 'win32', 'linux']) {
    const head = mkcertInstallHint(platform).split('.')[0];
    assert.doesNotMatch(head, /\(or\b|\bor:/, `${platform} splices an alternative into the command`);
  }
});

test('mkcertInstallHint: defaults to the host platform', () => {
  assert.equal(mkcertInstallHint(), mkcertInstallHint(process.platform));
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

test('plain http on the TLS port → 307 redirect to https (same host + path)', { skip: !hasMkcert }, async () => {
  const dir = tmpDir('redirect');
  const certs = await ensureLocalHttpsCerts({ certsDir: dir });
  assert.ok(certs, 'certs available');

  // No upstream needed — the redirect answers at the front door
  const proxy = startLocalHttpsProxy({ port: 0, targetPort: 9, certs });
  await once(proxy, 'listening');
  const proxyPort = proxy.address().port;

  const res = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${proxyPort}/payment/checkout?product=premium`, resolve).on('error', reject);
  });

  assert.equal(res.statusCode, 307, 'temporary, method-preserving redirect');
  assert.equal(res.headers.location, `https://localhost:${proxyPort}/payment/checkout?product=premium`);
  res.resume();

  proxy.close();
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
