// Libraries
const Manager = new (require('../../build.js'));
const logger = Manager.logger('serve');
const path = require('path');
const WebSocket = require('ws');
const { watchEnvChain } = require('@omega.js/devkit/env-watch');

// Load package
const package = Manager.getPackage('main');
const project = Manager.getPackage('project');
const config = Manager.getConfig('project');
const rootPathPackage = Manager.getRootPath('main');
const rootPathProject = Manager.getRootPath('project');

/**
 * The ENV lane's watcher (#681): every layer of the `.env` chain — company,
 * brand, this target — and each layer's `.env.<environment>` overlay. A change
 * reloads the cascade into process.env, so the next task rebuild (the sass /
 * bundle / package watchers all re-run in THIS process) reads the new values.
 * The log line names the FILE, never a value. Resolution and watching live in
 * @omega.js/devkit/env-watch, shared with the web and desktop dev lanes; this
 * binds the extension's own target name.
 *
 * Scope, exactly: a NEW key AND an EDITED value both land on that next rebuild,
 * and a key dropped from the file is dropped from the process — `reloadEnv`
 * re-reads what a file layer owns
 * ([#724](https://github.com/Omega-JS-Stack/omega/issues/724)). A SHELL-set
 * value still wins over every file, whatever the file now says.
 *
 * `serve` is where it arms because it is the dev lane's only task — the build
 * series never includes it, so a one-shot build never opens a watch it would
 * have to close.
 * @param {string} root - the target root
 * @param {object} [options]
 * @param {string} [options.environment] - the environment whose overlay counts
 * @returns {{ inputs: Array<{ layer: string, path: string }>, close: function }}
 */
function watchEnvSources(root, options) {
  return watchEnvChain({
    projectDir: root,
    target: 'extension',
    environment: options && options.environment,
    log: (line) => logger.log(line),
  });
}

// Task
module.exports = function serve(complete) {
  // Log
  logger.log('Starting...');

  // The .env chain is a dev INPUT too (#681)
  watchEnvSources(rootPathProject);

  // N7: resolve the livereload port through the allocator — taken → +1, so
  // two targets of one brand (extension + desktop serve) land on distinct
  // ports automatically. Config `ports.livereload` pins (busy pin = error).
  // The resolved value publishes via OMEGA_LIVERELOAD_PORT BEFORE any build
  // task bakes it (the bundle task's replacements + package.js), so the built
  // extension always connects to THIS server.
  const { resolvePorts, envPort, CLASSIC_PORTS } = require('@omega.js/config');
  const pins = {};
  if (typeof config.ports?.livereload === 'number') {
    pins.livereload = config.ports.livereload;
  }

  return resolvePorts({ wanted: { livereload: envPort('livereload') || CLASSIC_PORTS.livereload }, pins })
    .then(({ ports, bumped }) => {
      process.env.OMEGA_LIVERELOAD_PORT = String(ports.livereload);
      if (bumped.length) {
        logger.log(`LiveReload port bumped to ${ports.livereload} (classic taken — another target's serve?)`);
      }

      try {
        // Get the local URL
        const server = new WebSocket.Server({ port: ports.livereload })

        // Log
        logger.log(`LiveReload server started on port ${ports.livereload}`);

        // Log connection
        server.on('connection', (socket, request) => {
          logger.log(`LiveReload client connected from local IP: ${request.socket.localAddress}`);
        });

        // Handle errors
        server.on('error', (error) => {
          logger.error('WebSocket error:', error);
        });

        // Set server
        global.websocket = server;
      } catch (error) {
        // Log error
        logger.error('Error starting LiveReload server:', error);
      }

      // Complete
      return complete();
    });
};

module.exports.watchEnvSources = watchEnvSources;
