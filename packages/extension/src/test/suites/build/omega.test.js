// Build-layer tests for the ONE `Omega` runtime every extension context exports
// ([#945](https://github.com/Omega-JS-Stack/omega/issues/945)).
//
// Each context module exports ONE ready-made instance as its default and the
// class as the named `Omega`; a consumer never writes `new`. Two classes carry
// the seven contexts: src/omega.js (background, content, offscreen) and
// src/page-context.js (popup, options, sidepanel, page, on @omega.js/client),
// and both take `context`, `extension`, `logger` and `messenger` from
// contextMembers().
//
// Loaded for real where Node can load it: src/omega.js, content.js,
// offscreen.js, background.js, lib/extension-auth.js, lib/background-auth.js
// and lib/auth-helpers.js. The page contexts (a `__theme__` import the bundler
// aliases) only load in a browser, so those are pinned by source, the model the
// rest of this suite uses.
//
// The one runtime seam Node lacks is `chrome.runtime`: lib/extension.js reads it
// once at load, so it is present while these modules load, and it records
// nothing and answers nothing (wave5-messenger.test.js drives the messaging).
// background.js adds the worker's two globals, `importScripts` and `self`.

const path = require('path');
const fs = require('fs');
const http = require('http');
const { pathToFileURL } = require('url');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { User } = require('@omega.js/account');

const SRC = path.join(__dirname, '..', '..', '..');
const read = (...segments) => fs.readFileSync(path.join(SRC, ...segments), 'utf8');
const url = (...segments) => pathToFileURL(path.join(SRC, ...segments)).href;

const PAGE_CONTEXTS = ['popup', 'options', 'sidepanel', 'page'];
const BASE_CONTEXTS = ['background', 'content', 'offscreen'];
const ALL_CONTEXTS = [...BASE_CONTEXTS, ...PAGE_CONTEXTS];

const RUNTIME = {
  onMessage: { addListener: () => {} },
  onInstalled: { addListener: () => {} },
  sendMessage: async () => undefined,
  getManifest: () => ({ version: '1.2.3' }),
};

// Run `fn` with `chrome.runtime` present, the way every context runs
function withRuntime(fn) {
  global.chrome = { runtime: RUNTIME };
  try {
    return fn();
  } finally {
    delete global.chrome;
  }
}

// Import an extension module with the runtime present. The first load of
// lib/extension.js binds the runtime, so a copy another suite required without
// one is dropped first.
async function importWithRuntime(...segments) {
  global.chrome = { runtime: RUNTIME };
  for (const file of [['lib', 'extension.js'], ['lib', 'messaging.js']]) {
    delete require.cache[require.resolve(path.join(SRC, ...file))];
  }
  try {
    return await import(url(...segments));
  } finally {
    delete global.chrome;
  }
}

// Run `fn` with the env vars in `vars` set (undefined = deleted); the
// originals come back after.
function withEnv(vars, fn) {
  const saved = Object.keys(vars).map((key) => [key, process.env[key]]);
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// Import background.js with the worker's globals present: `importScripts` (its
// line one loads /build.js) and `self` (the listeners it adds at load). Its
// instance reads `config` from the build snapshot as it is constructed.
async function importBackground(config) {
  global.importScripts = () => {};
  global.self = { addEventListener: () => {} };
  globalThis.OMEGA_BUILD_JSON = { config };
  try {
    return await importWithRuntime('background.js');
  } finally {
    delete global.importScripts;
    delete global.self;
    delete globalThis.OMEGA_BUILD_JSON;
  }
}

// A local API that records what reaches it and answers `{ ok: true }`
async function startApi() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  return { port: server.address().port, received, close: () => new Promise((resolve) => server.close(resolve)) };
}

