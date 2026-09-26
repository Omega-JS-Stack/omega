/**
 * Custom-server mode (projectType `custom`, #584): the framework's and the
 * consumer's routes on one express app listening on PORT, for a container host.
 * Every route runs the same request pipeline the deployed `omega_api` does.
 */
const path = require('path');
const Context = require('./context.js');
const pipeline = require('./pipeline.js');
const { FRAMEWORK_ROUTES_DIR, FRAMEWORK_SCHEMAS_DIR } = require('./router.js');

// The HTTP method files a route directory may carry (index.js serves every method)
const METHOD_FILES = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

/**
 * Build the app, register every route, and listen.
 * @param {object} omega - the Omega instance (sets `omega.server` once listening, emits 'online').
 * @param {object} options - the initialize() options (routes, schemas, express.bodyParser).
 */
function start(omega, options) {
  const glob = require('glob').globSync;

  // Setup express
  const app = require('express')({
    logger: true,
  });

  // Setup body parser with configurable limits
  app.use(require('body-parser').json(options.express.bodyParser.json));
  app.use(require('body-parser').urlencoded(options.express.bodyParser.urlencoded));

  // Handle errors with custom error handler
  app.use((err, req, res, next) => {
    // A new ctx, because the pipeline has not run yet
    const ctx = new Context(omega, { req, res });

    // Handle PayloadTooLargeError from body-parser
    if (err.type === 'entity.too.large') {
      return ctx.respond('Request payload too large.', { code: 413 });
    }

    // Catch-all for other body-parser and middleware errors
    if (err) {
      // @TODO: REMOVE THIS LOG ONCE WE'RE CONFIDENT IT'S WORKING AS INTENDED
      console.log('@TODO: Custom Error Handler:', err);

      return ctx.respond(err.message || 'Bad request', { code: err.status || err.code || err.statusCode || 400 });
    }

    // If no error, continue
    next(err);
  });

  // The consumer's own trees, the pipeline's defaults (`<cwd>/routes`, `<cwd>/schemas`)
  const customRoutesPath = path.normalize(`${omega.cwd}/routes`);
  const customSchemasPath = path.normalize(`${omega.cwd}/schemas`);

  // The route table. The framework's routes mount under `/omega/` and a
  // consumer's at their own path, the same URL shape Firebase mode serves
  // (`omega_api` at `/omega/*`, a consumer function at its own rewrite), so the
  // two trees never collide and a consumer route never shadows the framework's.
  const routes = [];

  function _push(dir, isFramework) {
    // Get all files (index.js and method-specific files like get.js, post.js)
    glob('**/*.js', { cwd: dir })
    .forEach((file) => {
      const fileName = path.basename(file, '.js');
      const dirName = path.dirname(file);

      // Determine method and route name
      let method = 'all';
      let routeName;

      if (fileName === 'index') {
        // routes/restart/index.js -> restart; routes/index.js -> '' (the root path)
        routeName = dirName === '.' ? '' : dirName;
      } else if (METHOD_FILES.includes(fileName.toLowerCase())) {
        // routes/restart/get.js -> restart (GET only)
        method = fileName.toLowerCase();
        routeName = dirName === '.' ? '' : dirName;
      } else {
        // Unknown pattern, skip
        return;
      }

      // The framework's root route is `/omega`; a consumer's is `/`
      const mountPath = isFramework
        ? `/omega${routeName ? `/${routeName}` : ''}`
        : `/${routeName}`;

      routes.push({
        name: routeName,
        method: method,
        mountPath: mountPath,
        path: path.resolve(dir, file),
        isFramework: isFramework,
      });
    });
  }

  _push(path.normalize(FRAMEWORK_ROUTES_DIR), true);
  _push(customRoutesPath, false);

  routes.forEach((file) => {
    omega.logger.log(`Initializing route: ${file.method.toUpperCase()} ${file.mountPath} @ ${file.path}`);

    // Register the route with the appropriate HTTP method
    app[file.method](file.mountPath, async (req, res) => {
      return pipeline.cors(req, res, async () => {
        const runOptions = {
          routesDir: file.isFramework ? path.normalize(FRAMEWORK_ROUTES_DIR) : customRoutesPath,
          schemasDir: file.isFramework ? path.normalize(FRAMEWORK_SCHEMAS_DIR) : customSchemasPath,
        };

        // The root route (empty name) has no schema
        if (file.name) {
          runOptions.schema = file.name;
        } else {
          runOptions.validate = false;
        }

        pipeline.run(omega, file.name, req, res, runOptions);
      });
    });
  });

  // Run the server!
  const server = app.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' }, (error) => {
    if (error) {
      omega.logger.error(error);
      process.exit(1);
    }

    omega.server = { app, server };

    omega.emit('online', new Event('online'), server, app);
  });
}

module.exports = { start };
