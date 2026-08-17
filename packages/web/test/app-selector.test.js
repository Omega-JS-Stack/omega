/**
 * #319 — the sidebar's project selector opened INSIDE the rail's own scroll
 * box: `.omega-shell__sidebar` carried `overflow-y: auto`, so the absolutely
 * positioned `.dropdown-menu` was cut at the rail's edges — long `owner/name`
 * entries truncated where the sidebar meets the content column, the bottom of
 * a 14-entry menu swallowed by the first dashboard card.
 *
 * The escape is structural, so it holds on every skin and at every width: the
 * rail itself never clips, the scroll moved down to `.omega-shell__sidebar-scroll`
 * (nav + bottom slot), the selector is pinned ABOVE that region with no
 * clipping ancestor left between it and the viewport, and the rail carries an
 * explicit stacking order so an open menu paints over the content column.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { buildSite, PKG } = require('./lib/build.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'selector-site');
const selectorData = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'site-data.json'), 'utf8'));

/**
 * The rendered sidebar of the fixture's app surface, on a given skin.
 * @param {string} theme - theme id
 * @returns {Promise<string>} the `<aside class="omega-shell__sidebar">` markup
 */
async function sidebarOn(theme) {
  const pages = await buildSite(FIXTURE, selectorData, { activeTheme: theme }, `app-selector-${theme}`);
  const app = pages.get('/app');
  assert.ok(app, `app surface built on ${theme}`);

  const opens = app.indexOf('<aside class="omega-shell__sidebar"');
  assert.ok(opens !== -1, `the shell rail rendered on ${theme}`);
  return app.slice(opens, app.indexOf('</aside>', opens));
}

// ─── Markup: the selector sits outside the rail's scroll box ─────────────────

for (const theme of ['classy', 'newsflash']) {
  test(`#319: the ${theme} rail opens its selector OUTSIDE the scroll region`, async () => {
    const sidebar = await sidebarOn(theme);

    const selectorAt = sidebar.indexOf('omega-side__selector');
    const menuAt = sidebar.indexOf('dropdown-menu');
    const scrollAt = sidebar.indexOf('omega-shell__sidebar-scroll');

    assert.ok(selectorAt !== -1, 'the selector module rendered');
    assert.ok(menuAt !== -1, 'its menu rendered');
    assert.ok(scrollAt !== -1, 'the rail carries its scroll region');
    assert.ok(selectorAt < scrollAt, 'the selector toggle is pinned above the scroller');
    assert.ok(menuAt < scrollAt, 'and so is the menu — nothing scrollable clips it');

    // The nav and the bottom slot are what actually scrolls now.
    assert.ok(sidebar.indexOf('omega-side__label') > scrollAt, 'the nav moved inside the scroller');
    assert.ok(sidebar.indexOf('omega-side__user') > scrollAt, 'so did the bottom slot');
  });
}

test('#319: the whole repro menu ships — 14 entries, none of them trimmed', async () => {
  const sidebar = await sidebarOn('classy');

  const items = sidebar.match(/class="dropdown-item"/g) || [];
  assert.strictEqual(items.length, 13, 'every non-divider entry rendered');
  assert.ok(sidebar.includes('itw-creative-works/browser-extension-manager'), 'the widest slug renders in full');
  assert.ok(sidebar.includes('dropdown-divider'), 'the menu\'s divider survives');
});

// ─── CSS: the rail is the non-clipping, explicitly stacked ancestor ──────────

test('#319: the shell sheet moves the scroll off the rail and stacks it over content', () => {
  const warnings = [];
  const css = sass.compile(path.join(PKG, 'core', 'css', 'shell', '_index.scss'), {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  }).css;

  assert.deepEqual(warnings, [], 'new core css never warns — the #16 bar');

  const rail = css.match(/\n\.omega-shell__sidebar \{[^}]*\}/);
  assert.ok(rail, 'the rail rule is still the shell\'s own');
  assert.ok(!/overflow/.test(rail[0]), 'the rail clips NOTHING — a popover may leave its box');
  assert.match(rail[0], /position: relative/, 'positioned, so the stacking order is its own to set');
  const zindex = Number((rail[0].match(/z-index: (\d+)/) || [])[1]);
  assert.ok(zindex > 1020, `explicit stacking beats sticky page chrome inside the content column (got ${zindex})`);

  const scroller = css.match(/\.omega-shell__sidebar-scroll \{[^}]*\}/);
  assert.ok(scroller, 'the scroll region is a real shell region');
  assert.match(scroller[0], /overflow-y: auto/, 'the nav is what scrolls now');
  assert.match(scroller[0], /min-height: 0/, 'so it can actually shrink inside the flex column');
  assert.match(scroller[0], /flex-direction: column/, 'and the bottom slot keeps its mt-auto push');

  // The drawer still wins its own stacking fight at narrow widths.
  const drawer = css.match(/@media \(max-width: 1199\.98px\)[\s\S]*?\.omega-shell__sidebar \{[^}]*\}/);
  assert.ok(drawer && /z-index: 1045/.test(drawer[0]), 'the mobile drawer still outranks the scrim');

  // Nothing clips the popover and the shell page never scrolls, so the menu
  // must cap itself: a long selector list scrolls internally instead of
  // stranding its tail below the fold on short viewports.
  const menu = css.match(/\.omega-shell__sidebar \.dropdown-menu \{[^}]*\}/);
  assert.ok(menu, 'the rail popover menu has its own shell rule');
  assert.match(menu[0], /max-height: calc\(100dvh/, 'the menu caps at the viewport');
  assert.match(menu[0], /overflow-y: auto/, 'and scrolls internally so the tail stays reachable');
});
