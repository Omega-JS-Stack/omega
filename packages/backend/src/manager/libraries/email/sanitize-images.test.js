/**
 * sanitizeImagesForEmail test — brand.images stores SITE-RELATIVE paths (the
 * website absolutizes per environment); email clients can only fetch public
 * URLs, so the sanitizer must join relatives against brand.url AND keep the
 * svg→png email-client conversion.
 *
 * Plain-node unit test (no emulator, no network).
 * Run:   node src/manager/libraries/email/sanitize-images.test.js
 */
const assert = require('node:assert');
const { sanitizeImagesForEmail } = require('./constants.js');

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${label}\n    ${error.message}`);
  }
}

check('relative path joins brand.url (trailing slash collapsed)', () => {
  const out = sanitizeImagesForEmail(
    { brandmark: '/assets/images/brand/brandmark.png' },
    'https://playground.omegajs.dev/'
  );
  assert.equal(out.brandmark, 'https://playground.omegajs.dev/assets/images/brand/brandmark.png');
});

check('full URL passes through untouched', () => {
  const out = sanitizeImagesForEmail({ social: 'https://cdn.example.com/social.png' }, 'https://x.dev');
  assert.equal(out.social, 'https://cdn.example.com/social.png');
});

check('svg → png conversion still applies, then absolutizes', () => {
  const out = sanitizeImagesForEmail({ brandmark: '/assets/brand/logo-x.svg' }, 'https://x.dev');
  assert.equal(out.brandmark, 'https://x.dev/assets/brand/logo-1024.png');
});

check('relative path without brand.url stays relative (nothing to join)', () => {
  const out = sanitizeImagesForEmail({ brandmark: '/mark.png' }, undefined);
  assert.equal(out.brandmark, '/mark.png');
});

check('non-string values survive untouched', () => {
  const out = sanitizeImagesForEmail({ brandmark: null, social: 42 }, 'https://x.dev');
  assert.equal(out.brandmark, null);
  assert.equal(out.social, 42);
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll sanitize-images checks passed');
