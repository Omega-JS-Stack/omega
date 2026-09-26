/**
 * The admin calendar's renderer (`core/js/pages/admin/calendar/`) and the two
 * icon maps it draws from: the view-mode toolbar and a campaign's status mark
 * ([#929](https://github.com/Omega-JS-Stack/omega/issues/929)).
 *
 * Both maps carry the FULL Font Awesome class string now and the emit adds only
 * the size, the one shape every other icon key takes, so a map entry can name
 * any family the brand's set carries instead of being pinned to solid by the
 * template it feeds.
 *
 * The REAL modules through esbuild (the harness billing-usage-bars.test.js
 * established), so the map and the emit are proven together: the renderer reads
 * the status style through the core's own STATUS_STYLES.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CALENDAR_DIR = path.join(__dirname, '..', 'core', 'js', 'pages', 'admin', 'calendar');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-calendar-icons-'));
const ENTRY = path.join(BUNDLE_DIR, 'entry.js');
const BUNDLE = path.join(BUNDLE_DIR, 'calendar.cjs');

let building = null;

function bundleOnce() {
  // One entry over BOTH modules: the renderer's emit and the core's map are the
  // two halves of one contract, so the test holds the real pair.
  fs.writeFileSync(ENTRY, [
    `export { default as CalendarRenderer } from ${JSON.stringify(path.join(CALENDAR_DIR, 'calendar-renderer.js'))};`,
    `export { STATUS_STYLES } from ${JSON.stringify(path.join(CALENDAR_DIR, 'calendar-core.js'))};`,
    '',
  ].join('\n'));

  building ||= esbuild.build({
    entryPoints: [ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
      },
    }],
  });

  return building;
}

/** The renderer, over the DOM-shaped stubs its constructor reaches for. */
async function makeRenderer(core) {
  await bundleOnce();

  globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.__omegaClient = { utilities: { escapeHTML: (value) => `${value}` } };

  delete require.cache[require.resolve(BUNDLE)];
  const calendar = require(BUNDLE);

  return { renderer: new calendar.CalendarRenderer(core), STATUS_STYLES: calendar.STATUS_STYLES };
}

test('#929: the view-mode toolbar emits its map entry verbatim', async () => {
  const { renderer } = await makeRenderer({});

  assert.equal(renderer._getViewIcon('month'), '<i class="fa-solid fa-calendar fa-sm"></i>');
  assert.equal(renderer._getViewIcon('week'), '<i class="fa-solid fa-calendar-week fa-sm"></i>');
});

test('#929: a campaign pill emits its status style\'s class string verbatim', async () => {
  const { renderer, STATUS_STYLES } = await makeRenderer({
    campaignColor: () => '#2563EB',
    campaignStatusStyle: (campaign) => STATUS_STYLES[campaign.status] || STATUS_STYLES.pending,
    isEditable: () => false,
    isRecurring: () => false,
  });

  const sent = renderer._renderEventPill({ id: 'c1', status: 'sent', sendAt: 1767225600, type: 'email', settings: { name: 'Launch' } });
  assert.ok(sent.includes('<i class="fa-solid fa-circle-check fa-xs"></i>'), 'the status map\'s class string, as authored');
  assert.ok(!sent.includes('fa-fa-'), 'and nothing wraps it a second time');

  const pending = renderer._renderEventPill({ id: 'c2', status: 'pending', sendAt: 1767225600, type: 'push', settings: { name: 'Nudge' } });
  assert.ok(!pending.includes('fa-circle-check'), 'a pending campaign carries no status mark at all');
});
