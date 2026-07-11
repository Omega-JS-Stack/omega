const BaseCommand = require('./base-command');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk').default;
const powertools = require('node-powertools');
const jetpack = require('fs-jetpack');
const WatchCommand = require('./watch');

class ServeCommand extends BaseCommand {
  async execute() {
    const self = this.main;
    const projectDir = self.firebaseProjectPath;
    const { isPortFree, resolvePorts, writePortsFile, clearPortsFile } = require('@omega.js/config');
    const { loadEmulatorPorts } = require('./setup-tests/emulator-config.js');

    // HTTPS: proxy on the public port (classic 5002), firebase serve on an
    // internal port (classic 5443). Disable with --no-https.
    const httpsEnabled = self.argv.https !== false;

    // N7: allocate instead of killing the incumbent — a taken port bumps +1
    // (a second brand's serve just lands next door). An explicit --port (or
    // positional) PINS: busy = hard error, never a silent move.
    const flagPort = parseInt(self.argv.port || self.argv?._?.[1], 10) || null;
    const pins = {};
    if (flagPort) {
      if (!(await isPortFree(flagPort))) {
        throw new Error(`Port ${flagPort} (pinned via --port) is already in use — free it or pick another`);
      }
      pins.public = flagPort;
    }
    const { ports: servePorts, bumped } = await resolvePorts({
      wanted: {
        public: flagPort || loadEmulatorPorts(projectDir).hosting || 5000,
        internal: 5443,
      },
      pins,
    });
    const port = servePorts.public;
    const internalPort = servePorts.internal;
    if (bumped.length) {
      this.log(chalk.yellow(`  Ports bumped (classic taken): ${bumped.map((name) => `${name}→${servePorts[name]}`).join(', ')}\n`));
    }

    // Wipe stale firebase-tools debug logs + any leftover @omega.js/backend logs from older
    // versions. Keeps the project tree clean across runs.
    this.sweepStaleLogs();

    // Start @omega.js/backend watcher in background
    const watcher = new WatchCommand(self);
    watcher.startBackground();

    // Start HTTPS proxy if enabled. If certs can't be obtained, fall back to
    // plain HTTP — don't set OMEGA_HTTPS_PORT or redirect to the internal port.
    const httpsReady = httpsEnabled
      ? await this._startHttpsProxy(port, internalPort, projectDir)
      : false;

    // Start Stripe webhook forwarding in background, aimed at the port that
    // actually speaks plain http: the internal firebase-serve port under the
    // https proxy, the public port otherwise. (Pre-N7 it re-derived hosting
    // from firebase.json and pointed http at the TLS proxy — a dead target.)
    this.startStripeWebhookForwarding(httpsReady ? internalPort : port);

    // Publish the resolved map for siblings (N7): `omega dev` composes it
    // into the page chrome, so @omega.js/client's getApiUrl follows even a
    // bumped serve. `https` = the mkcert proxy, `hosting` = wherever hosting
    // speaks plain http. Retracted when the firebase child exits.
    writePortsFile(projectDir, httpsReady
      ? { https: port, hosting: internalPort }
      : { hosting: port });

    // Set up log file in the project directory.
    const logPath = this.getLogsPath('dev.log');
    const resetSentinelPath = this.getTempPath('dev.log.reset');
    const RELOAD_MARKER = /Using node@\d+ from host\./;
    const stripAnsi = (str) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

    let currentStream = fs.createWriteStream(logPath, { flags: 'w' });
    let reloadCount = 0;

    function rollLog() {
      try {
        const oldStream = currentStream;
        currentStream = fs.createWriteStream(logPath, { flags: 'w' });
        oldStream.end();
      } catch (e) {
        // Best-effort.
      }
    }

    function writeToLog(data) {
      if (currentStream && !currentStream.destroyed) {
        currentStream.write(stripAnsi(data.toString()));
      }
    }

    // Clean up any stale sentinel from a prior crashed serve run
    try { fs.unlinkSync(resetSentinelPath); } catch (e) { /* not present, ok */ }

    // Poll every 500ms for the reset sentinel
    const resetWatcher = setInterval(() => {
      if (!fs.existsSync(resetSentinelPath)) {
        return;
      }

      try {
        rollLog();
        fs.unlinkSync(resetSentinelPath);
      } catch (e) {
        // Best-effort.
      }
    }, 500);

    this.log(chalk.gray(`  Logs saving to: ${logPath}\n`));

    // Execute with tee to log file
    const firebasePort = httpsReady ? internalPort : port;
    const firebaseEnv = {
      ...process.env,
      FORCE_COLOR: '1',
    };

    if (httpsReady) {
      // Internal calls (getApiUrl → BEMClient) loop through the HTTPS proxy with a self-signed cert
      firebaseEnv.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      firebaseEnv.OMEGA_HTTPS_PORT = String(port);
    }
    // Where hosting speaks plain http (N7 env channel — functions inherit)
    firebaseEnv.OMEGA_HOSTING_PORT = String(firebasePort);

    try {
      await powertools.execute(`firebase serve --port ${firebasePort}`, {
        log: false,
        cwd: projectDir,
        config: {
          stdio: ['inherit', 'pipe', 'pipe'],
          env: firebaseEnv,
        },
      }, (child) => {
        child.stdout.on('data', (data) => {
          process.stdout.write(data);
          const text = data.toString();
          if (RELOAD_MARKER.test(text)) {
            reloadCount++;
            if (reloadCount > 1) {
              rollLog();
            }
          }
          writeToLog(data);
        });

        child.stderr.on('data', (data) => {
          process.stderr.write(data);
          writeToLog(data);
        });

        child.on('close', () => {
          clearInterval(resetWatcher);
          if (currentStream && !currentStream.destroyed) {
            currentStream.end();
          }
          try { fs.unlinkSync(resetSentinelPath); } catch (e) { /* ok */ }
          // Retract the published port map (clean shutdown)
          clearPortsFile(projectDir);
        });
      });
    } catch (error) {
      this.log(chalk.gray('\n  Server stopped.\n'));
    }
  }

