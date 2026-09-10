#!/usr/bin/env node

/**
 * @omega.js/backend Test Runner Entry Point
 * This script is executed by the CLI test command inside the Firebase emulator
 * It reads configuration from OMEGA_TEST_CONFIG environment variable and runs the test suite
 */

// Mark this process as the test runner BEFORE loading any @omega.js/backend code. Manager.init()
// auto-detects this and skips Firebase Functions / server / Sentry wiring (which
// can't run outside a real Functions runtime). This is what lets tests receive a
// fully-wired Manager + ctx in their context — no per-test stub.
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

  // Boot a real Manager. With OMEGA_TEST_RUNNER set, init() loads libraries +
  // resolves project config but skips the parts that need a Functions runtime
  // (handler wiring, server boot, Sentry, admin.initializeApp re-init).
  // The resulting Manager + ctx are passed into every test context, so
  // tests can call Manager.AI(), Manager.Email(), Manager.User(), etc. exactly
  // like production code does — no hand-rolled stubs.
  let Manager = null;
  let ctx = null;
  try {
    const projectDir = testConfig.projectDir || process.cwd();
    const BackendManager = require('../manager/index.js');
    Manager = new BackendManager();
    Manager.init(null, {
      // The staged output tree (src/dist pillar) — same cwd the emulator's
      // function workers boot with, so config/SA resolve identically
      cwd: path.join(projectDir, 'dist'),
      log: false,
    });
    ctx = Manager.RouteContext({}, { functionName: 'backend-test-runner', accept: 'json' });
  } catch (error) {
    console.error('Warning: Could not initialize @omega.js/backend Manager for tests:', error.message);
  }

  // Create and run the test runner
  const runner = new TestRunner({
    ...testConfig,
    admin,
    Manager,
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
