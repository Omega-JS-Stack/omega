// Build-layer pin for the background cache-warming flag: the background
// service worker's page cache is WRITE-ONLY (one caches.open, zero reads
// anywhere in the extension, and no context sends 'update-cache') — same
// verdict as the web SW, so updateCache is disabled behind a single
// re-enable flag. background.js is a browser-context ES module
// (importScripts at top level), so this pins the SOURCE text rather than
// importing it.

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'background.js'), 'utf8');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'background.js cache warming — disabled behind CACHE_WARMING_ENABLED',
  tests: [
    {
      name: 'the flag is declared off at module scope',
      run: (ctx) => {
        ctx.expect(SOURCE).toMatch(/const CACHE_WARMING_ENABLED = false;/);
      },
    },
    {
      name: 'updateCache early-returns behind the flag (machinery stays wired)',
      run: (ctx) => {
        ctx.expect(SOURCE).toMatch(/updateCache\(pages\) \{\s*if \(!CACHE_WARMING_ENABLED\) \{\s*return Promise\.resolve\(\);/);
        // The message command + the warm path survive for a one-flag re-enable
        ctx.expect(SOURCE).toMatch(/command === 'update-cache'/);
        ctx.expect(SOURCE).toMatch(/caches\.open\(this\.cache\.name\)/);
      },
    },
    {
      name: 'the cache stays write-only: exactly one open call, zero reads',
      run: (ctx) => {
        // Call-form regexes — the flag comment mentions caches.open in prose
        ctx.expect((SOURCE.match(/caches\.open\(/g) || []).length).toBe(1);
        ctx.expect(/caches\.match\(|cache\.match\(/.test(SOURCE)).toBe(false);
      },
    },
  ],
};
