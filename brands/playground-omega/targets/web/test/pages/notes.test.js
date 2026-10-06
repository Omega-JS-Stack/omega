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
 * Run (from this target): npx omega test pages/notes
 */
const { defineCases } = require('@omega.js/web/test');
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

module.exports = defineCases({
  type: 'group',
  description: 'notes',
  tests: [
    {
      name: 'loadNotes draws what GET /notes answers, escaped',
      run: async (ctx) => {
        const { loadNotes, NOTES_ROUTE } = await import(MODULE);
        const { omega, calls, $list, $empty } = harness([
          note('n1', 'Buy milk'),
          note('n2', '<img src=x onerror=alert(1)>'),
        ]);

        const drawn = await loadNotes({ omega, $list, $empty });

        ctx.expect(calls.length, 'one request').toBe(1);
        ctx.expect(NOTES_ROUTE, 'the backend\'s own notes function, never /omega/notes').toBe('/notes');
        ctx.expect(calls[0].url, 'a GET of the notes route').toBe(`${NOTES_ROUTE}?limit=20`);
        ctx.expect(calls[0].options, 'with no method or body, so fetch sends GET').toBe(undefined);

        ctx.expect(drawn.length, 'it hands back the notes it drew').toBe(2);
        ctx.expect($list.innerHTML, 'the first note renders').toMatch(/Buy milk/);
        ctx.expect($list.innerHTML, 'a note\'s markup renders as text').toMatch(/&lt;img src=x onerror=alert\(1\)&gt;/);
        ctx.expect(!$list.innerHTML.includes('<img'), 'and never as markup').toBeTruthy();
        ctx.expect($list.innerHTML, 'each note carries its delete button').toMatch(/data-note-delete="n1"/);
        ctx.expect($list.innerHTML, 'every one of them').toMatch(/data-note-delete="n2"/);
        ctx.expect($empty.hidden, 'the empty state hides while notes exist').toBe(true);
      },
    },

    {
      name: 'an empty answer clears the list and shows the empty state',
      run: async (ctx) => {
        const { loadNotes } = await import(MODULE);
        const { omega, $list, $empty } = harness([]);

        await loadNotes({ omega, $list, $empty });

        ctx.expect($list.innerHTML, 'nothing left from the last draw').toBe('');
        ctx.expect($empty.hidden, 'the empty state shows').toBe(false);
      },
    },
  ],
});
