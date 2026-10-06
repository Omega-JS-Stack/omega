/**
 * /download and /extension populate from the config `targets` alone (#44 item
 * 26): no hand-supplied `download`/`extension` page map, no hand-written links.
 * The derivation itself is unit-pinned in @omega.js/config (site-global.test.js);
 * these are the RENDER assertions — target present vs absent, on the pages.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildWith, miniData } = require('./lib/build.js');

// A brand that declares both targets and opted in to desktop releases: the
// only download/extension facts in the config are inside `targets`.
const withTargets = {
  ...miniData,
  repo: { provider: 'github', owner: 'mini-org' },
  targets: {
    web: { type: 'web' },
    desktop: { type: 'desktop', releases: {} },
    extension: {
      type: 'extension',
      listings: {
        chrome: { url: 'https://chrome.example.com/mini' },
        firefox: { url: 'https://firefox.example.com/mini' },
      },
    },
  },
};

const RELEASES = 'https://github.com/mini-org/mini-releases/releases/latest';

module.exports = defineCases({
  type: 'group',
  description: 'target-derived-pages',
  tests: [
    {
      name: '#26: declared targets fill the download page — every desktop card gets its link',
      run: async (ctx) => {
        const pages = await buildWith(withTargets, {}, 'targets-download');
        const download = pages.get('/download');
        ctx.expect(download, 'download page built').toBeTruthy();

        ctx.expect(download.split(`${RELEASES}/download/`).length - 1, 'mac + windows + linux (.deb and AppImage) all point at their derived direct download').toBe(4);
        ctx.expect(download.includes('omega-dl-card__actions omega-dl-card__actions--split'), 'Linux still splits its two derived artifacts').toBeTruthy();
        ctx.expect(!download.includes('Not available yet'), 'no desktop card falls back to the empty state').toBeTruthy();

        // Mobile stays underived (MAM is parked): the notify-me form, not a link.
        ctx.expect(download.includes('class="mobile-email-form"'), 'unshipped stores keep the notify form').toBeTruthy();
      },
    },

    {
      name: '#26: no desktop target → no download links, and nothing invented',
      run: async (ctx) => {
        const pages = await buildWith(miniData, {}, 'targets-download-absent');
        const download = pages.get('/download');

        ctx.expect(!download.includes('releases/latest'), 'no releases URL without a desktop target').toBeTruthy();
        ctx.expect((download.match(/Not available yet/g) || []).length, 'mac, windows, and linux each show the designed empty state').toBe(3);
        ctx.expect(!download.includes('data-download="true"'), 'no download button anywhere on the page').toBeTruthy();
      },
    },

    {
      name: '#26: extension listings fill the store buttons; unlisted browsers stay Coming soon',
      run: async (ctx) => {
        const pages = await buildWith(withTargets, {}, 'targets-extension');
        const extension = pages.get('/extension');
        ctx.expect(extension, 'extension page built').toBeTruthy();

        ctx.expect(extension.includes('https://chrome.example.com/mini'), 'the chrome listing renders its store link').toBeTruthy();
        ctx.expect(extension.includes('https://firefox.example.com/mini'), 'the firefox listing renders its store link').toBeTruthy();
        ctx.expect((extension.match(/data-install="true"/g) || []).length, 'only the listed stores get a button').toBe(2);
        ctx.expect((extension.match(/Coming soon/g) || []).length, 'edge, opera, safari, and brave keep the designed empty state').toBe(4);
      },
    },

    {
      name: '#26: no extension target → every browser card is the empty state',
      run: async (ctx) => {
        const pages = await buildWith(miniData, {}, 'targets-extension-absent');
        const extension = pages.get('/extension');

        ctx.expect(!extension.includes('data-install="true"'), 'no store button without listings').toBeTruthy();
        ctx.expect((extension.match(/Coming soon/g) || []).length, 'all six browser cards wait').toBe(6);
      },
    },
  ],
});
