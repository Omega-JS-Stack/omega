/**
 * The /notes page as the production build ships it: the page composes the
 * prose head and the brand's own notes-list section, the section carries its
 * bindings, the URL-keyed page module and sheet are bound, the auth policy
 * gates it, and the site-wide module EXTENDS the framework's.
 *
 * Reads dist/, which `omega test` builds before it runs this suite (or run
 * `omega build` first when calling node --test directly).
 *
 * Run (from this target): npx omega test build/notes
 */
const { defineCases } = require('@omega.js/web/test');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, '..', '..', 'dist');

function read(file) {
  return fs.readFileSync(path.join(DIST, file), 'utf8');
}

// The html minifier drops attribute quotes where it can, so every attribute
// match allows both spellings
const attr = (name, value) => new RegExp(`${name}=["']?${value}`);

module.exports = defineCases({
  type: 'group',
  description: 'notes',
  tests: [
    {
      name: '/notes renders the prose head, then the notes-list section',
      run: (ctx) => {
        const html = read('notes.html');
        const head = html.indexOf('One feature,');
        const form = html.search(attr('id', 'notes-form'));

        ctx.expect(head > -1, 'the marketing/prose head renders').toBeTruthy();
        ctx.expect(form > head, 'the notes-list section renders below it').toBeTruthy();
        ctx.expect(html, 'with the list container').toMatch(attr('id', 'notes-list'));
        ctx.expect(html, 'and the empty state').toMatch(attr('id', 'notes-empty'));
        ctx.expect(html, 'and the composer input').toMatch(/name=["']?text/);
      },
    },

    {
      name: 'the section binds the display name and the notes counter',
      run: (ctx) => {
        const html = read('notes.html');

        ctx.expect(html, 'the display name binds from auth.user').toMatch(/data-omega-bind=["']?@text auth\.user\.profile\.displayName/);
        ctx.expect(html, 'the counter binds from the page-published notes root').toMatch(/data-omega-bind=["']?@text notes\.created/);
      },
    },

    {
      name: 'the page module and page sheet bind to /notes by their asset keys',
      run: (ctx) => {
        const html = read('notes.html');

        ctx.expect(html, 'js/pages/notes.js is the page module').toMatch(/src=["']?\/assets\/js\/pages\/notes\.[^ >"']+\.js/);
        ctx.expect(html.includes('.notes-list__item{'), 'css/pages/notes.scss rides the page').toBeTruthy();
      },
    },

    {
      name: 'the page is gated to signed-in users and kept out of the index',
      run: (ctx) => {
        const html = read('notes.html');

        ctx.expect(html, 'the auth policy redirects a signed-out visitor').toMatch(/policy:\s*["']authenticated["']/);
        ctx.expect(html, 'and the page is noindex').toMatch(/noindex/);
        ctx.expect(!read('sitemap.xml').includes('/notes'), 'so the sitemap leaves it out').toBeTruthy();
      },
    },

    {
      name: 'the home page links to /notes',
      run: (ctx) => {
        ctx.expect(read('index.html'), 'index.md carries the link').toMatch(attr('href', '/notes'));
      },
    },

    {
      name: 'the site-wide module extends the framework bundle',
      run: (ctx) => {
        const main = read('notes.html').match(/src=["']?(\/assets\/js\/main-[^ >"']+\.js)/);

        ctx.expect(main, 'the page loads the main bundle').toBeTruthy();

        const bundle = read(main[1].slice(1));

        ctx.expect(bundle.includes('data-omega-notes'), 'src/assets/js/main.js made it into the main bundle').toBeTruthy();
        ctx.expect(bundle.includes('Global module loaded successfully'), 'beside the framework main it extends').toBeTruthy();
      },
    },
  ],
});
