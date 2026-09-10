// serve — spawn `electron .` against the consumer project.
//
// Pass 2.0: minimum viable serve. Just launches Electron and pipes its stdio.
// Future passes will add: livereload websocket, watch + rebuild, renderer reload via webContents.reload(),
// main reload via app.relaunch().

const Manager = new (require('../../build.js'));
const logger = Manager.logger('serve');
const { spawn } = require('child_process');
const { watchEnvChain } = require('@omega.js/devkit/env-watch');

const projectRoot = Manager.getRootPath('project');

module.exports = function serve(done) {
  // N7: resolve livereload (and CDP when requested) through the allocator —
  // taken ports bump +1, so two targets of one brand (desktop + extension
  // serve) land on distinct ports automatically. Config `ports.*` pins.
  resolveServePorts()
    .then((ports) => start(ports, done))
    .catch(done);
};

async function resolveServePorts() {
  const { resolvePorts, envPort, CLASSIC_PORTS } = require('@omega.js/config');
  const configPins = Manager.getConfig()?.ports || {};

  const wanted = { livereload: envPort('livereload') || CLASSIC_PORTS.livereload };
  const pins = {};
  if (typeof configPins.livereload === 'number') pins.livereload = configPins.livereload;

  // CDP is opt-in (OMEGA_CDP_PORT set) — allocate it too instead of the old
  // "try port+1 manually" advice when 9222 is taken.
  const cdpRequested = !!process.env.OMEGA_CDP_PORT;
  if (cdpRequested) {
    wanted.cdp = envPort('cdp') || CLASSIC_PORTS.cdp;
    if (typeof configPins.cdp === 'number') pins.cdp = configPins.cdp;
  }

  const { ports, bumped } = await resolvePorts({ wanted, pins });
  process.env.OMEGA_LIVERELOAD_PORT = String(ports.livereload);
  if (cdpRequested) {
    process.env.OMEGA_CDP_PORT = String(ports.cdp);
  }
  if (bumped.length) {
    logger.log(`Ports bumped (classic taken): ${bumped.map((name) => `${name}→${ports[name]}`).join(', ')}`);
  }
  return ports;
}

// Resolve the electron package from the consumer project — it exports the path to
// the platform binary. Node resolution walks UP from projectRoot, so an npm-workspaces
// brand that hoists electron to the monorepo root resolves just as well as a target
// carrying its own copy.
function resolveElectron(projectRoot) {
  return require(require.resolve('electron', { paths: [projectRoot] }));
}

/**
 * The ENV lane's watcher (#681): every layer of the `.env` chain — company,
 * brand, this target — and each layer's `.env.<environment>` overlay. A change
 * reloads the cascade into process.env, and the log line names the FILE, never
 * a value. Resolution and watching live in @omega.js/devkit/env-watch, shared
 * with the web and extension dev lanes; this binds desktop's own target name.
 *
 * PRE-WIRING on desktop — it has NO consumer yet, and saying otherwise would be
 * a lie. Two reasons, both structural:
 *   1. The dev pipeline is `series(build, serve)` (gulp/main.js) — a ONE-SHOT
 *      build that has already finished before this arms. Desktop runs no
 *      watch+rebuild lane, so there is no "next rebuild" to read a new value.
 *   2. `start()` spawns electron with a `childEnv` SNAPSHOT of process.env, so
 *      a later reload in this gulp process cannot reach the running app.
 * It stays wired because it is the shared devkit bind and it costs one unref'd
 * watch; it becomes real the day desktop grows a watch+rebuild lane. Until
 * then, do not claim desktop in the reload-lane docs.
 *
 * Scope even once that lands (the shared contract): a NEW key AND an EDITED
 * value both land on the next rebuild, and a key dropped from the file is
 * dropped from the process — `reloadEnv` re-reads what a file layer owns
 * ([#724](https://github.com/Omega-JS-Stack/omega/issues/724)). A SHELL-set
 * value still wins over every file, whatever the file now says.
 *
 * `serve` is where it arms because it is the dev lane's only long-running task
 * — the build/package/publish series never include it, so a one-shot build
 * never opens a watch it would have to close.
 * @param {string} root - the target root
 * @param {object} [options]
 * @param {string} [options.environment] - the environment whose overlay counts
 * @returns {{ inputs: Array<{ layer: string, path: string }>, close: function }}
 */
