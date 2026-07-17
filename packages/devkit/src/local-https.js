/**
 * Local HTTPS for dev servers (mkcert) — the shared mechanism behind
 * `omega serve` / `omega emulator` (backend) and `omega dev` (web):
 * the PUBLIC port speaks TLS through a forwarding proxy while the real
 * server sits on an internal plain-http port.
 *
 * - ensureLocalHttpsCerts({ certsDir, log }) → { key, cert } | null
 *   Reuses mkcert certificates from certsDir when they're usable; stale
 *   ones (expired, or issued by a DIFFERENT machine's mkcert CA — e.g. a
 *   .temp copied over from another Mac) are wiped and regenerated against
 *   THIS machine's trusted CA. No mkcert installed → null, and callers
 *   fall back to plain http.
 *
 * - startLocalHttpsProxy({ port, targetPort, certs, log }) → https.Server
 *   TLS terminator forwarding every request to localhost:targetPort with
 *   x-forwarded-proto/host set. WebSocket upgrades tunnel as raw sockets
 *   (dev-server live-reload keeps working through the proxy).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');
const jetpack = require('fs-jetpack');

const NOOP = () => {};

/**
 * Find-or-generate mkcert certificates in certsDir.
 * @param {object} options
 * @param {string} options.certsDir - Where the localhost*.pem pair lives
 * @param {function} [options.log] - Line logger
 * @returns {Promise<{ key: string, cert: string } | null>} Cert file paths, or null when unobtainable
 */
async function ensureLocalHttpsCerts({ certsDir, log = NOOP }) {
  jetpack.dir(certsDir);

  // Check if mkcert certificates already exist
  const existing = findCertPair(certsDir);

  if (existing) {
    const problem = checkCertProblem(existing.cert);

    if (!problem) {
      log(`Using existing mkcert certificates from ${path.basename(path.dirname(certsDir))}/${path.basename(certsDir)}/`);
      return existing;
    }

    // Unusable certs make browsers reject the proxy outright — wipe and
    // regenerate against this machine's trusted CA.
    log(`Existing certificates are not usable (${problem}) — regenerating...`);
    jetpack.remove(certsDir);
    jetpack.dir(certsDir);
  }

  return generateMkcertCerts(certsDir, log);
}

/**
 * Locate the mkcert localhost pair in a directory.
 * @param {string} certsDir
 * @returns {{ key: string, cert: string } | null}
 */
function findCertPair(certsDir) {
  const certFiles = (jetpack.find(certsDir, { matching: 'localhost*.pem' }) || []);
  const key = certFiles.find((f) => f.includes('-key.pem'));
  const cert = certFiles.find((f) => !f.includes('-key.pem'));

  return key && cert ? { key, cert } : null;
}

/**
 * Returns a reason string when the existing cert must be regenerated, or null
 * when it's usable: unexpired AND signed by this machine's trusted mkcert root CA.
 * @param {string} certFile
 * @returns {string | null}
 */
function checkCertProblem(certFile) {
  const { X509Certificate } = require('crypto');

  let cert;
  try {
    cert = new X509Certificate(fs.readFileSync(certFile));
  } catch (e) {
    return 'unreadable certificate';
  }

  if (new Date(cert.validTo) <= new Date()) {
    return `expired ${cert.validTo}`;
  }

  // Verify the signature chains to the CURRENT mkcert root CA. If mkcert (or
  // its root) isn't available we can't verify — keep the existing certs rather
  // than breaking the no-mkcert fallback path.
  try {
    const caRoot = execSync('mkcert -CAROOT', { encoding: 'utf8' }).trim();
    const ca = new X509Certificate(fs.readFileSync(path.join(caRoot, 'rootCA.pem')));

    if (!cert.verify(ca.publicKey)) {
      const issuerCN = cert.issuer.split('\n').find((line) => line.startsWith('CN=')) || cert.issuer;
      return `issued by a different CA (${issuerCN})`;
    }
  } catch (e) {
    return null;
  }

  return null;
}

/**
 * Generate a fresh localhost cert pair with mkcert (SANs: localhost,
 * loopbacks, and the machine's LAN IPv4s so phones on the same network work).
 * @param {string} certsDir
 * @param {function} log
 * @returns {{ key: string, cert: string } | null}
 */
function generateMkcertCerts(certsDir, log = NOOP) {
  try {
    execSync('which mkcert', { stdio: 'pipe' });
  } catch (e) {
    log('mkcert not found. Install with: brew install mkcert && mkcert -install');
    return null;
  }

  try {
    execSync('mkcert -install', { stdio: 'pipe' });
  } catch (e) {
    // CA may already be installed
  }

  log('Generating mkcert certificates...');

  const hosts = ['localhost', '127.0.0.1', '::1'];
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (!iface.internal && iface.family === 'IPv4') {
        hosts.push(iface.address);
        break;
      }
    }
  }

  try {
    execSync(`mkcert ${hosts.join(' ')}`, { cwd: certsDir, stdio: 'pipe' });

    const pair = findCertPair(certsDir);
    if (pair) {
      log('Trusted HTTPS certificates generated');
    }

    return pair;
  } catch (e) {
    log(`Failed to generate certificates: ${e.message}`);
    return null;
  }
}

/**
 * Start the TLS-terminating forwarder: https://localhost:port →
 * http://localhost:targetPort. Handles plain requests AND WebSocket
 * upgrades (raw tunnel), so dev-server live-reload sockets survive.
 * @param {object} options
 * @param {number} options.port - Public TLS port
 * @param {number} options.targetPort - Internal plain-http port
 * @param {{ key: string, cert: string }} options.certs - Cert file paths
 * @param {function} [options.log] - Line logger
 * @returns {import('https').Server}
 */
function startLocalHttpsProxy({ port, targetPort, certs, log = NOOP }) {
  const options = {
    key: fs.readFileSync(certs.key),
    cert: fs.readFileSync(certs.cert),
  };

  const proxy = https.createServer(options, (clientReq, clientRes) => {
    const proxyOpts = {
      hostname: 'localhost',
      port: targetPort,
      path: clientReq.url,
      method: clientReq.method,
      headers: {
        ...clientReq.headers,
        'x-forwarded-proto': 'https',
        'x-forwarded-host': clientReq.headers.host,
      },
    };

    const proxyReq = http.request(proxyOpts, (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(clientRes, { end: true });
    });

    proxyReq.on('error', (err) => {
      clientRes.writeHead(502);
      clientRes.end(`Proxy error: ${err.message}`);
    });

    clientReq.pipe(proxyReq, { end: true });
  });

  // WebSocket upgrades (dev-server live-reload): replay the handshake at the
  // target and splice the sockets — rawHeaders preserves case + duplicates.
  proxy.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(targetPort, 'localhost', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      upstream.write(lines.join('\r\n') + '\r\n\r\n');

      if (head && head.length) {
        upstream.write(head);
      }

      socket.pipe(upstream);
      upstream.pipe(socket);
    });

    // Either side going away (error OR clean close) releases the other —
    // without this, half-open tunnels strand sockets on every closed tab
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
  });

  proxy.listen(port, () => {
    log(`HTTPS proxy listening on https://localhost:${port}`);
    log(`Forwarding to http://localhost:${targetPort}`);
  });

  proxy.on('error', (err) => {
    log(`HTTPS proxy error: ${err.message}`);
  });

  return proxy;
}

module.exports = {
  ensureLocalHttpsCerts,
  startLocalHttpsProxy,
  checkCertProblem,
  findCertPair,
  generateMkcertCerts,
};
