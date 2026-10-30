/**
 * cdp-live tests: `whileLive(session, work, onCrash)` is the one race between
 * a CDP call and the page crashing under it. A crash must end the wait at
 * once with the caller's own error, and the crash listener never outlives
 * the call either way.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const { EventEmitter } = require('node:events');

const { whileLive } = require('@omega.js/devkit/cdp-live');

const CRASHED = 'Inspector.targetCrashed';

// A promise and its settle handles, so a case decides when work ends.
function deferred() {
  const handles = {};
  handles.promise = new Promise((resolve, reject) => Object.assign(handles, { resolve, reject }));
  return handles;
}

module.exports = defineCases({
  type: 'group',
  description: 'cdp-live',
  tests: [
    {
      name: 'work that resolves answers its value, and the crash listener is removed',
      run: async (ctx) => {
        const session = new EventEmitter();

        const value = await whileLive(session, Promise.resolve('evaluated'), () => new Error('crashed'));

        ctx.expect(value).toBe('evaluated');
        ctx.expect(session.listenerCount(CRASHED), 'a listener left behind fires on a later crash').toBe(0);
      },
    },

    {
      name: 'a crash before work settles rejects at once with the onCrash error, and the listener is removed',
      run: async (ctx) => {
        const session = new EventEmitter();
        const work = deferred();
        const crash = new Error('the page crashed under the call');

        const raced = whileLive(session, work.promise, () => crash);
        ctx.expect(session.listenerCount(CRASHED), 'the race listens for the crash').toBe(1);
        session.emit(CRASHED, {});

        // work never settles: only the crash can end this wait.
        await ctx.expect(raced).rejects.toBe(crash);
        ctx.expect(session.listenerCount(CRASHED)).toBe(0);
        work.resolve('too late');
      },
    },

    {
      name: 'work that rejects passes its own error through',
      run: async (ctx) => {
        const session = new EventEmitter();
        const failure = new Error('Runtime.evaluate failed');

        await ctx.expect(whileLive(session, Promise.reject(failure), () => new Error('crashed'))).rejects.toBe(failure);
        ctx.expect(session.listenerCount(CRASHED)).toBe(0);
      },
    },
  ],
});