function watchEnvSources(root, options) {
  return watchEnvChain({
    projectDir: root,
    target: 'desktop',
    environment: options && options.environment,
    log: (line) => logger.log(line),
  });
}

function start(ports, done) {
  const port = ports.livereload;
  logger.log(`serve — livereload port=${port}`);

  // PRE-WIRING, no consumer yet: the build above already ran one-shot and the
  // electron child below snapshots env at spawn. See watchEnvSources.
  watchEnvSources(projectRoot);

  // Resolve the electron binary from the consumer project (see resolveElectron).
  let electronBin;
  try {
    electronBin = resolveElectron(projectRoot);
  } catch (e) {
    logger.error(`Could not resolve electron from ${projectRoot} — no copy in the target or any parent node_modules.`);
    return done(e);
  }

  // Forward all --flags from process.argv to the Electron child. Chromium silently ignores
  // flags it doesn't recognize, so gulp's own (--cwd, --gulpfile, etc.) are harmless noise.
  // Usage: `npm start -- --remote-debugging-port=9222`
  // Shorthand: `OMEGA_CDP_PORT=9222 npm start`
  const extraArgs = process.argv.slice(2).filter(arg => arg.startsWith('--'));
  if (process.env.OMEGA_CDP_PORT && !extraArgs.some(a => a.startsWith('--remote-debugging-port'))) {
    extraArgs.push(`--remote-debugging-port=${process.env.OMEGA_CDP_PORT}`);
  }
  const electronArgs = ['.', ...extraArgs];

  logger.log(`Spawning electron: ${electronBin} ${electronArgs.join(' ')} (cwd=${projectRoot})`);

  const childEnv = Object.assign({}, process.env, {
    OMEGA_LIVERELOAD_PORT: String(port),
    // Force chalk to keep colors when stdout is a pipe; the tee strips them before writing
    // to the log file but the terminal still gets colored output.
    FORCE_COLOR: '1',
  });
  // Defensive scrub at the spawn (friction 17c): the gulp boundary strips it,
  // but a path that bypasses the boundary would make require('electron')
  // return the npm stub inside the target → crash at app.setName.
  delete childEnv.ELECTRON_RUN_AS_NODE;

  // Pipe stdio (instead of 'inherit') so our parent-process attach-log-file tee can capture
  // electron's stdout/stderr too. We forward each chunk to process.stdout/stderr.write, which
  // is the function the tee already wraps.
  const child = spawn(electronBin, electronArgs, {
    cwd:   projectRoot,
    stdio: ['inherit', 'pipe', 'pipe'],
    env:   childEnv,
  });

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  // If CDP was requested, verify the port came up after Electron boots.
  const cdpPort = (process.env.OMEGA_CDP_PORT || '').trim()
    || (extraArgs.find(a => a.startsWith('--remote-debugging-port=')) || '').split('=')[1];
  if (cdpPort) {
    setTimeout(() => {
      const http = require('http');
      const req = http.get(`http://127.0.0.1:${cdpPort}/json/version`, (res) => {
        let body = '';
        res.on('data', (d) => body += d);
        res.on('end', () => {
          try {
            const info = JSON.parse(body);
            logger.log(`CDP active on port ${cdpPort} — ${info.Browser || 'unknown'}`);
          } catch (_) {
            logger.log(`CDP active on port ${cdpPort}`);
          }
        });
      });
      req.on('error', () => {
        // The port was allocator-probed free before spawn, so a dead endpoint
        // means Electron itself didn't bring CDP up — not a port clash.
        logger.warn(`CDP port ${cdpPort} not responding — the app may not have remote debugging enabled`);
      });
      req.setTimeout(3000, () => { req.destroy(); });
    }, 5000);
  }

  child.on('exit', (code) => {
    logger.log(`electron exited with code ${code}`);
    // When electron quits, end the gulp task. In dev with watch this would re-spawn instead.
    done();
  });

  child.on('error', (err) => {
    logger.error('electron spawn error:', err);
    done(err);
  });
};

module.exports.resolveElectron = resolveElectron;
module.exports.watchEnvSources = watchEnvSources;
