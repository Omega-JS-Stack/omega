/**
 * The /notes page as the production build ships it: the page composes the
 * prose head and the brand's own notes-list section, the section carries its
 * bindings, the URL-keyed page module and sheet are bound, the auth policy
 * gates it, and the site-wide module EXTENDS the framework's.
 *
 * Reads dist/, which `omega test` builds before it runs this suite (or run
 * `omega build` first when calling node --test directly).
 *
 *   node --test test/build/notes.test.js
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, '..', '..', 'dist');

function read(file) {
  return fs.readFileSync(path.join(DIST, file), 'utf8');
}

// The html minifier drops attribute quotes where it can, so every attribute
// match allows both spellings
const attr = (name, value) => new RegExp(`${name}=["']?${value}`);

test('/notes renders the prose head, then the notes-list section', () => {
  const html = read('notes.html');
  const head = html.indexOf('One feature,');
  const form = html.search(attr('id', 'notes-form'));

  assert.ok(head > -1, 'the marketing/prose head renders');
  assert.ok(form > head, 'the notes-list section renders below it');
  assert.match(html, attr('id', 'notes-list'), 'with the list container');
  assert.match(html, attr('id', 'notes-empty'), 'and the empty state');
  assert.match(html, /name=["']?text/, 'and the composer input');
});

test('the section binds the display name and the notes counter', () => {
  const html = read('notes.html');

  assert.match(html, /data-omega-bind=["']?@text auth\.user\.profile\.displayName/, 'the display name binds from auth.user');
  assert.match(html, /data-omega-bind=["']?@text notes\.created/, 'the counter binds from the page-published notes root');
});

test('the page module and page sheet bind to /notes by their asset keys', () => {
  const html = read('notes.html');

  assert.match(html, /src=["']?\/assets\/js\/pages\/notes\.[^ >"']+\.js/, 'js/pages/notes.js is the page module');
  assert.ok(html.includes('.notes-list__item{'), 'css/pages/notes.scss rides the page');
});

test('the page is gated to signed-in users and kept out of the index', () => {
  const html = read('notes.html');

  assert.match(html, /policy:\s*["']authenticated["']/, 'the auth policy redirects a signed-out visitor');
  assert.match(html, /noindex/, 'and the page is noindex');
  assert.ok(!read('sitemap.xml').includes('/notes'), 'so the sitemap leaves it out');
});

test('the home page links to /notes', () => {
  assert.match(read('index.html'), attr('href', '/notes'), 'index.md carries the link');
});

test('the site-wide module extends the framework bundle', () => {
  const main = read('notes.html').match(/src=["']?(\/assets\/js\/main-[^ >"']+\.js)/);

  assert.ok(main, 'the page loads the main bundle');

  const bundle = read(main[1].slice(1));

  assert.ok(bundle.includes('data-omega-notes'), 'src/assets/js/main.js made it into the main bundle');
  assert.ok(bundle.includes('Global module loaded successfully'), 'beside the framework main it extends');
});
