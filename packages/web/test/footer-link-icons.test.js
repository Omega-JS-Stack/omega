/**
 * The footer's link-column icons: a link carries its OWN Font Awesome classes
 * ([#619](https://github.com/Omega-JS-Stack/omega/issues/619),
 * [#850](https://github.com/Omega-JS-Stack/omega/issues/850)). The
 * name-to-markup `icons` config block it used to look each name up in is a
 * retired key, so an authored `icon: 'fa-brands fa-github'` renders as the
 * icon it names instead of resolving to nothing.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const jetpack = require('fs-jetpack');

const { buildSite, miniData, MINI, PKG } = require('./lib/build.js');

/** The one link column the fixture override declares, as rendered markup. */
function linkColumn(html) {
  const match = html.match(/<nav class="omega-footer__col"[\s\S]*?<\/nav>/);
  assert.ok(match, 'the footer renders its link columns');
  return match[0];
}

test('#850: a bare fa-* link icon renders, with no icons map in config', async (t) => {
  // The fixture copy lives UNDER cwd, the farm gotcha engine.js documents.
  const root = path.join(PKG, '.omega', `footer-link-icons-site-${process.pid}`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  jetpack.copy(MINI, root, { overwrite: true });
  jetpack.write(
    path.join(root, '_includes', 'frontend', 'sections', 'footer.json'),
    JSON.stringify({
      links: [{ label: 'Community', links: [{ label: 'GitHub', href: 'https://github.com/minico', icon: 'fa-brands fa-github' }] }],
      socials: { enabled: false },
      copyright: { enabled: true },
    }),
  );

  const column = linkColumn((await buildSite(root, miniData, {}, 'footer-link-icons')).get('/'));

  assert.ok(column.includes('fa-brands fa-github'), `the authored classes reach the markup: ${column}`);
  assert.ok(column.includes('GitHub'), 'beside the label the link carries');
});
