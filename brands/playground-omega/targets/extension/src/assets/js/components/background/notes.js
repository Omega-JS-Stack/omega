/**
 * Surface: background message handlers (omega.messenger.onMessage), the one
 * owner of the notes feature inside the extension
 * Doc: node_modules/@omega.js/extension/docs/contexts.md
 *
 * Every other context asks background over the messenger; background alone
 * calls the API, through omega.request() on its own session (the auth source
 * of truth). The count is
 * a small in-memory cache the toolbar badge mirrors: filled by a list, moved by
 * every create and delete, dropped on sign-out.
 */
export const NOTES_ROUTE = '/notes';

// The GET schema's own ceiling, so one list covers every note a count can show
export const LIST_LIMIT = 100;

/**
 * Register the notes commands on background's messenger.
 * @param {object} options - { omega, parse }: background's instance and the
 *   HTML-to-text step the offscreen document performs.
 * @returns {Function} the unsubscribe for the message handler.
 */
export function registerNotes({ omega, parse }) {
  // null = not read yet in this worker's lifetime
  let count = null;

  const setCount = (value) => {
    count = value;

    // `action` is the MV3 toolbar button; an empty string clears the badge
    omega.extension.action.setBadgeText({ text: value ? String(value) : '' });
  };

  const requireUser = () => {
    if (!omega.auth.user.authenticated) {
      throw new Error('Sign in to use notes.');
    }
  };

  // Payloads come from other contexts, a content script included: check them
  const requireString = (value, name) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`notes: "${name}" must be a non-empty string.`);
    }
  };

  const list = async () => {
    const { notes } = await omega.request(`${NOTES_ROUTE}?limit=${LIST_LIMIT}`);

    setCount(notes.length);

    return notes;
  };

  const handlers = {
    'notes:list': async () => {
      requireUser();

      return { notes: await list() };
    },

    'notes:create': async ({ text }) => {
      requireUser();
      requireString(text, 'text');

      const { note } = await omega.request(NOTES_ROUTE, { method: 'POST', body: { text: await parse(text) } });

      if (count !== null) {
        setCount(count + 1);
      }

      return { note };
    },

    'notes:delete': async ({ id }) => {
      requireUser();
      requireString(id, 'id');

      await omega.request(NOTES_ROUTE, { method: 'DELETE', body: { id } });

      if (count !== null) {
        setCount(Math.max(0, count - 1));
      }

      return { id };
    },

    // Answered from the cache; the first ask of a worker lifetime fills it
    'notes:count': async () => {
      if (!omega.auth.user.authenticated) {
        return { count: 0 };
      }

      if (count === null) {
        await list();
      }

      return { count };
    },
  };

  // A signed-out account owns no notes: forget the count and clear the badge
  omega.auth.listen(({ user }) => {
    if (!user.authenticated) {
      setCount(null);
    }
  });

  // true keeps the channel open for the async answer (the runtime's contract).
  // Every answer is one envelope: { ok: true, ...result } or { ok: false, error }.
  return omega.messenger.onMessage((message, _sender, sendResponse) => {
    if (!Object.hasOwn(handlers, message.command)) {
      return false;
    }

    handlers[message.command](message.payload || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  });
}
