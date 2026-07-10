/**
 * Monorepo watch orchestrator — `npm start` at the repo root.
 *
 * Runs every package's `prepare:watch` (src→dist rebuild-on-change)
 * CONCURRENTLY with per-package output prefixes. Only packages that build a
 * dist need one (backend, client, desktop, extension today — discovered, not
 * hardcoded); the rest serve src/ directly, so file:-linked consumers see
 * those edits live with no watch at all.
 *
 * Single-instance: takes the devkit watch lock (.omega/dev-watch.lock) so a
 * second `npm start` — or an `omega dev --local` session spawning the watch —
 * exits cleanly instead of double-watching.
 */

// Libraries
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { acquireWatchLock, releaseWatchLock } = require('@omega.js/devkit/local');

// Constants
const ROOT = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');

/**
 * Discover packages that declare a prepare:watch script.
 * @returns {Array<{name: string, dir: string}>}
 */
function discoverWatchable() {
  return fs.readdirSync(PACKAGES_DIR)
    .map((entry) => ({ name: entry, dir: path.join(PACKAGES_DIR, entry) }))
    .filter(({ dir }) => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        return Boolean(pkg.scripts && pkg.scripts['prepare:watch']);
      } catch (e) {
        return false;
      }
    });
}

function main() {
  const lock = acquireWatchLock(ROOT);
  if (!lock.acquired) {
    console.log(`Monorepo watch already running (pid ${lock.pid}) — nothing to do`);
    return;
  }

  const watchable = discoverWatchable();
  if (watchable.length === 0) {
    releaseWatchLock(ROOT);
    console.log('No packages declare a prepare:watch script — nothing to watch');
    return;
  }

  const pad = Math.max(...watchable.map(({ name }) => name.length));
  console.log(`Watching ${watchable.length} packages (src→dist): ${watchable.map(({ name }) => name).join(', ')}`);

  let shuttingDown = false;
  const children = [];
  for (const { name, dir } of watchable) {
    const child = spawn('npm', ['run', 'prepare:watch'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);

    const prefix = `[${name.padEnd(pad)}]`;
    const forward = (stream, log) => {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        for (const line of chunk.split('\n')) {
          if (line.trim()) {
            log(`${prefix} ${line}`);
          }
        }
      });
    };
    forward(child.stdout, console.log);
    forward(child.stderr, console.error);

    // A watch exiting is abnormal — announce it loudly but keep the others alive
    child.on('exit', (code, signal) => {
      if (!shuttingDown) {
        console.error(`${prefix} watch exited (${signal || `code ${code}`}) — restart with npm start`);
      }
    });
  }

  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log('\nStopping watches...');
    for (const child of children) {
      child.kill('SIGTERM');
    }
    releaseWatchLock(ROOT);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', () => releaseWatchLock(ROOT));
}

main();
