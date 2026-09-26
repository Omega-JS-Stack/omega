#!/usr/bin/env node

/**
 * @omega.js/backend Test Runner Entry Point
 * This script is executed by the CLI test command inside the Firebase emulator
 * It reads configuration from OMEGA_TEST_CONFIG environment variable and runs the test suite
 */

// Mark this process as the test runner BEFORE loading any @omega.js/backend code.
// omega.initialize() reads it and skips the Firebase init, the Functions and
// server wiring and Sentry (none can run outside a real Functions runtime). This
// is what lets tests receive a fully-wired omega + ctx in their context.
process.env.OMEGA_TEST_RUNNER = '1';

const path = require('path');
const TestRunner = require('./runner.js');
const { noMatchExitCode } = require('@omega.js/devkit/test/scope');

async function main() {
  // Parse config from base64-encoded env var
  const configBase64 = process.env.OMEGA_TEST_CONFIG || '';
  const testConfig = configBase64
    ? JSON.parse(Buffer.from(configBase64, 'base64').toString('utf8'))
    : {};

  // Initialize Firebase Admin with emulator settings
  let admin = null;
  try {
    const firebaseAdmin = require('firebase-admin');

    // Check if already initialized
    if (firebaseAdmin.apps.length === 0) {
      // When running in emulator, we can initialize without credentials
      // The emulator environment variables tell it where to connect
      firebaseAdmin.initializeApp({
        projectId: process.env.GCLOUD_PROJECT || testConfig.cloud?.config?.projectId,
      });
    }
    admin = firebaseAdmin;
  } catch (error) {
    console.error('Warning: Could not initialize Firebase Admin:', error.message);
  }

  // Boot the real instance. With OMEGA_TEST_RUNNER set, initialize() loads config
  // and the services but skips what needs a Functions runtime (the Firebase
  // init, the function wiring, the custom server, Sentry). The instance and a
  // Context ride into every test context, so a test reads omega.email, ctx.ai
  // and new User() exactly like production code does: no per-test stub.
  let omega = null;
  let ctx = null;
  try {
    const projectDir = testConfig.projectDir || process.cwd();
    const Context = require('../omega/context.js');

    // The staged output tree (src/dist pillar): the same cwd the emulator's
    // function workers boot with, so config/SA resolve identically
    omega = require('../omega/index.js').initialize({ cwd: path.join(projectDir, 'dist') });
    ctx = new Context(omega, {}, { functionName: 'backend-test-runner', accept: 'json' });
  } catch (error) {
    console.error('Warning: Could not initialize @omega.js/backend for tests:', error.message);
  }

  // Create and run the test runner
  const runner = new TestRunner({
    ...testConfig,
    admin,
    omega,
    ctx,
  });

  const results = await runner.run();

  // Exit with appropriate code (a pre-flight abort ran zero tests: that is a
  // failure, and so is a target that named files and matched none, #814 — the
  // no-match answers with its own code, which is 1 standalone and distinct
  // inside a brand-root fan-out, so the manager can count it as a miss)
  if (results.noMatch) {
    process.exit(noMatchExitCode());
  }
  process.exit(results.failed > 0 || results.aborted ? 1 : 0);
}

main().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
