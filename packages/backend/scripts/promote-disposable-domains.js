#!/usr/bin/env node

/**
 * Advances the COMMITTED disposable-domain seed to whatever the refresh cache holds.
 *
 * This is the only thing that ever writes the tracked data file — run it when the
 * baseline should move, then commit the diff. Contract + paths live in
 * `src/manager/libraries/email/disposable-domains.js`.
 *
 * Run manually:   node scripts/promote-disposable-domains.js
 */
const { promote } = require('../src/manager/libraries/email/disposable-domains');

const { path, count } = promote();

console.log(`Promoted the disposable-domains cache into the seed (${count} domains): ${path}`);
console.log('Review and commit the diff.');
