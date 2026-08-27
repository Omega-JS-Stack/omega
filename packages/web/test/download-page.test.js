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

// A brand that opted into desktop releases (#124). Since #610 that is the ONLY
// download declaration there is: one releases hub answers every desktop
// artifact — one for mac, TWO for linux (.deb + snap) — and mobile derives
// nothing while MAM is parked.
const RELEASES = 'https://github.com/mini-org/mini-desktop/releases/latest';
const withDownloads = {
  ...miniData,
  repo: { providers: { github: { org: 'mini-org', repo: 'mini-site' } } },
  targets: { web: {}, desktop: { releases: { repo: 'mini-desktop' } } },
};

test('#14: platform identity is the MARK — the small neutral chip is gone', async () => {
  const pages = await buildWith(withDownloads);
  const download = pages.get('/download');
  assert.ok(download, 'download page built');

  const marks = download.match(/omega-dl-card__mark/g) || [];
  assert.equal(marks.length, 3, 'every desktop card leads with the platform mark');
  assert.ok(!download.includes('omega-dl-card__chip'), 'the old chip variant is gone');
});

test('#14: two artifacts ride side by side — one does not', async () => {
  const pages = await buildWith(withDownloads);
  const download = pages.get('/download');

  const splits = download.match(/omega-dl-card__actions omega-dl-card__actions--split/g) || [];
  assert.equal(splits.length, 1, 'only Linux (.deb + snap) splits its action row');
  assert.ok(download.includes('Debian package') && download.includes('Snap package'), 'both Linux artifacts render');
  assert.equal(download.split(RELEASES).length - 1, 4, 'every desktop artifact points at the releases hub');
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
  // #610: mobile derives nothing while MAM is parked, so a shipped desktop
  // release never puts a store badge on the mobile band.
  assert.ok(!download.includes('omega-dl-store__badge'), 'no mobile store badge without a mobile fact');
});

test('#14: every mobile store unshipped → still exactly one form', async () => {
  const pages = await buildWith(miniData);
  const download = pages.get('/download');

  const forms = download.match(/class="mobile-email-form"/g) || [];
  assert.equal(forms.length, 1, 'one form for iOS + Android together');
  assert.ok(download.includes('<strong>iOS</strong>') && download.includes('<strong>Android</strong>'),
    'both pending stores are named');
});

// The visible hero masthead stays; the SECOND lead-in (the section head that
// sat right above the platform/browser cards) is the one that went (Ian QA).
const sectionOf = (html, id) => {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start > -1, `#${id} section is on the page`);
  const end = html.indexOf('<section', start);
  return html.slice(start, end > -1 ? end : html.length);
};

test('QA: /download keeps its hero masthead and drops the second lead-in', async () => {
  const pages = await buildWith(miniData);
  const download = pages.get('/download');

  const h1s = download.match(/<h1[^>]*>/g) || [];
  assert.equal(h1s.length, 1, 'exactly one h1 (SEO checklist)');
  assert.ok(!h1s[0].includes('visually-hidden'), 'the h1 is visible, not screen-reader only');
  assert.ok(download.includes('<span class="omega-micro d-block mb-3" data-omega-reveal>Download</span>'),
    'the masthead eyebrow renders');
  assert.ok(download.includes('Take MiniCo with you'), 'the hero headline renders');
  assert.ok(download.includes('omega-hero__sub'), 'the hero sub line renders');

  const platforms = sectionOf(download, 'platforms');
  assert.ok(!platforms.includes('omega-section-head'), 'no section head above the platform cards');
  assert.ok(!download.includes('Every platform,'), 'the second lead-in copy is gone');
  assert.ok(!download.includes('Pick your machine'), 'the older second lead-in stays gone');
  assert.ok(download.includes('omega-dl-card__mark'), 'the platform cards still render');
});

test('QA: /extension echoes it — hero masthead kept, second lead-in gone', async () => {
  const pages = await buildWith(miniData);
  const extension = pages.get('/extension');

  const h1s = extension.match(/<h1[^>]*>/g) || [];
  assert.equal(h1s.length, 1, 'exactly one h1 (SEO checklist)');
  assert.ok(!h1s[0].includes('visually-hidden'), 'the h1 is visible, not screen-reader only');
  assert.ok(extension.includes('<span class="omega-micro d-block mb-3" data-omega-reveal>Extension</span>'),
    'the masthead eyebrow renders');
  assert.ok(extension.includes('One tab away, in <em>every</em> browser'), 'the hero headline renders');
  assert.ok(extension.includes('omega-hero__sub'), 'the hero sub line renders');

  const browsers = sectionOf(extension, 'browsers');
  assert.ok(!browsers.includes('omega-section-head'), 'no section head above the browser cards');
  assert.ok(!extension.includes('Your browser is'), 'the second lead-in copy is gone');
  assert.ok(extension.includes('omega-dl-card__mark'), 'the browser cards still render');
});

test('#14: the onboarding modal wears the current design language', async () => {
  const pages = await buildWith(withDownloads);
  const download = pages.get('/download');

  assert.ok(download.includes('modal-content omega-dl-modal'), 'the modal is a classy surface');
  assert.ok(download.includes('omega-dl-modal__pane'), 'the command panes are designed surfaces');
  assert.ok(download.includes('omega-dl-modal__cmd'), 'the command inputs are token-painted');
  assert.ok(download.includes('omega-dl-modal__help'), 'the help note replaced alert-info');

  for (const legacy of ['alert alert-success', 'alert alert-info', 'bg-body-tertiary', 'bg-white border border-primary', 'bg-dark text-light']) {
    assert.ok(!download.includes(legacy), `Bootstrap-era chrome gone: ${legacy}`);
  }
});

test('QA: the modal is instructions only — no started card, no dismiss button', async () => {
  const pages = await buildWith(withDownloads);
  const download = pages.get('/download');

  assert.ok(!download.includes('omega-dl-modal__started'), 'the download-started card is gone');
  assert.ok(!download.includes('Your download should begin automatically'), 'its copy went with it');
  assert.ok(!download.includes('modal-footer'), 'the footer holding "Got it!" is gone');
  assert.ok(!download.includes('Got it!'), 'the redundant dismiss button is gone');
  assert.ok(download.includes('data-bs-dismiss="modal"'), 'the header close button still dismisses');

  const scss = fs.readFileSync(
    path.join(PKG, 'themes', 'classy', 'css', 'marketing', '_downloads.scss'), 'utf8',
  );
  assert.ok(!scss.includes('.omega-dl-modal__started'), 'the dead rule went with the markup');
  const help = scss.match(/\.omega-dl-modal__help \{[^}]*\}/)[0];
  assert.ok(!help.includes('display: flex'), 'the help note sets as prose, not as gapped flex items');
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
