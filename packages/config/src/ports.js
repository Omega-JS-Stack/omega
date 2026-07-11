/**
 * Port auto-allocation (N7) — classic defaults, probe at boot, bump-if-taken.
 *
 * The allocator is boot-time only: when the classic defaults are free (the
 * single-brand case) resolution returns them untouched and dev behaves
 * exactly as it always has. When a port is taken (a second brand's stack is
 * up), that port bumps +1 until free — per port, with a shared claimed-set so
 * two names never land on the same number.
 *
 * The RESOLVED map publishes two ways (the CLI that booted the stack owns
 * both): a ports file (`<projectDir>/.temp/ports.json`, pid-stamped, deleted
 * on clean shutdown) for sibling processes of the same brand, and
 * `OMEGA_<NAME>_PORT` env vars injected into spawned children for URL
 * getters. Browser code receives `dev.ports` via the injected dev config —
 * it can read neither env nor files.
 *
 * Explicit pins (config `ports` section) never bump: a pinned port that is
 * busy is a hard error naming the pin, because the user asked for exactly
 * that port.
 */

const fs = require('fs');
const net = require('net');
const path = require('path');

// The classic defaults every framework has always used — allocation starts
// here, and single-brand dev never leaves them.
const CLASSIC_PORTS = {
  auth: 9099,
  functions: 5001,
  firestore: 8080,
  database: 9000,
  hosting: 5002,
  storage: 9199,
  pubsub: 8085,
  ui: 4050,
  website: 4000,
  livereload: 35729,
  cdp: 9222,
};

const PORTS_FILE = 'ports.json';

/**
 * Can we bind this port on 127.0.0.1? (Bind-probe, not connect-probe — a
 * server bound to 0.0.0.0 fails the bind even though connect-probing from
 * another interface might miss it.)
 * @param {number} port - Port to probe.
 * @returns {Promise<boolean>} True when the port is free.
 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Resolve a port map: each wanted port keeps its value when free, bumps +1
 * until free when taken. Pinned ports (explicit config) never bump — busy
 * pin throws.
 *
 * @param {object} options
 * @param {object} options.wanted - Name → desired port (usually the classic
 *   defaults or a brand's firebase.json values).
 * @param {object} [options.pins] - Name → explicitly-configured port (config
 *   `ports` section). Pinned names use the pin verbatim; busy → throw.
 * @param {Set<number>} [options.claimed] - Ports already claimed in this
 *   process run (shared across resolvePorts calls for multi-family boots).
 * @returns {Promise<{ ports: object, bumped: string[] }>} Resolved map + the
 *   names that moved off their wanted value.
 */
async function resolvePorts({ wanted, pins = {}, claimed = new Set() }) {
  const ports = {};
  const bumped = [];

  for (const [name, wantedPort] of Object.entries(wanted)) {
    const pin = pins[name];

    if (typeof pin === 'number') {
      if (claimed.has(pin) || !(await isPortFree(pin))) {
        throw new Error(`Port ${pin} (pinned via config ports.${name}) is already in use — free it or change the pin`);
      }
      ports[name] = pin;
      claimed.add(pin);
      continue;
    }

    let candidate = wantedPort;
    while (claimed.has(candidate) || !(await isPortFree(candidate))) {
      candidate += 1;
    }

    if (candidate !== wantedPort) {
      bumped.push(name);
    }
    ports[name] = candidate;
    claimed.add(candidate);
  }

  return { ports, bumped };
}

/**
 * Publish the resolved map for sibling processes of the same brand.
 * @param {string} projectDir - The project directory (owns `.temp/`).
 * @param {object} ports - Resolved name → port map.
 * @returns {string} The file path written.
 */
function writePortsFile(projectDir, ports) {
  const dir = path.join(projectDir, '.temp');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, PORTS_FILE);
  fs.writeFileSync(file, JSON.stringify({ ports, pid: process.pid, startedAt: new Date().toISOString() }, null, 2));
  return file;
}

/**
 * Read a live ports file. Returns null when absent, unparseable, or stale
 * (the writing process is no longer running).
 * @param {string} projectDir - The project directory.
 * @returns {object|null} The resolved name → port map, or null.
 */
function readPortsFile(projectDir) {
  const file = path.join(projectDir, '.temp', PORTS_FILE);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.ports) {
    return null;
  }

  // Stale check: the allocator deletes the file on clean shutdown, so a
  // surviving file with a dead pid is a crash leftover — ignore it.
  if (parsed.pid) {
    try {
      process.kill(parsed.pid, 0);
    } catch (error) {
      return null;
    }
  }

  return parsed.ports;
}

/**
 * Remove the ports file (clean shutdown).
 * @param {string} projectDir - The project directory.
 */
function clearPortsFile(projectDir) {
  try {
    fs.unlinkSync(path.join(projectDir, '.temp', PORTS_FILE));
  } catch (error) {
    // Absent is fine.
  }
}

/**
 * Env-var name for a port ('auth' → 'OMEGA_AUTH_PORT').
 * @param {string} name - Port name.
 * @returns {string} Env var name.
 */
function envName(name) {
  return `OMEGA_${name.toUpperCase()}_PORT`;
}

/**
 * Resolved map → the OMEGA_*_PORT env block to inject into spawned children.
 * @param {object} ports - Resolved name → port map.
 * @returns {object} Env var name → string port.
 */
function portsToEnv(ports) {
  const env = {};
  for (const [name, port] of Object.entries(ports)) {
    env[envName(name)] = String(port);
  }
  return env;
}

/**
 * Read a port from the environment (`OMEGA_<NAME>_PORT`).
 * @param {string} name - Port name ('auth', 'hosting', ...).
 * @param {object} [env] - Env object (defaults to process.env).
 * @returns {number|null} The port, or null when unset/invalid.
 */
function envPort(name, env = process.env) {
  const raw = env[envName(name)];
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && port > 0 ? port : null;
}

module.exports = {
  CLASSIC_PORTS,
  isPortFree,
  resolvePorts,
  writePortsFile,
  readPortsFile,
  clearPortsFile,
  envName,
  portsToEnv,
  envPort,
};
