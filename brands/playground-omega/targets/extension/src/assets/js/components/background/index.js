/**
 * Surface: the background service worker (the auth source of truth and the
 * notes feature's one API caller)
 * Doc: node_modules/@omega.js/extension/docs/contexts.md
 *
 * What it consumes, one of each: omega.messenger.onMessage (the notes commands,
 * ./notes.js), omega.request() over background's own session,
 * omega.auth.listen (./notes.js drops the count on sign-out),
 * omega.extension (the action badge, the offscreen document), and the
 * offscreen context for DOM parsing.
 */
import omega from '@omega.js/extension/background';
import { registerNotes } from './notes.js';

const OFFSCREEN_PATH = 'views/offscreen/index.html';

// One createDocument in flight at a time: a second call while the first is
// still opening throws "Only a single offscreen document may be created"
let creatingOffscreen = null;

/**
 * Open the offscreen document unless it is already open.
 * @returns {Promise<void>}
 */
async function ensureOffscreen() {
  const { extension } = omega;
  const url = extension.runtime.getURL(OFFSCREEN_PATH);
  const open = await extension.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });

  if (open.length > 0) {
    return;
  }

  creatingOffscreen = creatingOffscreen || extension.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['DOM_PARSER'],
    justification: 'Turn note text into plain text before it is saved',
  }).finally(() => {
    creatingOffscreen = null;
  });

  await creatingOffscreen;
}

/**
 * The plain text of an HTML string, parsed by the offscreen document: a
 * service worker has no DOMParser.
 * @param {string} html - the text as the user typed or selected it.
 * @returns {Promise<string>} its plain text.
 */
async function parseInOffscreen(html) {
  // Firefox runs background as an event page and has no offscreen API: the
  // text is saved as typed, and every surface escapes it when it renders
  if (!omega.extension.offscreen) {
    return html;
  }

  await ensureOffscreen();

  const answer = await omega.messenger.send({ destination: 'offscreen', command: 'notes:parse', payload: { html } });

  if (!answer) {
    throw new Error('The offscreen document did not answer notes:parse.');
  }

  return answer.text;
}

// Registered on the worker's first turn, before initialize() settles: an MV3
// worker woken by a message delivers it right away, and a handler added later
// would miss the very message that woke it
registerNotes({ omega, parse: parseInOffscreen });

omega.initialize()
  .then(() => {
    omega.logger.log('Background initialized!');
  });
