// Build-layer coverage for the ONE messaging lane (lib/messaging.js): every
// context, background included, builds its messenger with its own name as the
// sender, and the auth sync between background and the page contexts rides it.
// Behavioral test for the Messaging class, plus source pins for the context
// modules (browser-context ES modules the bundler owns: `__theme__` and
// `importScripts` make them unloadable from Node, hence the pins).

const path = require('path');
const fs = require('fs');
const defineCases = require('@omega.js/devkit/test/define-cases');

const SRC = path.join(__dirname, '..', '..', '..');
const read = (...segments) => fs.readFileSync(path.join(SRC, ...segments), 'utf8');

// Every context, and the file that names it
const PAGE_CONTEXTS = ['popup', 'options', 'sidepanel', 'page'];
const BASE_CONTEXTS = ['background', 'content', 'offscreen'];

// Load lib/messaging.js fresh against a runtime that records what it is handed
function loadMessaging() {
  const extPath = require.resolve(path.join(SRC, 'lib', 'extension.js'));
  const msgPath = require.resolve(path.join(SRC, 'lib', 'messaging.js'));
  const listeners = [];
  const sent = [];
  global.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: async (msg) => { sent.push(msg); return { answered: msg.command }; },
    },
  };
  delete require.cache[extPath];
  delete require.cache[msgPath];

  const Messaging = require(msgPath);
  const cleanup = () => {
    delete global.chrome;
    delete require.cache[extPath];
    delete require.cache[msgPath];
  };

  return { Messaging, listeners, sent, cleanup };
}

// A promise with its settle functions, for holdUntil() to wait on
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

// Run `fn` collecting every unhandled rejection it leaves behind
async function collectUnhandled(fn) {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await fn();
    await flush();
    await flush();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return unhandled;
}

