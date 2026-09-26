/**
 * The /notes page module (src/assets/js/pages/notes.js) draws the list the
 * backend answers: loadNotes() asks omega.request() for GET /notes and
 * renders every note escaped, with its delete button, and the empty state
 * follows the list.
 *
 * Two stand-ins, both for things node does not have: `omega.request` (no
 * backend runs in this lane; the backend's own suites prove the route) and the
 * two elements the module writes (node has no DOM and this target pulls in no
 * jsdom, the web framework's own convention). escapeHTML is the client's
 * DOM-based one in the browser, so the stand-in escapes the same five
 * characters.
 *
 *   node --test test/pages/notes.test.js
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE = pathToFileURL(path.join(__dirname, '..', '..', 'src', 'assets', 'js', 'pages', 'notes.js')).href;

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };

function note(id, text) {
  return { id, owner: 'uid-1', text, metadata: { created: { timestamp: '2026-09-25T12:00:00.000Z', timestampUNIX: 1790337600 } } };
}

function harness(notes) {
  const calls = [];
  const omega = {
    request: async (url, options) => {
      calls.push({ url, options });
      return { notes };
    },
    utilities: {
      escapeHTML: (text) => String(text).replace(/[&<>"']/g, (c) => ENTITIES[c]),
    },
  };

  return { omega, calls, $list: { innerHTML: 'stale' }, $empty: { hidden: false } };
}

test('loadNotes draws what GET /notes answers, escaped', async () => {
  const { loadNotes, NOTES_ROUTE } = await import(MODULE);
  const { omega, calls, $list, $empty } = harness([
    note('n1', 'Buy milk'),
    note('n2', '<img src=x onerror=alert(1)>'),
  ]);

  const drawn = await loadNotes({ omega, $list, $empty });

  assert.equal(calls.length, 1, 'one request');
  assert.equal(NOTES_ROUTE, '/notes', 'the backend\'s own notes function, never /omega/notes');
  assert.equal(calls[0].url, `${NOTES_ROUTE}?limit=20`, 'a GET of the notes route');
  assert.equal(calls[0].options, undefined, 'with no method or body, so fetch sends GET');

  assert.equal(drawn.length, 2, 'it hands back the notes it drew');
  assert.match($list.innerHTML, /Buy milk/, 'the first note renders');
  assert.match($list.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/, 'a note\'s markup renders as text');
  assert.ok(!$list.innerHTML.includes('<img'), 'and never as markup');
  assert.match($list.innerHTML, /data-note-delete="n1"/, 'each note carries its delete button');
  assert.match($list.innerHTML, /data-note-delete="n2"/, 'every one of them');
  assert.equal($empty.hidden, true, 'the empty state hides while notes exist');
});

test('an empty answer clears the list and shows the empty state', async () => {
  const { loadNotes } = await import(MODULE);
  const { omega, $list, $empty } = harness([]);

  await loadNotes({ omega, $list, $empty });

  assert.equal($list.innerHTML, '', 'nothing left from the last draw');
  assert.equal($empty.hidden, false, 'the empty state shows');
});
