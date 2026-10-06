/**
 * The footer's link-column icons: a link carries its OWN Font Awesome classes
 * ([#619](https://github.com/Omega-JS-Stack/omega/issues/619),
 * [#850](https://github.com/Omega-JS-Stack/omega/issues/850)). The
 * name-to-markup `icons` config block it used to look each name up in is a
 * retired key, so an authored `icon: 'fa-brands fa-github'` renders as the
 * icon it names instead of resolving to nothing.
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const expect = require('@omega.js/devkit/test/expect');
const jetpack = require('fs-jetpack');

const { buildSite, miniData, MINI, PKG } = require('./lib/build.js');

/** The one link column the fixture override declares, as rendered markup. */
function linkColumn(html) {
  const match = html.match(/<nav class="omega-footer__col"[\s\S]*?<\/nav>/);
  expect(match, 'the footer renders its link columns').toBeTruthy();
  return match[0];
}

module.exports = defineCases({
  type: 'group',
  description: 'footer-link-icons',
  tests: [
    {
      name: '#850: a bare fa-* link icon renders, with no icons map in config',
      run: async (ctx) => {
        // The fixture copy lives UNDER cwd, the farm gotcha engine.js documents.
        const root = path.join(PKG, '.omega', `footer-link-icons-site-${process.pid}`);
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

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

        ctx.expect(column.includes('fa-brands fa-github'), `the authored classes reach the markup: ${column}`).toBeTruthy();
        ctx.expect(column.includes('GitHub'), 'beside the label the link carries').toBeTruthy();
      },
    },
  ],
});
