/**
 * Per-step verdict log for the root e2e runners — a re-export, not a copy.
 *
 * The writer lives in `@omega.js/devkit/test/steps-log` because the journey
 * runner's steps live in devkit too (`src/test/journey-harness.js`), and a
 * package may never require up into the monorepo's root `scripts/`. One writer,
 * one format, both directions: see that module for the contract.
 */
module.exports = require('@omega.js/devkit/test/steps-log');
