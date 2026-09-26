/**
 * Main-layer test: main's half of the notes feature (src/lib/notes.js), wired
 * onto the REAL booted instance the harness hands every main suite: real
 * omega.ipc, real omega.storage (the app store), real omega.auth.
 *
 * The harness never runs this project's src/main.js, so each test wires the
 * module itself and tears it down, leaving the harness instance as it found it.
 */
const path = require('path');

const notes = require(path.join(__dirname, '..', '..', 'src', 'lib', 'notes.js'));

const COUNT_KEY = 'notes.count';

// Wire, run, and always tear down (a second handle() on one channel throws)
async function withNotes(ctx, fn) {
  const teardown = notes.initialize(ctx.omega);
  try {
    await fn();
  } finally {
    teardown();
    ctx.omega.storage.delete(COUNT_KEY);
  }
}

// A renderer's one-way message, through Electron's real ipcMain dispatch
function reportFromRenderer(payload) {
  require('electron').ipcMain.emit('notes:report', {}, payload);
}

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'notes: main-process IPC, app store and auth',
  tests: [
    {
      name: 'notes:count answers the app store\'s last count, 0 before any report',
      run: (ctx) => withNotes(ctx, async () => {
        ctx.omega.storage.delete(COUNT_KEY);
        ctx.expect(await ctx.omega.ipc.invoke('notes:count')).toEqual({ count: 0 });

        ctx.omega.storage.set(COUNT_KEY, 5);
        ctx.expect(await ctx.omega.ipc.invoke('notes:count')).toEqual({ count: 5 });
      }),
    },
    {
      name: 'a renderer report lands in the app store, and notes:count answers it',
      run: (ctx) => withNotes(ctx, async () => {
        reportFromRenderer({ count: 3 });

        ctx.expect(ctx.omega.storage.get(COUNT_KEY)).toBe(3);
        ctx.expect(await ctx.omega.ipc.invoke('notes:count')).toEqual({ count: 3 });
        ctx.expect(notes.trayLabel(ctx.omega)).toBe('Notes: 3');
      }),
    },
    {
      name: 'a report with no valid count is ignored (zero-trust payloads)',
      run: (ctx) => withNotes(ctx, async () => {
        ctx.omega.storage.set(COUNT_KEY, 2);

        for (const payload of [{ count: -1 }, { count: 1.5 }, { count: '4' }, {}, null]) {
          reportFromRenderer(payload);
        }

        ctx.expect(ctx.omega.storage.get(COUNT_KEY)).toBe(2);
      }),
    },
    {
      name: 'a sign-out clears the count; the signed-out catch-up at boot does not',
      run: (ctx) => withNotes(ctx, async () => {
        const auth = ctx.omega.auth;
        const User = auth.user.constructor;

        ctx.omega.storage.set(COUNT_KEY, 4);

        // listen() delivers its catch-up (signed out, in this harness) a
        // microtask later: that must leave the count alone
        await Promise.resolve();
        ctx.expect(ctx.omega.storage.get(COUNT_KEY)).toBe(4);

        // Land a signed-in state, then a signed-out one, the way the framework's
        // own auth suite drives listeners
        auth._land(new User({}, { uid: 'notes-test', email: 'notes@example.com' }));
        ctx.expect(ctx.omega.storage.get(COUNT_KEY)).toBe(4);

        auth._land(new User());
        ctx.expect(ctx.omega.storage.has(COUNT_KEY)).toBe(false);
      }),
    },
    {
      name: 'the teardown unregisters every channel it wired',
      run: async (ctx) => {
        const teardown = notes.initialize(ctx.omega);

        ctx.expect(ctx.omega.ipc.hasHandler('notes:count')).toBe(true);
        ctx.expect(ctx.omega.ipc.listenerCount('notes:report')).toBe(1);

        teardown();

        ctx.expect(ctx.omega.ipc.hasHandler('notes:count')).toBe(false);
        ctx.expect(ctx.omega.ipc.listenerCount('notes:report')).toBe(0);
      },
    },
  ],
};