  async _startHttpsProxy(httpsPort, httpPort, projectDir) {
    const https = require('https');
    const http = require('http');

    const certs = await this._getHttpsCerts(projectDir);

    if (!certs) {
      this.log(chalk.yellow('  HTTPS disabled — could not obtain certificates.'));
      this.log(chalk.yellow('  Install mkcert for trusted local HTTPS: brew install mkcert && mkcert -install\n'));
      return false;
    }

    const options = {
      key: fs.readFileSync(certs.key),
      cert: fs.readFileSync(certs.cert),
    };

    const proxy = https.createServer(options, (clientReq, clientRes) => {
      const proxyOpts = {
        hostname: 'localhost',
        port: httpPort,
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

    proxy.listen(httpsPort, () => {
      this.log(chalk.green(`  HTTPS proxy listening on https://localhost:${httpsPort}`));
      this.log(chalk.gray(`  Forwarding to http://localhost:${httpPort} (firebase serve)\n`));
    });

    proxy.on('error', (err) => {
      this.log(chalk.red(`  HTTPS proxy error: ${err.message}`));
    });

    return true;
  }

  async _getHttpsCerts(projectDir) {
    const tempDir = this.getTempPath();

    const certsDir = path.join(tempDir, 'certs');
    jetpack.dir(certsDir);

    // Check if mkcert certificates already exist
    const certFiles = (jetpack.find(certsDir, { matching: 'localhost*.pem' }) || []);
    const keyFile = certFiles.find((f) => f.includes('-key.pem'));
    const certFile = certFiles.find((f) => !f.includes('-key.pem'));

    if (keyFile && certFile) {
      const problem = this._checkCertProblem(certFile);

      if (!problem) {
        this.log(chalk.gray('  Using existing mkcert certificates from .temp/certs/'));
        return { key: keyFile, cert: certFile };
      }

      // Stale certs (expired, or issued by a DIFFERENT machine's mkcert CA — e.g.
      // .temp copied over from another Mac) make browsers reject the proxy outright,
      // so the only thing that responds is the internal plain-HTTP firebase port.
      // Wipe and regenerate against THIS machine's trusted CA.
      this.log(chalk.yellow(`  Existing certificates are not usable (${problem}) — regenerating...`));
      jetpack.remove(certsDir);
      jetpack.dir(certsDir);
    }

    // Try to generate with mkcert
    return this._generateMkcertCerts(certsDir);
  }

  // Returns a reason string when the existing cert must be regenerated, or null
  // when it's usable: unexpired AND signed by this machine's trusted mkcert root CA.
  _checkCertProblem(certFile) {
    const { X509Certificate } = require('crypto');
    const { execSync } = require('child_process');

    let cert;
    try {
      cert = new X509Certificate(fs.readFileSync(certFile));
    } catch (e) {
      return 'unreadable certificate';
    }

    if (new Date(cert.validTo) <= new Date()) {
      return `expired ${cert.validTo}`;
    }

    // Verify the signature chains to the CURRENT mkcert root CA. If mkcert (or its
    // root) isn't available we can't verify — keep the existing certs rather than
    // breaking the no-mkcert fallback path.
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

  async _generateMkcertCerts(certsDir) {
    try {
      await powertools.execute('which mkcert', { log: false });
    } catch (e) {
      this.log(chalk.yellow('  mkcert not found. Install with: brew install mkcert && mkcert -install'));
      return null;
    }

    try {
      await powertools.execute('mkcert -install', { log: false });
    } catch (e) {
      // CA may already be installed
    }

    this.log(chalk.gray('  Generating mkcert certificates...'));

    // Get local network IP for the cert SAN
    const os = require('os');
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
      await powertools.execute(`cd "${certsDir}" && mkcert ${hosts.join(' ')}`, { log: false });

      const certFiles = (jetpack.find(certsDir, { matching: 'localhost*.pem' }) || []);
      const keyFile = certFiles.find((f) => f.includes('-key.pem'));
      const certFile = certFiles.find((f) => !f.includes('-key.pem'));

      if (keyFile && certFile) {
        this.log(chalk.green('  Trusted HTTPS certificates generated in .temp/'));
        return { key: keyFile, cert: certFile };
      }

      return null;
    } catch (e) {
      this.log(chalk.yellow(`  Failed to generate certificates: ${e.message}`));
      return null;
    }
  }
}

module.exports = ServeCommand;
