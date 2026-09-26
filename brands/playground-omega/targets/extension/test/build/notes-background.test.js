/**
 * Build-layer test: background's notes commands (src/assets/js/components/background/notes.js).
 *
 * The handlers ride the REAL messenger (@omega.js/extension/lib/messaging),
 * driven through the same seam the framework's own messenger test uses: a
 * `chrome.runtime` that records the one listener the messenger registers, so a
 * message is handed to it exactly as the browser would hand it.
 *
 * Two narrow stubs, each a dependency a build-layer run cannot provide
 * (docs/test-framework.md, exception 2): background's `omega.request` (a real
 * call is an extended-mode concern and needs a signed-in session), and
 * background's auth and action badge (they exist only inside a service worker). The boot layer
 * covers the wired path in the real packaged extension
 * (test/boot/notes-count.test.js).
 */
const path = require('path');

const NOTES_MODULE = path.join(__dirname, '..', '..', 'src', 'assets', 'js', 'components', 'background', 'notes.js');

// Load the real Messaging against a runtime that records its listener
function loadMessaging() {
  const extensionPath = require.resolve('@omega.js/extension/lib/extension');
  const messagingPath = require.resolve('@omega.js/extension/lib/messaging');
  const listeners = [];

  global.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: async () => undefined,
    },
  };
  delete require.cache[extensionPath];
  delete require.cache[messagingPath];

  const Messaging = require(messagingPath);
  const cleanup = () => {
    delete global.chrome;
    delete require.cache[extensionPath];
    delete require.cache[messagingPath];
  };

  return { Messaging, listeners, cleanup };
}

// Background's instance as registerNotes reads it, plus what the test records
function setup({ authenticated, notes = [] }) {
  const { Messaging, listeners, cleanup } = loadMessaging();
  const { registerNotes } = require(NOTES_MODULE);
  const calls = [];
  const badges = [];
  const authListeners = [];

  const omega = {
    messenger: new Messaging({ sender: 'background' }),
    auth: {
      user: { authenticated },
      listen: (callback) => authListeners.push(callback),
    },
    extension: {
      action: { setBadgeText: ({ text }) => badges.push(text) },
    },
    request: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', body: options.body });

      if (options.method === 'POST') {
        return { note: { id: 'new', text: options.body.text } };
      }
      if (options.method === 'DELETE') {
        return { id: options.body.id };
      }
      return { notes };
    },
  };

  const parse = async (html) => `parsed:${html}`;

  registerNotes({ omega, parse });

  // Hand one message to the runtime listener; resolve with its answer, or
  // with the listener's own return when it declined the message
  const send = (message) => new Promise((resolve) => {
    const kept = listeners[0]({ destination: 'background', ...message }, {}, resolve);

    if (kept !== true) {
      resolve({ declined: true });
    }
  });

  return { omega, send, calls, badges, authListeners, cleanup };
}

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'background notes commands over the real messenger',
  tests: [
    {
      name: 'signed out: notes:count answers 0 without calling the API, and notes:list refuses',
      run: async (ctx) => {
        const { send, calls, cleanup } = setup({ authenticated: false });
        try {
          ctx.expect(await send({ command: 'notes:count' })).toEqual({ ok: true, count: 0 });
          ctx.expect(await send({ command: 'notes:list' })).toEqual({ ok: false, error: 'Sign in to use notes.' });
          ctx.expect(calls.length).toBe(0);
        } finally {
          cleanup();
        }
      },
    },
    {
      name: 'signed in: the first notes:count lists once, the next answers from the cache, and the badge follows',
      run: async (ctx) => {
        const { send, calls, badges, cleanup } = setup({ authenticated: true, notes: [{ id: 'a' }, { id: 'b' }] });
        try {
          ctx.expect(await send({ command: 'notes:count' })).toEqual({ ok: true, count: 2 });
          ctx.expect(await send({ command: 'notes:count' })).toEqual({ ok: true, count: 2 });

          ctx.expect(calls).toEqual([{ url: '/notes?limit=100', method: 'GET', body: undefined }]);
          ctx.expect(badges[badges.length - 1]).toBe('2');
        } finally {
          cleanup();
        }
      },
    },
    {
      name: 'notes:create posts the offscreen-parsed text and moves the count up; notes:delete moves it down',
      run: async (ctx) => {
        const { send, calls, badges, cleanup } = setup({ authenticated: true, notes: [{ id: 'a' }] });
        try {
          await send({ command: 'notes:count' });

          const created = await send({ command: 'notes:create', payload: { text: '<b>hi</b>' } });
          ctx.expect(created).toEqual({ ok: true, note: { id: 'new', text: 'parsed:<b>hi</b>' } });
          ctx.expect(calls[1]).toEqual({ url: '/notes', method: 'POST', body: { text: 'parsed:<b>hi</b>' } });
          ctx.expect(await send({ command: 'notes:count' })).toEqual({ ok: true, count: 2 });

          ctx.expect(await send({ command: 'notes:delete', payload: { id: 'a' } })).toEqual({ ok: true, id: 'a' });
          ctx.expect(calls[2]).toEqual({ url: '/notes', method: 'DELETE', body: { id: 'a' } });
          ctx.expect(await send({ command: 'notes:count' })).toEqual({ ok: true, count: 1 });
          ctx.expect(badges[badges.length - 1]).toBe('1');

          // No list beyond the first: create and delete moved the cache
          ctx.expect(calls.filter((call) => call.method === 'GET').length).toBe(1);
        } finally {
          cleanup();
        }
      },
    },
    {
      name: 'a payload that is not a non-empty string is refused before any call',
      run: async (ctx) => {
        const { send, calls, cleanup } = setup({ authenticated: true });
        try {
          const created = await send({ command: 'notes:create', payload: { text: 42 } });
          const deleted = await send({ command: 'notes:delete', payload: { id: '  ' } });

          ctx.expect(created.ok).toBe(false);
          ctx.expect(created.error).toContain('"text"');
          ctx.expect(deleted.ok).toBe(false);
          ctx.expect(deleted.error).toContain('"id"');
          ctx.expect(calls.length).toBe(0);
        } finally {
          cleanup();
        }
      },
    },
    {
      name: 'a sign-out drops the cached count and clears the badge',
      run: async (ctx) => {
        const { omega, send, badges, authListeners, cleanup } = setup({ authenticated: true, notes: [{ id: 'a' }] });
        try {
          await send({ command: 'notes:count' });
          ctx.expect(badges[badges.length - 1]).toBe('1');

          omega.auth.user = { authenticated: false };
          authListeners.forEach((callback) => callback({ user: omega.auth.user }));

          ctx.expect(badges[badges.length - 1]).toBe('');
          ctx.expect(await send({ command: 'notes:count' })).toEqual({ ok: true, count: 0 });
        } finally {
          cleanup();
        }
      },
    },
    {
      name: 'commands it does not own, and messages addressed elsewhere, are left alone',
      run: async (ctx) => {
        const { send, cleanup } = setup({ authenticated: true });
        try {
          ctx.expect(await send({ command: 'omega:syncAuth' })).toEqual({ declined: true });
          ctx.expect(await send({ command: 'toString' })).toEqual({ declined: true });
          ctx.expect(await send({ command: 'notes:count', destination: 'popup' })).toEqual({ declined: true });
        } finally {
          cleanup();
        }
      },
    },
  ],
};