// A sendResponse that records each answer it is handed
function responder() {
  const answers = [];
  const sendResponse = (...args) => answers.push(args);
  return { answers, sendResponse };
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'lib/messaging: the one lane, and every context\'s own sender',
  tests: [
    {
      name: 'Messaging registers one runtime listener, and send() resolves with the receiver\'s answer',
      run: async (ctx) => {
        const { Messaging, listeners, sent, cleanup } = loadMessaging();
        try {
          const messenger = new Messaging({ sender: 'popup' });
          ctx.expect(listeners.length).toBe(1);

          const answer = await messenger.send({ destination: 'background', command: 'ping', payload: { a: 1 } });
          ctx.expect(sent.length).toBe(1);
          ctx.expect(sent[0].sender).toBe('popup');
          ctx.expect(sent[0].destination).toBe('background');
          ctx.expect(answer).toEqual({ answered: 'ping' });

          // The sender is validated
          let threw = null;
          try { new Messaging({}); } catch (e) { threw = e; }
          ctx.expect(threw).not.toBeNull();
        } finally {
          cleanup();
        }
      },
    },
    {
      name: 'onMessage handlers get the messages addressed to this context, a broadcast, or no one',
      run: (ctx) => {
        const { Messaging, listeners, cleanup } = loadMessaging();
        try {
          const messenger = new Messaging({ sender: 'popup' });
          const heard = [];
          messenger.onMessage((message) => { heard.push(message.command); });

          const [listener] = listeners;
          listener({ destination: 'popup', command: 'mine' }, {}, () => {});
          listener({ destination: Messaging.BROADCAST, command: 'everyone' }, {}, () => {});
          listener({ command: 'raw' }, {}, () => {});
          // A page's message to background also reaches every other open page:
          // it is not theirs
          listener({ destination: 'background', command: 'omega:signOut' }, {}, () => {});

          ctx.expect(heard).toEqual(['mine', 'everyone', 'raw']);
        } finally {
          cleanup();
        }
      },
    },
    {
      name: 'a handler returning true keeps the channel open for an async answer; the unsubscribe removes it',
      run: (ctx) => {
        const { Messaging, listeners, cleanup } = loadMessaging();
        try {
          const messenger = new Messaging({ sender: 'background' });
          const off = messenger.onMessage(() => true);

          const [listener] = listeners;
          ctx.expect(listener({ destination: 'background', command: 'omega:syncAuth' }, {}, () => {})).toBe(true);

          off();
          ctx.expect(listener({ destination: 'background', command: 'omega:syncAuth' }, {}, () => {})).toBe(false);
        } finally {
          cleanup();
        }
      },
    },
    {
      name: 'holdUntil delays dispatch until the promise settles, keeping the channel open meanwhile',
      run: async (ctx) => {
        const { Messaging, listeners, cleanup } = loadMessaging();
        try {
          const messenger = new Messaging({ sender: 'background' });
          const heard = [];
          messenger.onMessage((message) => { heard.push(message.command); });
          const restore = deferred();
          messenger.holdUntil(restore.promise);

          const [listener] = listeners;
          ctx.expect(listener({ destination: 'background', command: 'notes:count' }, {}, () => {})).toBe(true);
          await flush();
          ctx.expect(heard).toEqual([]);

          restore.resolve();
          await flush();
          ctx.expect(heard).toEqual(['notes:count']);

          // Released: the next message is dispatched at once
          listener({ destination: 'background', command: 'after' }, {}, () => {});
          ctx.expect(heard).toEqual(['notes:count', 'after']);
        } finally {
          cleanup();
        }
      },
    },
    {
      name: 'holdUntil: a message for another context is turned away before the hold, never queued',
      run: async (ctx) => {
        const { Messaging, listeners, cleanup } = loadMessaging();
        try {
          const messenger = new Messaging({ sender: 'background' });
          const heard = [];
          messenger.onMessage((message) => { heard.push(message.command); });
          const restore = deferred();
          messenger.holdUntil(restore.promise);

          const { answers, sendResponse } = responder();
          ctx.expect(listeners[0]({ destination: 'popup', command: 'omega:signOut' }, {}, sendResponse)).toBe(false);

          restore.resolve();
          await flush();
          ctx.expect(heard).toEqual([]);
          ctx.expect(answers).toEqual([]);
        } finally {
          cleanup();
        }
      },
    },
    {
      name: 'holdUntil: a held message no handler claims is answered with nothing; a claimed one is left to its handler',
      run: async (ctx) => {
        const { Messaging, listeners, cleanup } = loadMessaging();
        try {
          const messenger = new Messaging({ sender: 'background' });
          messenger.onMessage((message, _sender, sendResponse) => {
            if (message.command !== 'mine') {
              return false;
            }
            setImmediate(() => sendResponse({ ok: true }));
            return true;
          });
          const restore = deferred();
          messenger.holdUntil(restore.promise);

          const unclaimed = responder();
          const claimed = responder();
          listeners[0]({ destination: 'background', command: 'nobody' }, {}, unclaimed.sendResponse);
          listeners[0]({ destination: 'background', command: 'mine' }, {}, claimed.sendResponse);

          restore.resolve();
          await flush();
          await flush();
          ctx.expect(unclaimed.answers).toEqual([[]]);
          ctx.expect(claimed.answers).toEqual([[{ ok: true }]]);
        } finally {
          cleanup();
        }
      },
    },
    {
      name: 'holdUntil: a second hold replaces the first, and the first settling releases nothing',
      run: async (ctx) => {
        const { Messaging, listeners, cleanup } = loadMessaging();
        try {
          const messenger = new Messaging({ sender: 'background' });
          const heard = [];
          messenger.onMessage((message) => { heard.push(message.command); });
          const first = deferred();
          const second = deferred();
          messenger.holdUntil(first.promise);
          messenger.holdUntil(second.promise);

          listeners[0]({ destination: 'background', command: 'held' }, {}, () => {});
          first.resolve();
          await flush();
          ctx.expect(heard).toEqual([]);

          // Still held by the second: a new message waits too
          listeners[0]({ destination: 'background', command: 'later' }, {}, () => {});
          ctx.expect(heard).toEqual([]);

          second.resolve();
          await flush();
          ctx.expect(heard).toEqual(['held', 'later']);
        } finally {
          cleanup();
        }
      },
    },
    {
      name: 'holdUntil: a rejected promise still releases the held messages, and leaves no unhandled rejection',
      run: async (ctx) => {
        const { Messaging, listeners, cleanup } = loadMessaging();
        try {
          const messenger = new Messaging({ sender: 'background' });
          const heard = [];
          messenger.onMessage((message) => { heard.push(message.command); });
          const restore = deferred();
          const unclaimed = responder();

          const unhandled = await collectUnhandled(async () => {
            messenger.holdUntil(restore.promise);
            listeners[0]({ destination: 'background', command: 'notes:count' }, {}, unclaimed.sendResponse);
            restore.reject(new Error('restore failed'));
          });

          ctx.expect(heard).toEqual(['notes:count']);
          ctx.expect(unclaimed.answers).toEqual([[]]);
          ctx.expect(unhandled).toEqual([]);

          // Released for good
          listeners[0]({ destination: 'background', command: 'after' }, {}, () => {});
          ctx.expect(heard).toEqual(['notes:count', 'after']);
        } finally {
          cleanup();
        }
      },
    },
    {
      name: 'holdUntil: a handler that throws on a held message still answers it, with no unhandled rejection',
      run: async (ctx) => {
        const { Messaging, listeners, cleanup } = loadMessaging();
        try {
          const messenger = new Messaging({ sender: 'background' });
          messenger.onMessage(() => { throw new Error('handler broke'); });
          const restore = deferred();
          const held = responder();

          const unhandled = await collectUnhandled(async () => {
            messenger.holdUntil(restore.promise);
            listeners[0]({ destination: 'background', command: 'notes:count' }, {}, held.sendResponse);
            restore.resolve();
          });

          ctx.expect(held.answers).toEqual([[]]);
          ctx.expect(unhandled).toEqual([]);
        } finally {
          cleanup();
        }
      },
    },
    {
      // wave-5 (history-lens catch): the sign-in page was the un-flipped half of
      // the F9 pair: it still built the sign-in URL from authDomain while
      // background.js watched the brand.url host, so the round trip could never
      // complete. Both ends speak brand.url.
      name: 'auth.openPage derives the sign-in URL from brand.url, never authDomain (source pin)',
      run: (ctx) => {
        const source = read('lib', 'extension-auth.js');
        const fnSource = source.slice(source.indexOf('  openPage(options = {}) {'));
        ctx.expect(fnSource.includes('config.brand?.url')).toBe(true);
        // The old read, gone (comments may still NAME authDomain to warn it off)
        ctx.expect(fnSource.includes('config.authDomain')).toBe(false);
      },
    },
    {
      name: 'contextMembers builds the one Messaging, and every context names itself (source pin)',
      run: (ctx) => {
        ctx.expect(read('omega.js').includes('messenger: new Messaging({ sender: name }),')).toBe(true);
        // Both classes take the members from that one home
        ctx.expect(read('omega.js').includes('Object.assign(this, contextMembers(name));')).toBe(true);
        ctx.expect(read('page-context.js').includes('Object.assign(this, contextMembers(name));')).toBe(true);

        for (const name of PAGE_CONTEXTS) {
          ctx.expect(read(`${name}.js`).includes(`new Omega('${name}')`)).toBe(true);
        }
        for (const name of BASE_CONTEXTS) {
          ctx.expect(read(`${name}.js`).includes(`super('${name}');`)).toBe(true);
        }
      },
    },
    {
      name: 'the auth lane rides the messenger: no raw runtime messaging, no service-worker postMessage (source pin)',
      run: (ctx) => {
        const helpers = read('lib', 'auth-helpers.js');
        const backgroundAuth = read('lib', 'background-auth.js');

        for (const source of [helpers, backgroundAuth]) {
          ctx.expect(source.includes('runtime.sendMessage')).toBe(false);
          ctx.expect(source.includes('runtime.onMessage')).toBe(false);
          ctx.expect(source.includes('postMessage')).toBe(false);
          ctx.expect(source.includes('clients.matchAll')).toBe(false);
        }

        ctx.expect(helpers.includes("omega.messenger.send({\n      destination: 'background',\n      command: 'omega:syncAuth',")).toBe(true);
        ctx.expect(helpers.includes("omega.messenger.send({ destination: 'background', command: 'omega:signOut' })")).toBe(true);
        ctx.expect(helpers.includes('omega.messenger.onMessage(')).toBe(true);
        ctx.expect(backgroundAuth.includes('this.omega.messenger.onMessage(')).toBe(true);
        ctx.expect(backgroundAuth.includes("destination: Messaging.BROADCAST, command: 'omega:signOut'")).toBe(true);
        ctx.expect(backgroundAuth.includes("destination: Messaging.BROADCAST, command: 'omega:signInWithToken'")).toBe(true);
      },
    },
  ],
});
