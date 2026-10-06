/**
 * The early-error buffer rides the head when Sentry is on: the inline copy of
 * @omega.js/monitoring's `installEarlyErrorBuffer` fills
 * `window.__OMEGA_EARLY_ERRORS` before any module runs, so the client can replay
 * what was thrown before the SDK loaded. Sentry off carries no buffer at all.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildWith, miniData } = require('./lib/build.js');

const BUFFER = '__OMEGA_EARLY_ERRORS';
const SENTRY_ON = { providers: { sentry: { dsn: 'https://key@o1.ingest.sentry.io/9' } } };

// The rendered pages alone: `/build.js` is the config snapshot, not a page
const htmlPages = (pages) => [...pages].filter(([url]) => url !== '/build.js');

module.exports = defineCases({
  type: 'group',
  description: 'early-error-buffer',
  tests: [
    {
      name: 'a build with Sentry on inlines the buffer in the head, ahead of every module',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData, monitoring: SENTRY_ON }, { environment: 'production' }, 'early-error-buffer-on');
        const demo = pages.get('/sections-demo');

        const buffer = demo.indexOf(BUFFER);
        const firstPaint = demo.indexOf('/assets/js/first-paint-TEST.js');
        const main = demo.indexOf('/assets/js/main-TEST.js');

        ctx.expect(buffer !== -1, 'the page carries the early-error buffer').toBeTruthy();
        // The minified page drops the optional `</head>`, so the body's open tag bounds the head
        ctx.expect(buffer < demo.indexOf('<body'), 'in the head').toBeTruthy();
        ctx.expect(firstPaint !== -1 && buffer < firstPaint, 'before the first-paint script').toBeTruthy();
        ctx.expect(main !== -1 && buffer < main, 'and before the main bundle').toBeTruthy();
      },
    },

    {
      name: 'a build with Sentry off carries no buffer on any page (case 10)',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData }, { environment: 'production' }, 'early-error-buffer-off');
        const carrying = htmlPages(pages).filter(([, html]) => String(html).includes(BUFFER)).map(([url]) => url);

        ctx.expect(htmlPages(pages).length > 0, 'the build rendered pages').toBeTruthy();
        ctx.expect(carrying, 'no page carries the buffer').toEqual([]);
      },
    },
  ],
});
