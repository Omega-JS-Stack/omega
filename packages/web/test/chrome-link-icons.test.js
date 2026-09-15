/**
 * The base theme's chrome link icons: nav, app sidebar, page header, app
 * topbar, the account dropdown and the account section header
 * ([#903](https://github.com/Omega-JS-Stack/omega/issues/903)).
 *
 * A link's `icon` key carries its OWN Font Awesome class string, the shape the
 * footer already takes ([#619](https://github.com/Omega-JS-Stack/omega/issues/619),
 * [#850](https://github.com/Omega-JS-Stack/omega/issues/850)): the template
 * emits it verbatim and adds nothing, so `fa-brands fa-github` renders the mark
 * it names and a bare name renders as the bare class it is, with no `fa-solid`
 * wrapper left anywhere in the chrome.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const jetpack = require('fs-jetpack');

const { buildSite, miniData, MINI, PKG } = require('./lib/build.js');

/** A link carrying a brand mark, and one carrying a bare name the wrapper used to save. */
const BRAND_LINK = { label: 'GitHub', href: 'https://github.com/minico', icon: 'fa-brands fa-github' };
const BARE_LINK = { label: 'Bare', href: '/bare', icon: 'bolt' };

// Each region gets its OWN bare name, so a section's assertions can never be
// answered by another section's markup on the same page.
const BARE_ACCOUNT = { label: 'Bare account item', href: '/bare-account', icon: 'wrench' };
const BARE_TOPBAR = { label: 'Bare topbar action', href: '/bare-topbar', icon: 'gear' };

/**
 * Build the mini site with chrome data that authors both link shapes.
 * @param {import('node:test').TestContext} t - the test context (owns the cleanup)
 * @returns {Promise<Map<string, string>>} url → rendered content
 */
