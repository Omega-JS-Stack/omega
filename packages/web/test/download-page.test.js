/**
 * /download — the #14 batch: prominent platform marks, side-by-side artifacts,
 * ONE mobile notify form, and an onboarding modal that speaks the current
 * design language (tokens + classy vocabulary, not Bootstrap-era alert boxes).
 *
 * Detection itself is NOT tested here: both the download and the extension page
 * call the shared client logic (omega.utilities().getPlatform/getBrowser) — the
 * pin for that is in this file's last test, on the page bundles.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'download-test');

// A download map with the shapes that matter: one artifact (mac), TWO (linux:
// .deb + snap), one shipped store (android) and one still in flight (ios).
const withDownloads = {
  ...miniData,
  download: {
    mac: { universal: 'https://dl.example.com/mac' },
    linux: {
      debian: 'https://dl.example.com/app.deb',
      snap: 'https://dl.example.com/app.snap',
    },
    android: { universal: 'https://play.example.com/app' },
  },
};

test('#14: platform identity is the MARK — the small neutral chip is gone', async () => {
  const pages = await buildWith(withDownloads);
  const download = pages.get('/download');
  assert.ok(download, 'download page built');

  const marks = download.match(/classy-dl-card__mark/g) || [];
  assert.equal(marks.length, 3, 'every desktop card leads with the platform mark');
  assert.ok(!download.includes('classy-dl-card__chip'), 'the old chip variant is gone');
});

test('#14: two artifacts ride side by side — one does not', async () => {
  const pages = await buildWith(withDownloads);
  const download = pages.get('/download');

  const splits = download.match(/classy-dl-card__actions classy-dl-card__actions--split/g) || [];
  assert.equal(splits.length, 1, 'only Linux (.deb + snap) splits its action row');
  assert.ok(download.includes('app.deb') && download.includes('app.snap'), 'both Linux artifacts render');
  assert.ok(!download.includes('btn-adaptive w-100'), 'action width is the flex row\'s job now');
});

test('#14: ONE mobile notify form covers every unshipped store', async () => {
  const pages = await buildWith(withDownloads);
  const download = pages.get('/download');

  const forms = download.match(/class="mobile-email-form"/g) || [];
  assert.equal(forms.length, 1, 'exactly one notify-me form');
  assert.ok(download.includes('id="mobile-email-form"'), 'the form carries the platform-free id');
  assert.ok(!download.includes('mobile-email-form-ios'), 'the per-platform form ids are gone');
  assert.ok(download.includes('<strong>iOS</strong>'), 'the unshipped store is named on the block');
  assert.ok(download.includes('play.example.com/app'), 'the shipped store still renders its badge');
});

test('#14: every mobile store unshipped → still exactly one form', async () => {
  const pages = await buildWith(miniData);
  const download = pages.get('/download');

  const forms = download.match(/class="mobile-email-form"/g) || [];
  assert.equal(forms.length, 1, 'one form for iOS + Android together');
  assert.ok(download.includes('<strong>iOS</strong>') && download.includes('<strong>Android</strong>'),
    'both pending stores are named');
});

test('#14: the intro above the platform cards is ONE line', async () => {
  const pages = await buildWith(miniData);
  const download = pages.get('/download');

  // The mini fixture overrides the hero sub site-wide, so the COPY lives in
  // the layout — assert the source is one short line, and that the second
  // lead-in above the cards no longer renders.
  const layout = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', '_layouts', 'frontend', 'pages', 'download.html'), 'utf8',
  );
  const description = layout.match(/^\s*description: "(.*)"$/m)[1];
  assert.ok(description.length <= 40, `hero description stays one line (got ${description.length} chars)`);
  assert.ok(!download.includes('Pick your machine'), 'the second lead-in above the cards is gone');
});

test('#14: the onboarding modal wears the current design language', async () => {
  const pages = await buildWith(withDownloads);
  const download = pages.get('/download');

  assert.ok(download.includes('modal-content classy-dl-modal'), 'the modal is a classy surface');
  assert.ok(download.includes('classy-dl-modal__started'), 'the download-started row replaced the alert box');
  assert.ok(download.includes('classy-dl-modal__pane'), 'the command panes are designed surfaces');
  assert.ok(download.includes('classy-dl-modal__cmd'), 'the command inputs are token-painted');
  assert.ok(download.includes('classy-dl-modal__help'), 'the help note replaced alert-info');

  for (const legacy of ['alert alert-success', 'alert alert-info', 'bg-body-tertiary', 'bg-white border border-primary', 'bg-dark text-light']) {
    assert.ok(!download.includes(legacy), `Bootstrap-era chrome gone: ${legacy}`);
  }
});

test('#14: OS/browser detection on BOTH pages comes from the shared client logic', () => {
  const download = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'download', 'index.js'), 'utf8');
  const extension = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'extension', 'index.js'), 'utf8');

  assert.ok(download.includes('omega.utilities().getPlatform()'), 'download reads the shared platform detector');
  assert.ok(extension.includes('omega.utilities().getBrowser()'), 'extension reads the shared browser detector');
  for (const source of [download, extension]) {
    assert.ok(!/navigator\.(userAgent|platform)/.test(source), 'no page-local ua sniffing');
  }
});
