#!/usr/bin/env node

/**
 * Refreshes the disposable email domain list into the GITIGNORED cache.
 *
 * The committed seed (`src/manager/libraries/email/data/disposable-domains.json`)
 * is never touched here — advance it deliberately with
 * `node scripts/promote-disposable-domains.js`. Contract + paths live in
 * `src/manager/libraries/email/disposable-domains.js`.
 *
 * Run manually:   node scripts/update-disposable-domains.js
 * Runs automatically on: npm prepare (prepare-package `before` hook)
 */
const { refresh } = require('../src/manager/libraries/email/disposable-domains');

async function main() {
  console.log('Fetching disposable domain list...');

  const { path, count } = await refresh();

  console.log(`Updated the disposable-domains cache (${count} domains): ${path}`);
}

main().catch((e) => {
  console.warn('Warning: Failed to update disposable domains:', e.message);
  console.warn('Using the existing cache/seed. Run manually later: node scripts/update-disposable-domains.js');
});
