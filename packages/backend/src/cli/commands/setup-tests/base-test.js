/**
 * Base class for all setup tests
 * Each test should extend this class and implement the `run()` method
 */
class BaseTest {
  constructor(context) {
    this.context = context;
    this.self = context.main;
  }

  /**
   * demo-* project ids are EMULATOR-ONLY by convention — checks that touch
   * live Firebase gate on this (there is no live project to reach).
   * @returns {boolean}
   */
  get isDemoProject() {
    return String(this.self.projectId || '').startsWith('demo-');
  }

  /**
   * Re-stage functions/ from the authored tree. Fixes that write STAGED
   * INPUTS (the app manifest, .env, .nvmrc, service-account.json, config)
   * call this so the already-staged tree reflects the fix within the same
   * setup run — idempotent and cheap (src/dist pillar).
   */
  restage() {
    const { stageFunctions } = require('../../utils/stage-functions');
    stageFunctions({ projectDir: this.self.firebaseProjectPath });
  }

  /**
   * Override this method in each test
   * @returns {Promise<boolean>} True if test passes, false if it fails
   */
  async run() {
    throw new Error('Test must implement run() method');
  }

  /**
   * Override this method to provide a fix for failed tests
   * @returns {Promise<void>}
   */
  async fix() {
    throw new Error('No automatic fix available for this test');
  }

  /**
   * Override to provide warning details when run() returns 'warn'.
   * @returns {string[]}
   */
  getWarning() {
    return [];
  }

  /**
   * Get the test name (used for logging)
   * @returns {string}
   */
  getName() {
    return this.constructor.name.replace(/Test$/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  }
}

module.exports = BaseTest;