// A signed-in page's account: the stored document with an active paid plan
const IDENTITY = { uid: 'user-1', email: 'one@example.com', displayName: 'One', photoURL: 'https://example.com/one.png', emailVerified: true };
const DOCUMENT = { subscription: { product: { id: 'premium' }, status: 'active' } };

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'Omega: one instance per context, the context members, auth.user a User',
  timeout: 60000,
  tests: [
    {
      name: 'content and offscreen export their instance as default and its class as the named Omega',
      run: async (ctx) => {
        const base = await importWithRuntime('omega.js');

        for (const name of ['content', 'offscreen']) {
          const mod = await importWithRuntime(`${name}.js`);
          ctx.expect(mod.default).toBeInstanceOf(mod.Omega);
          ctx.expect(mod.default).toBeInstanceOf(base.Omega);
          ctx.expect(mod.default.context).toBe(name);
        }
      },
    },
    {
      name: 'every context module exports ONE instance and its class (source pin)',
      run: (ctx) => {
        for (const name of ALL_CONTEXTS) {
          const source = read(`${name}.js`);
          ctx.expect(source).toMatch(/^const omega = new Omega\([^)]*\);$/m);
          ctx.expect(source).toMatch(/^export default omega;$/m);
          ctx.expect(source).toMatch(/^export \{ Omega \};$/m);
        }
        for (const name of PAGE_CONTEXTS) {
          ctx.expect(read(`${name}.js`).includes("import { Omega } from './page-context.js';")).toBe(true);
        }
        for (const name of BASE_CONTEXTS) {
          ctx.expect(read(`${name}.js`).includes('class Omega extends BaseOmega {')).toBe(true);
        }
        // The page class is the client's base class, with the context members
        const page = read('page-context.js');
        ctx.expect(page.includes("import { Omega as ClientOmega } from '@omega.js/client';")).toBe(true);
        ctx.expect(page.includes('class Omega extends ClientOmega {')).toBe(true);
      },
    },
    {
      name: 'contextMembers(name) builds context, extension, logger and messenger for all seven contexts',
      run: async (ctx) => {
        const { contextMembers } = await importWithRuntime('omega.js');

        for (const name of ALL_CONTEXTS) {
          const members = contextMembers(name);
          ctx.expect(Object.keys(members).sort()).toEqual(['context', 'extension', 'logger', 'messenger']);
          ctx.expect(members.context).toBe(name);
          ctx.expect(members.logger.name).toBe(name);
          ctx.expect(members.messenger.sender).toBe(name);
          ctx.expect(members.extension.runtime).toBe(RUNTIME);
        }
      },
    },
    {
      name: 'the base class carries config, version, the env helpers and getApiUrl, and initialize() settles ready',
      run: async (ctx) => {
        const { Omega } = await importWithRuntime('omega.js');

        globalThis.OMEGA_BUILD_JSON = { config: { environment: 'production', brand: { url: 'https://playground.omegajs.dev' } } };
        let omega;
        try {
          omega = withRuntime(() => new Omega('offscreen'));
        } finally {
          delete globalThis.OMEGA_BUILD_JSON;
        }

        ctx.expect(omega.messenger.sender).toBe('offscreen');
        ctx.expect(omega.version).toBe('1.2.3');
        ctx.expect(omega.config.brand.url).toBe('https://playground.omegajs.dev');

        // No process env in a packed extension: the baked word answers
        withEnv({ OMEGA_ENVIRONMENT: undefined }, () => {
          ctx.expect(omega.getEnvironment()).toBe('production');
          ctx.expect(omega.isProduction()).toBe(true);
          ctx.expect(omega.getApiUrl()).toBe('https://api.playground.omegajs.dev');
        });

        ctx.expect(await omega.initialize()).toBe(omega);
        ctx.expect(await omega.ready).toBe(omega);
      },
    },
    {
      name: 'a page context\'s auth is the client\'s Auth plus openPage(), and auth.user is a User',
      run: async (ctx) => {
        const { Omega: ClientOmega } = await import('@omega.js/client');
        const { default: Auth } = await import('@omega.js/client/modules/auth.js');
        const { ExtensionAuth } = await import(url('lib', 'extension-auth.js'));

        const auth = new ExtensionAuth(new ClientOmega());

        ctx.expect(auth).toBeInstanceOf(Auth);
        ctx.expect(typeof auth.openPage).toBe('function');
        ctx.expect(auth.user.constructor.name).toBe('User');
        ctx.expect(auth.user.authenticated).toBe(false);
        ctx.expect(auth.user.plan).toBe('basic');

        // The page class installs it over the client's Auth
        ctx.expect(read('page-context.js').includes('this.auth = new ExtensionAuth(this);')).toBe(true);
      },
    },
    {
      name: 'background auth.user is a signed-out User until a page pushes its account, then plan reads from it',
      run: async (ctx) => {
        const { Omega } = await importWithRuntime('omega.js');
        const { BackgroundAuth } = await importWithRuntime('lib', 'background-auth.js');
        const { syncWithBackground } = await import(url('lib', 'auth-helpers.js'));

        const auth = new BackgroundAuth(withRuntime(() => new Omega('background')));
        ctx.expect(auth.user).toBeInstanceOf(User);
        ctx.expect(auth.user.authenticated).toBe(false);
        ctx.expect(auth.user.plan).toBe('basic');

        // What a signed-in page pushes, captured off the real sync
        const pageUser = new User(DOCUMENT, IDENTITY);
        let pushed = null;
        await syncWithBackground({
          request: async () => {},
          auth: { listen: (options, callback) => callback({ user: pageUser, denied: false }) },
          messenger: { send: async (message) => { pushed = message; return { needsSync: false }; } },
        });
        ctx.expect(pushed.destination).toBe('background');
        ctx.expect(pushed.command).toBe('omega:syncAuth');
        ctx.expect(pushed.payload).toEqual({ ...IDENTITY, document: pageUser.toJSON() });

        // The worker's session, signed in as the same uid. This is the one
        // seam: a real signed-in worker session needs the auth emulator, which
        // the e2e-extension lane drives.
        auth._firebaseAuth = { currentUser: { uid: IDENTITY.uid, email: IDENTITY.email } };

        const heard = [];
        auth.listen((state) => heard.push(state.user));

        ctx.expect(await auth.handleSyncAuth(pushed.payload)).toEqual({ needsSync: false });
        ctx.expect(auth.user).toBeInstanceOf(User);
        ctx.expect(auth.user.uid).toBe('user-1');
        ctx.expect(auth.user.plan).toBe('premium');
        ctx.expect(auth.user.profile.displayName).toBe('One');
        ctx.expect(auth.user.toJSON()).toEqual(pageUser.toJSON());
        ctx.expect(heard[heard.length - 1]).toBe(auth.user);

        // The session ends: the account goes with it
        auth.handleAuthStateChange(null);
        ctx.expect(auth.user.authenticated).toBe(false);
        ctx.expect(auth.user.plan).toBe('basic');
      },
    },
    {
      name: 'background lands nothing from a page whose uid is not its session\'s',
      run: async (ctx) => {
        const { Omega } = await importWithRuntime('omega.js');
        const { BackgroundAuth } = await importWithRuntime('lib', 'background-auth.js');

        const auth = new BackgroundAuth(withRuntime(() => new Omega('background')));
        auth._firebaseAuth = { currentUser: null };

        const response = await auth.handleSyncAuth({ ...IDENTITY, document: DOCUMENT });

        ctx.expect(response).toEqual({ needsSync: true, signOut: true });
        ctx.expect(auth.user.authenticated).toBe(false);
        ctx.expect(auth.user.plan).toBe('basic');
      },
    },
    {
      // Desktop main's shape: `omega.auth.getIdToken()` is the session's token,
      // and the instance fetches with it
      name: 'background\'s omega.request posts with the token omega.auth.getIdToken returns; signed out, getIdToken is null',
      run: async (ctx) => {
        const api = await startApi();
        try {
          const { default: omega } = await importBackground({ environment: 'testing', brand: { url: 'https://playground.omegajs.dev' } });

          // The worker's session. The one seam: a real signed-in worker
          // session needs the auth emulator, which the e2e-extension lane drives.
          omega.auth._firebaseAuth = { currentUser: { getIdToken: async () => 'token-1' } };
          ctx.expect(await omega.auth.getIdToken()).toBe('token-1');

          // The API base is read as the call starts: the local stack, here this server
          const vars = { OMEGA_ENVIRONMENT: 'testing', OMEGA_HTTPS_PORT: undefined, OMEGA_HOSTING_PORT: String(api.port) };
          const answer = await withEnv(vars, () => omega.request('/notes', { method: 'POST', body: { text: 'hi' } }));

          ctx.expect(answer).toEqual({ ok: true });
          ctx.expect(api.received).toEqual([{ method: 'POST', url: '/notes', authorization: 'Bearer token-1', body: '{"text":"hi"}' }]);

          omega.auth._firebaseAuth = { currentUser: null };
          ctx.expect(await omega.auth.getIdToken()).toBeNull();
          omega.auth._firebaseAuth = null;
          ctx.expect(await omega.auth.getIdToken()).toBeNull();
        } finally {
          await api.close();
        }
      },
    },
    {
      name: 'background builds its auth and its messenger like every context (source pin)',
      run: (ctx) => {
        const source = read('background.js');
        ctx.expect(source.includes("super('background');")).toBe(true);
        ctx.expect(source.includes('this.auth = new BackgroundAuth(this);')).toBe(true);
        // Retired with the move: the stub, the dead library slots, the second logger
        ctx.expect(source.includes('initializeFirebase')).toBe(false);
        ctx.expect(source.includes('libraries')).toBe(false);
        ctx.expect(source.includes('authLogger')).toBe(false);
      },
    },
  ],
});
