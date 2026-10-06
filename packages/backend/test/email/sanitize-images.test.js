/**
 * sanitizeImagesForEmail test — brand.images stores SITE-RELATIVE paths (the
 * website absolutizes per environment); email clients can only fetch public
 * URLs, so the sanitizer must join relatives against brand.url AND keep the
 * svg→png email-client conversion.
 *
 * Plain-node unit test (no emulator, no network).
 */
const expect = require('../../dist/vendor/devkit/test/expect.js');
const { sanitizeImagesForEmail } = require('../../dist/omega/libraries/email/constants.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'Email image sanitization (brand.images → email-safe URLs)',
  type: 'group',
  tests: [
    {
      name: 'relative path joins brand.url (trailing slash collapsed)',

      run() {
        const out = sanitizeImagesForEmail(
          { brandmark: '/assets/images/brand/brandmark.png' },
          'https://playground.omegajs.dev/'
        );
        expect(out.brandmark).toBe('https://playground.omegajs.dev/assets/images/brand/brandmark.png');
      },
    },

    {
      name: 'full URL passes through untouched',

      run() {
        const out = sanitizeImagesForEmail({ social: 'https://cdn.example.com/social.png' }, 'https://x.dev');
        expect(out.social).toBe('https://cdn.example.com/social.png');
      },
    },

    {
      name: 'svg → png conversion still applies, then absolutizes',

      run() {
        const out = sanitizeImagesForEmail({ brandmark: '/assets/brand/logo-x.svg' }, 'https://x.dev');
        expect(out.brandmark).toBe('https://x.dev/assets/brand/logo-1024.png');
      },
    },

    {
      name: 'relative path without brand.url stays relative (nothing to join)',

      run() {
        const out = sanitizeImagesForEmail({ brandmark: '/mark.png' }, undefined);
        expect(out.brandmark).toBe('/mark.png');
      },
    },

    {
      name: 'non-string values survive untouched',

      run() {
        const out = sanitizeImagesForEmail({ brandmark: null, social: 42 }, 'https://x.dev');
        expect(out.brandmark).toBe(null);
        expect(out.social).toBe(42);
      },
    },
  ],
});
