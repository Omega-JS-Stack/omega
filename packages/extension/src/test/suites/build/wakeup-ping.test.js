// Build-layer pin for the extension's wakeup ping
// ([#644](https://github.com/Omega-JS-Stack/omega/issues/644)).
//
// Every surface (popup/options/sidepanel/page) opens by calling
// syncWithBackground(), and background answers a sync that needs a token by
// POSTing /omega/user/token — the extension's first backend call, on a function
// that is cold on the first surface a user opens. The ping goes out before the
// auth settle, so the cold start burns down while Firebase comes up.
//
// auth-helpers.js is a browser-context ES module, but a transport-free one: it
// takes its context as an argument, so this imports the REAL function rather
// than pinning its source (the model auth-triggers.test.js had to use for the
// DOM-bound halves of the same file).

const path = require('path');
const { pathToFileURL } = require('url');

const { WAKEUP_ROUTE } = require('@omega.js/client/modules/request.js');

const AUTH_HELPERS = pathToFileURL(path.join(__dirname, '..', '..', '..', 'lib', 'auth-helpers.js')).href;

// A surface's context: the omega singleton and the runtime messaging channel,
// with everything the sync touches recorded in the order it happened.
function makeContext({ needsSync = false } = {}) {
  const requests = [];
  const timeline = [];

  return {
    requests,
    timeline,
    context: {
      extension: {
        runtime: {
          lastError: null,
          sendMessage: (message, callback) => {
            timeline.push(message.command);
            callback({ needsSync });
          },
        },
      },
      omega: {
        request: async (url, options = {}) => {
          requests.push({ url, options });
          timeline.push(options.wakeup ? 'wakeup' : url);
        },
        auth: () => ({
          listen: (options, callback) => {
            timeline.push('auth-settle');
            callback({ user: null });
          },
        }),
      },
    },
  };
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'wakeup ping — a surface warms the backend before it waits on auth (#644)',
  tests: [
    {
      name: 'syncWithBackground fires exactly one wakeup, aimed at the shared route',
      run: async (ctx) => {
        const { syncWithBackground } = await import(AUTH_HELPERS);
        const { context, requests } = makeContext();

        await syncWithBackground(context);

        ctx.expect(requests.length).toBe(1);
        ctx.expect(requests[0].url).toBe(WAKEUP_ROUTE);
        ctx.expect(requests[0].options.wakeup).toBe(true);
      },
    },
    {
      name: 'the ping goes out BEFORE the auth settle and the background round trip',
      run: async (ctx) => {
        const { syncWithBackground } = await import(AUTH_HELPERS);
        const { context, timeline } = makeContext();

        await syncWithBackground(context);

        ctx.expect(timeline[0]).toBe('wakeup');
        ctx.expect(timeline[1]).toBe('auth-settle');
        ctx.expect(timeline[2]).toBe('omega:syncAuth');
      },
    },
  ],
};
