/**
 * Registration guard — what this target actually deploys, and whether every
 * route it dispatches to still loads.
 *
 * The deployed surface is the FRAMEWORK's own (the `omega_*` functions
 * `Manager.init(exports, {})` registers) PLUS whatever `src/index.js` exports.
 * Nothing below is a hardcoded mirror of your tree:
 *
 *   1. The consumer functions and the route names they dispatch to are READ OUT
 *      OF `src/index.js` (as text), not listed here. A function you add there
 *      shows up in these assertions on its own.
 *   2. For each route name index.js dispatches, the handler is resolved the way
 *      `Middleware.run()` resolves it — `<routesDir>/<name>/<method>.js`, method
 *      file first, `index.js` fallback — and then REQUIRED, so a broken import
 *      in a route (an ESM-only dependency, a moved util) fails HERE rather than
 *      at cold start in production.
 *
 * `src/index.js` is read as TEXT, never required — requiring it boots the
 * Manager (Firebase Admin init, .env cascade, config load), which is exactly the
 * runtime dependency this lane avoids. That nothing in any of these requires
 * reaches the network is not taken on trust: the connect trap preloaded into
 * this process (test/_helpers/connect-trap.js) throws on the first DNS lookup
 * or TCP connect.
 *
 * Yours to extend: pin the resources a function needs (`runWith` memory and
 * timeout), the rewrites your published API paths depend on, and the schema
 * shape each route resolves. See `node_modules/@omega.js/backend/test/` for how
 * the framework does each of those.
 *
 *   node --require ./test/_helpers/connect-trap.js --test test/_unit/registration.test.js
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const APP_DIR = path.join(__dirname, '..', '..');
const SRC = path.join(APP_DIR, 'src');
const INDEX = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
const FIREBASE = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'firebase.json'), 'utf8'));

const FRAMEWORK_DIR = path.dirname(require.resolve('@omega.js/backend/package.json', { paths: [APP_DIR] }));

// The prefixes the framework's own registrations occupy. A consumer export
// wearing one would silently overwrite a framework function, or be overwritten
// by it — either way something stops deploying.
const RESERVED_PREFIXES = ['omega_', 'bm_'];

// The HTTP verbs Middleware.run() looks for as `<route>/<method>.js`.
const METHOD_FILES = ['get.js', 'post.js', 'put.js', 'patch.js', 'delete.js'];

/**
 * The consumer Cloud Functions index.js registers, read out of the source:
 * `exports.<name> = functions….run('<route>')`.
 * @returns {Array<{name: string, route: string}>}
 */
function consumerFunctions() {
  return [...INDEX.matchAll(/exports\.(\w+)\s*=([\s\S]*?);\n/g)].map((match) => ({
    name: match[1],
    route: (match[2].match(/\.run\(\s*'([^']+)'/) || [])[1],
  }));
}

test('index.js boots the framework from the package that is actually installed', () => {
  assert.match(INDEX, /require\('@omega\.js\/backend'\)/, 'index.js does not boot @omega.js/backend');
  assert.match(INDEX, /\.init\(exports,/, 'Manager.init(exports, …) is the bootstrap call');

  // The specifier index.js requires, resolved the way NODE resolves it FROM
  // src/ — the same lookup the deployed function performs at cold start. A
  // renamed dependency, a missing workspace link or a `file:` path off by a
  // directory all fail here instead of at boot.
  const resolved = require.resolve('@omega.js/backend', { paths: [SRC] });

  assert.ok(
    resolved.startsWith(FRAMEWORK_DIR + path.sep),
    `index.js's '@omega.js/backend' resolves to ${resolved}, outside the framework package`,
  );
});

test('no consumer function collides with the framework namespace', () => {
  for (const fn of consumerFunctions()) {
    for (const prefix of RESERVED_PREFIXES) {
      assert.ok(
        !fn.name.startsWith(prefix),
        `exports.${fn.name} takes the framework's reserved "${prefix}" prefix — one of the two functions will not deploy`,
      );
    }
  }
});

test('every route index.js dispatches to resolves and loads the way the middleware loads it', () => {
  // Middleware.run() resolves `path.resolve(<routesDir>, <route>)` and then
  // takes `<method>.js` if it exists, `index.js` otherwise. A function that
  // does not dispatch through `.run()` carries its handler inline — nothing to
  // resolve, so it is this test's business only if it names a route.
  for (const fn of consumerFunctions().filter((f) => f.route)) {
    const routeDir = path.resolve(SRC, 'routes', fn.route);
    assert.ok(fs.existsSync(routeDir), `src/routes/${fn.route}/ does not exist — the route answers 500`);

    const handlers = [...METHOD_FILES, 'index.js']
      .map((file) => path.join(routeDir, file))
      .filter((file) => fs.existsSync(file));

    assert.ok(
      handlers.length > 0,
      `src/routes/${fn.route}/ has no <method>.js and no index.js — every request answers 405`,
    );

    // Requiring is the point: a route's own imports are exercised here instead
    // of at cold start.
    for (const file of handlers) {
      const handler = require(file);

      assert.equal(typeof handler, 'function', `${path.relative(APP_DIR, file)} does not export a handler function`);
      assert.equal(handler.constructor.name, 'AsyncFunction', `${path.relative(APP_DIR, file)}'s handler is not async`);
    }
  }
});

test('src/ is the authored tree, so firebase deploys the staged dist/', () => {
  // `omega build` copies src/** → dist/** and firebase.json deploys dist/.
  assert.equal(FIREBASE.functions[0].source, 'dist', 'functions deploy from the staged dist/, never src/');
  assert.equal(FIREBASE.hosting.public, 'dist/public', 'hosting serves the staged public dir');
});

test('the omega_api rewrite still serves the framework prefixes, first', () => {
  const rewrites = FIREBASE.hosting.rewrites;
  const api = rewrites.find((r) => r.function === 'omega_api');

  assert.ok(api, 'no omega_api rewrite — every built-in route would 404');

  // Firebase hosting glob groups match a WHOLE path, so `/omega/**` alone would
  // not cover the bare `/omega` — each prefix is listed on its own as well.
  const alternatives = api.source.replace(/^\{|\}$/g, '').split(',');

  for (const prefix of ['/omega', '/omega/**']) {
    assert.ok(alternatives.includes(prefix), `the ${prefix} path is not routed to omega_api`);
  }

  // The omega rewrite has to stay FIRST: hosting takes the first match, and a
  // broader pattern above it would swallow the framework prefixes.
  assert.equal(rewrites[0].function, 'omega_api', 'the omega_api rewrite is no longer first');
});