async function buildChrome(t) {
  // The fixture copy lives UNDER cwd, the farm gotcha engine.js documents.
  const root = path.join(PKG, '.omega', `chrome-link-icons-site-${process.pid}`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  jetpack.copy(MINI, root, { overwrite: true });
  jetpack.write(
    path.join(root, '_includes', 'frontend', 'sections', 'nav.json'),
    JSON.stringify({ logo: { href: '/' }, links: [BRAND_LINK, BARE_LINK], actions: [{ type: 'account' }] }),
  );
  jetpack.write(
    path.join(root, '_includes', 'global', 'sections', 'account.json'),
    JSON.stringify({ dropdown: [BRAND_LINK, BARE_ACCOUNT] }),
  );
  jetpack.write(
    path.join(root, '_includes', 'backend', 'sections', 'topbar.json'),
    JSON.stringify({ actions: [BRAND_LINK, BARE_TOPBAR] }),
  );
  jetpack.write(
    path.join(root, 'pages', 'section-header-proof.html'),
    [
      '---',
      'layout: frontend/core/base',
      'permalink: /section-header-proof',
      'meta:',
      '  title: Section header proof',
      '---',
      '',
      '{% include frontend/sections/account-section-header.html title="Brand" icon="fa-brands fa-github" %}',
      '{% include frontend/sections/account-section-header.html title="Bare" icon="screwdriver" %}',
      '',
    ].join('\n'),
  );
  jetpack.write(
    path.join(root, '_includes', 'backend', 'sections', 'sidebar.json'),
    JSON.stringify({ logo: { href: '/app' }, links: [BRAND_LINK, BARE_LINK] }),
  );
  jetpack.write(
    path.join(root, 'pages', 'app.html'),
    [
      '---',
      'layout: backend/core/minimal',
      'permalink: /app',
      'meta:',
      '  title: App',
      'config:',
      '  theme:',
      '    header:',
      '      title:',
      '        content: "App"',
      '        icon: "fa-brands fa-github"',
      '      actions:',
      '        enabled: true',
      '        items:',
      '          - label: "Bare action"',
      '            href: /bare',
      '            icon: bolt',
      '---',
      '',
      '<p id="app-page-content">Hello from the app surface</p>',
      '',
    ].join('\n'),
  );

  return buildSite(root, miniData, {}, 'chrome-link-icons');
}

/**
 * The rendered rail of the app surface.
 * @param {string} app - the app page markup
 * @returns {string} the `<aside class="omega-shell__sidebar">` markup
 */
function rail(app) {
  const opens = app.indexOf('<aside class="omega-shell__sidebar"');
  assert.ok(opens !== -1, 'the shell rail rendered');
  return app.slice(opens, app.indexOf('</aside>', opens));
}

test('#903: the nav emits a link icon exactly as authored', async (t) => {
  const home = (await buildChrome(t)).get('/');
  const opens = home.indexOf('<header class="omega-nav"');
  assert.ok(opens !== -1, 'the marketing nav rendered');
  const nav = home.slice(opens, home.indexOf('</header>', opens));

  assert.ok(nav.includes('fa-brands fa-github'), 'the authored brand classes reach the markup');
  assert.ok(!nav.includes('fa-solid fa-github'), 'nothing re-wraps them as solid');
  assert.match(nav, /<i class="bolt fa-sm me-2"/, 'a bare name lands as the bare class it is');
  assert.ok(!nav.includes('fa-solid fa-bolt'), 'the fa-solid wrapper is gone from the nav');
});

test('#903: the app sidebar emits a link icon exactly as authored', async (t) => {
  const sidebar = rail((await buildChrome(t)).get('/app'));

  assert.ok(sidebar.includes('fa-brands fa-github'), 'the authored brand classes reach the rail');
  assert.ok(!sidebar.includes('fa-solid fa-github'), 'nothing re-wraps them as solid');
  assert.match(sidebar, /<i class="bolt fa-sm"/, 'a bare name lands as the bare class it is');
  assert.ok(!sidebar.includes('fa-solid fa-bolt'), 'the fa-solid wrapper is gone from the rail');
});

test('#903: the app topbar emits an action icon exactly as authored', async (t) => {
  const app = (await buildChrome(t)).get('/app');
  const opens = app.indexOf('<header class="omega-shell__topbar">');
  assert.ok(opens !== -1, 'the app topbar rendered');
  const topbar = app.slice(opens, app.indexOf('</header>', opens));

  assert.ok(topbar.includes('fa-brands fa-github'), 'the authored brand classes reach the topbar');
  assert.ok(!topbar.includes('fa-solid fa-github'), 'nothing re-wraps them as solid');
  assert.match(topbar, /<i class="gear fa-sm me-2"/, 'a bare name lands as the bare class it is');
  assert.ok(!topbar.includes('fa-solid fa-gear'), 'the fa-solid wrapper is gone from the topbar');
});

test('#903: the account dropdown emits an item icon exactly as authored', async (t) => {
  const home = (await buildChrome(t)).get('/');

  // The account items wear `fa-md me-3`, which no other region on the page uses.
  assert.match(home, /<i class="fa-brands fa-github fa-md me-3"/, 'the authored brand classes reach the account menu');
  assert.match(home, /<i class="wrench fa-md me-3"/, 'a bare name lands as the bare class it is');
  assert.ok(!home.includes('fa-solid fa-wrench'), 'the fa-solid wrapper is gone from the account menu');
});

test('#903: the account section header emits its icon exactly as authored', async (t) => {
  const proof = (await buildChrome(t)).get('/section-header-proof');

  assert.match(proof, /<i class="fa-brands fa-github fa-sm"/, 'the authored brand classes reach the section header');
  assert.match(proof, /<i class="screwdriver fa-sm"/, 'a bare name lands as the bare class it is');
  assert.ok(!proof.includes('fa-solid fa-screwdriver'), 'the fa-solid wrapper is gone from the section header');
});

test('#903: the page header emits its title and action icons exactly as authored', async (t) => {
  const app = (await buildChrome(t)).get('/app');
  const opens = app.indexOf('<div class="page-header');
  assert.ok(opens !== -1, 'the in-card page header rendered');
  const header = app.slice(opens, app.indexOf('<div class="page-content', opens));

  assert.ok(header.includes('fa-brands fa-github'), 'the title icon carries the authored classes');
  assert.ok(!header.includes('fa-solid fa-github'), 'nothing re-wraps the title icon as solid');
  assert.match(header, /<i class="bolt fa-sm me-2"/, 'an action icon lands as the bare class it is');
  assert.ok(!header.includes('fa-solid fa-bolt'), 'the fa-solid wrapper is gone from the page header');
});
