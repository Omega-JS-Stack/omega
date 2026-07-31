/**
 * /download and /extension populate from the config `targets` alone (#44 item
 * 26): no hand-supplied `download`/`extension` page map, no hand-written links.
 * The derivation itself is unit-pinned in @omega.js/config (site-global.test.js);
 * these are the RENDER assertions — target present vs absent, on the pages.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { buildWith, miniData } = require('./lib/build.js');

// A brand that declares both targets and opted in to desktop releases: the
// only download/extension facts in the config are inside `targets`.
const withTargets = {
  ...miniData,
  repo: { providers: { github: { org: 'mini-org', repo: 'mini-site' } } },
  targets: {
    web: {},
    desktop: { releases: { repo: 'mini-desktop' } },
    extension: {
      listings: {
        chrome: { url: 'https://chrome.example.com/mini' },
        firefox: { url: 'https://firefox.example.com/mini' },
      },
    },
  },
};

const RELEASES = 'https://github.com/mini-org/mini-desktop/releases/latest';

test('#26: declared targets fill the download page — every desktop card gets its link', async () => {
  const pages = await buildWith(withTargets, {}, 'targets-download');
  const download = pages.get('/download');
  assert.ok(download, 'download page built');

  assert.equal(download.split(RELEASES).length - 1, 4,
    'mac + windows + linux (.deb and snap) all point at the derived releases URL');
  assert.ok(download.includes('classy-dl-card__actions classy-dl-card__actions--split'),
    'Linux still splits its two derived artifacts');
  assert.ok(!download.includes('Not available yet'), 'no desktop card falls back to the empty state');

  // Mobile stays underived (MAM is parked): the notify-me form, not a link.
  assert.ok(download.includes('class="mobile-email-form"'), 'unshipped stores keep the notify form');
});

test('#26: no desktop target → no download links, and nothing invented', async () => {
  const pages = await buildWith(miniData, {}, 'targets-download-absent');
  const download = pages.get('/download');

  assert.ok(!download.includes('releases/latest'), 'no releases URL without a desktop target');
  assert.equal((download.match(/Not available yet/g) || []).length, 3,
    'mac, windows, and linux each show the designed empty state');
  assert.ok(!download.includes('data-download="true"'), 'no download button anywhere on the page');
});

test('#26: extension listings fill the store buttons; unlisted browsers stay Coming soon', async () => {
  const pages = await buildWith(withTargets, {}, 'targets-extension');
  const extension = pages.get('/extension');
  assert.ok(extension, 'extension page built');

  assert.ok(extension.includes('https://chrome.example.com/mini'), 'the chrome listing renders its store link');
  assert.ok(extension.includes('https://firefox.example.com/mini'), 'the firefox listing renders its store link');
  assert.equal((extension.match(/data-install="true"/g) || []).length, 2, 'only the listed stores get a button');
  assert.equal((extension.match(/Coming soon/g) || []).length, 4,
    'edge, opera, safari, and brave keep the designed empty state');
});

test('#26: no extension target → every browser card is the empty state', async () => {
  const pages = await buildWith(miniData, {}, 'targets-extension-absent');
  const extension = pages.get('/extension');

  assert.ok(!extension.includes('data-install="true"'), 'no store button without listings');
  assert.equal((extension.match(/Coming soon/g) || []).length, 6, 'all six browser cards wait');
});
