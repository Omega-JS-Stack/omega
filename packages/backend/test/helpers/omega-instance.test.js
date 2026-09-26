/**
 * Test: the package's main export, the Omega instance, and what initialize()
 * leaves on it
 *
 * The consumer contract is one line and one export:
 *
 *   const omega = require('@omega.js/backend'); omega.initialize({ ... });
 *   module.exports = omega.functions;
 *
 * so what this file pins is exactly what a consumer leans on: the main export
 * IS the instance (a consumer never writes `new`), initialize() is synchronous
 * and hands the instance back, the instance carries the core and the process
 * services, `User` mints its ids with the backend's generators once booted,
 * and the request pipeline is one ordered list of named steps.
 *
 * Every boot is a FRESH `new Omega()` against the bundled fixture (under
 * OMEGA_TEST_RUNNER, as the runner boots), never the singleton, so the file
 * runs with or without an emulator and never disturbs the runner's instance.
 *
 * Run: npx omega test backend:helpers/omega-instance
 */
const assert = require('node:assert');
const omega = require('../../dist/omega/index.js');
const pipeline = require('../../dist/omega/pipeline.js');
const { User } = require('../../dist/omega/helpers/account.js');
const { bootOmega } = require('./_boot-omega.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RANDOM_ID_8 = /^[A-Za-z0-9]{8}$/;
const API_KEY = /^[A-Za-z0-9]{40,50}$/;

let booted = null;
const fresh = () => (booted = booted || bootOmega());

module.exports = defineCases({
  description: 'the Omega instance: the export, initialize(), the members, the generators, the pipeline',
  type: 'group',

  tests: [
    {
      name: 'the-main-export-is-the-instance-and-Omega-its-constructor',
      async run() {
        assert.equal(typeof omega.Omega, 'function', 'the class rides the export by name');
        assert.equal(omega instanceof omega.Omega, true, 'the export is an instance of it');
        assert.equal(omega.constructor, omega.Omega);
        assert.equal(typeof omega.initialize, 'function');
      },
    },

    {
      name: 'initialize-is-synchronous-and-returns-the-instance',
      async run() {
        const instance = new omega.Omega();
        const returned = bootOmega(instance);

        assert.equal(returned, instance, 'initialize() hands the same instance back');
        assert.equal(typeof returned.then, 'undefined', 'and not a promise: Firebase reads the exports at module load');
      },
    },

    {
      name: 'the-booted-instance-carries-the-core-and-the-process-services',
      async run() {
        const instance = fresh();
        const members = ['config', 'env', 'logger', 'version', 'cwd', 'project', 'package', 'firebase', 'functions', 'handlers', 'utilities', 'email', 'ai'];

        for (const member of members) {
          assert.notEqual(instance[member], undefined, `omega.${member} is set`);
        }

        assert.equal(typeof instance.storage, 'function', 'omega.storage(options) is a method');
        assert.equal(typeof instance.routes.run, 'function', 'omega.routes.run(name, { req, res }, options) is the route entry');
        assert.equal(typeof instance.events.run, 'function', 'omega.events.run(name, payload) is the event entry');
        assert.equal(typeof instance.config.resolved, 'object', 'config.resolved rides the config');
        assert.equal(typeof instance.firebase.admin.initializeApp, 'function', 'firebase.admin is the Admin SDK');
        assert.equal('app' in instance.firebase, true, 'firebase.app is declared');
        assert.equal(typeof instance.firebase.functions.runWith, 'function', 'firebase.functions is the SDK in firebase mode');
        assert.deepEqual(Object.keys(instance.functions), [], 'the test runner wires no Cloud Functions');
      },
    },

    {
      name: 'the-retired-surface-is-gone',
      async run() {
        const instance = fresh();

        for (const member of ['libraries', '_internal', 'interface', 'install', 'debug', 'init', 'RouteContext', 'Middleware', 'Utilities', 'User', 'Email', 'AI']) {
          assert.equal(instance[member], undefined, `omega.${member} is retired`);
        }

        assert.equal(instance.run, undefined, 'omega.run is omega.routes.run now, no alias');
        assert.equal(instance.runEvent, undefined, 'omega.runEvent is omega.events.run now, no alias');
        assert.equal(omega.Omega.config, undefined, 'no static config');
        assert.equal(omega.Omega.require, undefined, 'no static require: omega.require is the one');
        assert.equal(typeof instance.require, 'function');
      },
    },

    {
      name: 'routes-run-hands-the-payload-req-and-res-to-the-pipeline',
      async run() {
        const instance = fresh();
        const req = { path: '/items' };
        const res = {};
        const original = pipeline.run;
        let received = null;

        // The pipeline module is the one the instance calls through, so its run
        // is swapped for the call only and restored after
        pipeline.run = (...args) => { received = args; return 'piped'; };

        try {
          const returned = instance.routes.run('items', { req, res }, { validate: false });

          assert.equal(returned, 'piped', 'the pipeline\'s answer comes back');
          assert.deepEqual(received, [instance, 'items', req, res, { validate: false }], 'the instance, the name, the payload\'s req and res, the options');
          assert.equal(received[2], req, 'the same req');
          assert.equal(received[3], res, 'the same res');
        } finally {
          pipeline.run = original;
        }

        assert.throws(() => instance.routes.run('items', { req }), /omega\.routes\.run\('items', \{ req, res \}\) needs both req and res/, 'a missing res throws by name');
        assert.throws(() => instance.routes.run('items'), /needs both req and res/, 'and so does a missing payload');
      },
    },

    {
      name: 'User-mints-ids-with-the-backend-generators-once-booted',
      async run() {
        fresh();

        const { uuid, randomId, apiKey } = User.generators;

        assert.match(uuid(), UUID_V4, 'uuid is a v4 uuid');
        assert.match(randomId(), RANDOM_ID_8, 'randomId is an 8-char alphanumeric id');
        assert.match(apiKey(), API_KEY, 'apiKey is a uid-generator token');

        const user = new User();

        assert.match(user.api.clientId, UUID_V4, 'a new account mints its clientId');
        assert.match(user.api.privateKey, API_KEY, 'and its privateKey');
      },
    },

    {
      name: 'the-pipeline-is-one-ordered-list-of-named-steps',
      async run() {
        assert.deepEqual(pipeline.STEPS.map((step) => step.name), [
          'guardRoutePath',
          'guardDevOnly',
          'resolveOptions',
          'parseMultipart',
          'logRequest',
          'wakeup',
          'loadHandler',
          'authenticate',
          'attachUsage',
          'logUser',
          'attachAnalytics',
          'resolveData',
          'trim',
          'sanitize',
          'runHandler',
        ]);
      },
    },
  ],
});
