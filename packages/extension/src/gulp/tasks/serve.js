// Libraries
const Manager = new (require('../../build.js'));
const logger = Manager.logger('serve');
const path = require('path');
const WebSocket = require('ws');

// Load package
const package = Manager.getPackage('main');
const project = Manager.getPackage('project');
const config = Manager.getConfig('project');
const rootPathPackage = Manager.getRootPath('main');
const rootPathProject = Manager.getRootPath('project');

// Task
module.exports = function serve(complete) {
  // Log
  logger.log('Starting...');

  // N7: resolve the livereload port through the allocator — taken → +1, so
  // two targets of one brand (extension + desktop serve) land on distinct
  // ports automatically. Config `ports.livereload` pins (busy pin = error).
  // The resolved value publishes via OMEGA_LIVERELOAD_PORT BEFORE any build
  // task bakes it (webpack config chrome + package.js), so the built
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
