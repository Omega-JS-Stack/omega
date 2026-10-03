// Unit tests for src/local-https.js — the shared mkcert cert flow + TLS
// forwarding proxy behind `omega serve`/`omega emulator` (backend) and
// `omega dev` (web).
//
// Cert generation and the live proxy round-trips need mkcert on the machine;
// those tests skip cleanly when it's absent (the module's own no-mkcert
// fallback is exactly `null`). The pure checks always run.

const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'local-https',
  tests: [
    {
      name: 'exports the expected surface',
      run: (ctx) => {
        ctx.expect(typeof ensureLocalHttpsCerts).toBe('function');
        ctx.expect(typeof startLocalHttpsProxy).toBe('function');
        ctx.expect(typeof checkCertProblem).toBe('function');
        ctx.expect(typeof findCertPair).toBe('function');
        ctx.expect(typeof mkcertInstallHint).toBe('function');
        ctx.expect(typeof mkcertCaRootPem).toBe('function');
      },
    },

    // The root CA path is what a spawned process trusts through
    // NODE_EXTRA_CA_CERTS (#795), so "no mkcert" has to answer null rather than a
    // path that verifies nothing. The lookup is injected — no real mkcert runs.
    {
      name: 'mkcertCaRootPem: no mkcert on the host → null',
      run: (ctx) => {
        const answer = mkcertCaRootPem({ exec: () => { throw new Error('command not found: mkcert'); } });

        ctx.expect(answer).toBe(null);
      },
    },

    {
      name: 'mkcertCaRootPem: a CAROOT holding rootCA.pem → the joined path',
      run: (ctx) => {
        const dir = tmpDir('caroot');
        fs.writeFileSync(path.join(dir, 'rootCA.pem'), 'root-ca-bytes');

        ctx.expect(mkcertCaRootPem({ exec: () => `${dir}\n` })).toBe(path.join(dir, 'rootCA.pem'));
      },
    },

    {
      name: 'mkcertCaRootPem: a CAROOT without the root file → null',
      run: (ctx) => {
        const dir = tmpDir('caroot-empty');

        ctx.expect(mkcertCaRootPem({ exec: () => `${dir}\n` })).toBe(null);
      },
    },

    {
      name: 'mkcertCaRootPem: memoised — three call sites, one shell call',
      run: (ctx) => {
        const dir = tmpDir('caroot-memo');
        fs.writeFileSync(path.join(dir, 'rootCA.pem'), 'root-ca-bytes');

        let calls = 0;
        const exec = () => { calls += 1; return `${dir}\n`; };

        ctx.expect(mkcertCaRootPem({ exec })).toBe(path.join(dir, 'rootCA.pem'));
        ctx.expect(mkcertCaRootPem({ exec })).toBe(path.join(dir, 'rootCA.pem'));
        ctx.expect(calls, 'the second call answers from the memo').toBe(1);
      },
    },

    // The hint is the ONLY thing a host without mkcert gets, so it has to name a
    // manager that host actually has. Platform is an argument so all three branches
    // are pinned from one machine.
    {
      name: 'mkcertInstallHint: every platform gets its own manager',
      run: (ctx) => {
        ctx.expect(mkcertInstallHint('darwin')).toBe('brew install mkcert && mkcert -install');

        // Windows: Chocolatey IS the command; scoop is named after it, not spliced in.
        ctx.expect(mkcertInstallHint('win32').split('.')[0]).toBe('choco install mkcert && mkcert -install');
        ctx.expect(mkcertInstallHint('win32'), 'scoop is still named').toMatch(/scoop/i);

        // Linux, per mkcert's README: certutil from apt, mkcert from the release binary.
        ctx.expect(mkcertInstallHint('linux')).toMatch(/apt install libnss3-tools/);
        ctx.expect(mkcertInstallHint('linux')).toMatch(/github\.com\/FiloSottile\/mkcert\/releases/);

        for (const platform of ['darwin', 'win32', 'linux', 'freebsd']) {
          const hint = mkcertInstallHint(platform);
          ctx.expect(hint, `${platform} must still trust the CA`).toMatch(/mkcert -install/);
        }

        // The bug this replaces: every host was told `brew install mkcert`.
        for (const platform of ['win32', 'linux', 'freebsd']) {
          ctx.expect(mkcertInstallHint(platform), `${platform} has no Homebrew`).not.toMatch(/brew install/);
        }
      },
    },

    {
      name: 'mkcertInstallHint: the line OPENS with something pasteable',
      run: (ctx) => {
        // A reader copies the head of the line; an alternative buried inside the
        // command is a command that does not run.
        for (const platform of ['darwin', 'win32', 'linux']) {
          const head = mkcertInstallHint(platform).split('.')[0];
          ctx.expect(head, `${platform} splices an alternative into the command`).not.toMatch(/\(or\b|\bor:/);
        }
      },
    },

    {
      name: 'mkcertInstallHint: defaults to the host platform',
      run: (ctx) => {
        ctx.expect(mkcertInstallHint()).toBe(mkcertInstallHint(process.platform));
      },
    },

    {
      name: 'findCertPair: empty dir → null',
      run: (ctx) => {
        const dir = tmpDir('empty');
        ctx.expect(findCertPair(dir)).toBe(null);
      },
    },

    {
      name: 'checkCertProblem: garbage file → unreadable',
      run: (ctx) => {
        const dir = tmpDir('garbage');
        const file = path.join(dir, 'localhost.pem');
        fs.writeFileSync(file, 'not a certificate');
        ctx.expect(checkCertProblem(file)).toBe('unreadable certificate');
      },
    },

    {
      name: 'ensureLocalHttpsCerts: generates then reuses a pair',
      skip: !hasMkcert,
      run: async (ctx) => {
        const dir = tmpDir('gen');

        const first = await ensureLocalHttpsCerts({ certsDir: dir });
        ctx.expect(first, 'pair generated').toBeTruthy();
        ctx.expect(fs.existsSync(first.key), 'key file exists').toBeTruthy();
        ctx.expect(fs.existsSync(first.cert), 'cert file exists').toBeTruthy();
        ctx.expect(checkCertProblem(first.cert), 'fresh cert is usable').toBe(null);

        const logs = [];
        const second = await ensureLocalHttpsCerts({ certsDir: dir, log: (line) => logs.push(line) });
        ctx.expect(second.cert, 'same cert reused').toBe(first.cert);
        ctx.expect(logs.some((line) => line.includes('existing mkcert certificates')), 'reuse logged').toBeTruthy();
      },
    },

    {
      name: 'proxy round-trip: TLS in, plain http out, x-forwarded headers set',
      skip: !hasMkcert,
      run: async (ctx) => {
        const dir = tmpDir('proxy');
        const certs = await ensureLocalHttpsCerts({ certsDir: dir });
        ctx.expect(certs, 'certs available').toBeTruthy();

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

        ctx.expect(body).toBe('upstream-ok');
        ctx.expect(seen.url).toBe('/hello?x=1');
        ctx.expect(seen.proto).toBe('https');
        ctx.expect(seen.host).toBe(`localhost:${proxyPort}`);

        proxy.close();
        proxy.closeAllConnections?.();
        upstream.close();
        upstream.closeAllConnections?.();
      },
    },

    {
      name: 'plain http on the TLS port → 307 redirect to https (same host + path)',
      skip: !hasMkcert,
      run: async (ctx) => {
        const dir = tmpDir('redirect');
        const certs = await ensureLocalHttpsCerts({ certsDir: dir });
        ctx.expect(certs, 'certs available').toBeTruthy();

        // No upstream needed — the redirect answers at the front door
        const proxy = startLocalHttpsProxy({ port: 0, targetPort: 9, certs });
        await once(proxy, 'listening');
        const proxyPort = proxy.address().port;

        const res = await new Promise((resolve, reject) => {
          http.get(`http://localhost:${proxyPort}/payment/checkout?product=premium`, resolve).on('error', reject);
        });

        ctx.expect(res.statusCode, 'temporary, method-preserving redirect').toBe(307);
        ctx.expect(res.headers.location).toBe(`https://localhost:${proxyPort}/payment/checkout?product=premium`);
        res.resume();

        proxy.close();
      },
    },

    {
      name: 'proxy tunnels WebSocket upgrades (dev-server live-reload)',
      skip: !hasMkcert,
      run: async (ctx) => {
        const dir = tmpDir('ws');
        const certs = await ensureLocalHttpsCerts({ certsDir: dir });
        ctx.expect(certs, 'certs available').toBeTruthy();

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
      },
    },
  ],
});
