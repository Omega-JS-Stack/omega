// Main-process tests for lib/deep-link.js — pattern matching, dispatch pipeline, built-ins, override semantics.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'deep-link (main)',
  cleanup: (ctx) => {
    // Drop all consumer handlers we registered. Built-ins stay (they're idempotent).
    ctx.manager.deepLink._handlers = ctx.manager.deepLink._handlers.filter((h) => h.builtin);
  },
  tests: [
    {
      name: 'initialize ran during boot',
      run: (ctx) => {
        ctx.expect(ctx.manager.deepLink._initialized).toBe(true);
      },
    },
    {
      name: 'built-in handlers are registered for auth/token, app/show, app/quit',
      run: (ctx) => {
        const patterns = ctx.manager.deepLink.getHandlers().map((h) => h.pattern);
        ctx.expect(patterns).toContain('auth/token');
        ctx.expect(patterns).toContain('app/show');
        ctx.expect(patterns).toContain('app/quit');
      },
    },
    {
      name: '_parseUrl extracts scheme, route, query for a flat path',
      run: (ctx) => {
        const parsed = ctx.manager.deepLink._parseUrl('myapp://auth/token?token=abc&x=1');
        ctx.expect(parsed.scheme).toBe('myapp');
        ctx.expect(parsed.route).toBe('auth/token');
        ctx.expect(parsed.query).toEqual({ token: 'abc', x: '1' });
      },
    },
    {
      name: '_parseUrl handles nested paths',
      run: (ctx) => {
        const parsed = ctx.manager.deepLink._parseUrl('myapp://user/profile/42');
        ctx.expect(parsed.route).toBe('user/profile/42');
      },
    },
    {
      name: '_parseUrl returns null for malformed urls',
      run: (ctx) => {
        ctx.expect(ctx.manager.deepLink._parseUrl('not a url')).toBeNull();
      },
    },
    {
      name: '_matchPattern: exact match returns empty params',
      run: (ctx) => {
        ctx.expect(ctx.manager.deepLink._matchPattern('auth/token', 'auth/token')).toEqual({});
      },
    },
    {
      name: '_matchPattern: param match returns named params',
      run: (ctx) => {
        ctx.expect(ctx.manager.deepLink._matchPattern('user/profile/42', 'user/profile/:id'))
          .toEqual({ id: '42' });
        ctx.expect(ctx.manager.deepLink._matchPattern('org/foo/repo/bar', 'org/:slug/repo/:repo'))
          .toEqual({ slug: 'foo', repo: 'bar' });
      },
    },
    {
      name: '_matchPattern: mismatched length or static segment returns null',
      run: (ctx) => {
        ctx.expect(ctx.manager.deepLink._matchPattern('auth/token', 'auth/token/extra')).toBeNull();
        ctx.expect(ctx.manager.deepLink._matchPattern('user/x/42', 'user/profile/:id')).toBeNull();
      },
    },
    {
      name: '_matchPattern: wildcard always matches',
      run: (ctx) => {
        ctx.expect(ctx.manager.deepLink._matchPattern('anything/at/all', '*')).toEqual({});
      },
    },
    {
      name: 'on() registers a handler and returns an unsubscribe fn',
      run: (ctx) => {
        const before = ctx.manager.deepLink.getHandlers().length;
        const off = ctx.manager.deepLink.on('test/route', () => {});
        ctx.expect(ctx.manager.deepLink.getHandlers().length).toBe(before + 1);
        off();
        ctx.expect(ctx.manager.deepLink.getHandlers().length).toBe(before);
      },
    },
    {
      name: 'on() validates inputs',
      run: (ctx) => {
        ctx.expect(() => ctx.manager.deepLink.on('', () => {})).toThrow(/non-empty string/);
        ctx.expect(() => ctx.manager.deepLink.on('x', null)).toThrow(/must be a function/);
      },
    },
    {
      name: 'dispatch() fires the matching handler with parsed ctx',
      run: (ctx) => {
        let received;
        const off = ctx.manager.deepLink.on('user/profile/:id', (c) => { received = c; });
        ctx.manager.deepLink.dispatch('myapp://user/profile/42?ref=tray');
        off();

        ctx.expect(received).toBeTruthy();
        ctx.expect(received.url).toBe('myapp://user/profile/42?ref=tray');
        ctx.expect(received.scheme).toBe('myapp');
        ctx.expect(received.route).toBe('user/profile/42');
        ctx.expect(received.pattern).toBe('user/profile/:id');
        ctx.expect(received.params).toEqual({ id: '42' });
        ctx.expect(received.query).toEqual({ ref: 'tray' });
        ctx.expect(received.source).toBe('manual');
      },
    },
    {
      name: 'multiple handlers for the same route fire in order',
      run: (ctx) => {
        const calls = [];
        const off1 = ctx.manager.deepLink.on('foo/bar', () => { calls.push('a'); });
        const off2 = ctx.manager.deepLink.on('foo/bar', () => { calls.push('b'); });
        ctx.manager.deepLink.dispatch('myapp://foo/bar');
        off1(); off2();
        ctx.expect(calls).toEqual(['a', 'b']);
      },
    },
    {
      name: 'consumer handler runs BEFORE built-in for the same route',
      run: (ctx) => {
        const calls = [];
        const off = ctx.manager.deepLink.on('app/show', () => { calls.push('consumer'); });
        // Built-in for app/show calls manager.windows.show — temporarily stub to record the call.
        const origShow = ctx.manager.windows.show;
        ctx.manager.windows.show = () => { calls.push('builtin'); };

        try {
          ctx.manager.deepLink.dispatch('myapp://app/show');
          ctx.expect(calls).toEqual(['consumer', 'builtin']);
        } finally {
          ctx.manager.windows.show = origShow;
          off();
        }
      },
    },
    {
      name: 'ctx.handled = true suppresses subsequent handlers (including built-ins)',
      run: (ctx) => {
        const calls = [];
        const off = ctx.manager.deepLink.on('app/show', (c) => {
          calls.push('consumer');
          c.handled = true;
        });
        const origShow = ctx.manager.windows.show;
        ctx.manager.windows.show = () => { calls.push('builtin'); };

        try {
          ctx.manager.deepLink.dispatch('myapp://app/show');
          ctx.expect(calls).toEqual(['consumer']);
        } finally {
          ctx.manager.windows.show = origShow;
          off();
        }
      },
    },
    {
      name: 'wildcard handler runs only when no concrete handler matched',
      run: (ctx) => {
        const calls = [];
        const offWild     = ctx.manager.deepLink.on('*', () => { calls.push('wild'); });
        const offConcrete = ctx.manager.deepLink.on('foo/bar', () => { calls.push('concrete'); });

        // Concrete match → wildcard does NOT fire.
        ctx.manager.deepLink.dispatch('myapp://foo/bar');

        // No concrete match → wildcard fires.
        ctx.manager.deepLink.dispatch('myapp://nothing/here');

        offWild(); offConcrete();

        ctx.expect(calls).toEqual(['concrete', 'wild']);
      },
    },
    {
      name: 'built-in app/show calls manager.windows.show with query.window',
      run: (ctx) => {
        let shownName = null;
        const orig = ctx.manager.windows.show;
        ctx.manager.windows.show = (name) => { shownName = name; };

        try {
          ctx.manager.deepLink.dispatch('myapp://app/show?window=settings');
          ctx.expect(shownName).toBe('settings');

          shownName = null;
          ctx.manager.deepLink.dispatch('myapp://app/show');
          ctx.expect(shownName).toBe('main');
        } finally {
          ctx.manager.windows.show = orig;
        }
      },
    },
    {
      name: 'built-in auth/token calls omega.handleAuthToken when available',
      run: (ctx) => {
        let receivedToken = null;
        const origHandler = ctx.manager.omega.handleAuthToken;
        ctx.manager.omega.handleAuthToken = (token) => { receivedToken = token; };

        try {
          ctx.manager.deepLink.dispatch('myapp://auth/token?authToken=abc123');
          ctx.expect(receivedToken).toBe('abc123');
        } finally {
          ctx.manager.omega.handleAuthToken = origHandler;
        }
      },
    },
    {
      // MODERN shape only: ?authToken= (what the website's token page sends).
      // Legacy-app formats (?token=, ?payload=) are UJM's concern — @omega.js/desktop ignores them.
      name: 'built-in auth/token reads ONLY ?authToken= (legacy ?token=/?payload= ignored)',
      run: (ctx) => {
        let called = false;
        const origHandler = ctx.manager.omega.handleAuthToken;
        ctx.manager.omega.handleAuthToken = () => { called = true; };

        try {
          ctx.manager.deepLink.dispatch('myapp://auth/token?token=legacy1');
          const payload = encodeURIComponent(JSON.stringify({ token: 'legacy2' }));
          ctx.manager.deepLink.dispatch(`myapp://auth/token?payload=${payload}`);
          ctx.expect(called).toBe(false);
        } finally {
          ctx.manager.omega.handleAuthToken = origHandler;
        }
      },
    },
    {
      name: '_extractUrlFromArgv finds the url in argv',
      run: (ctx) => {
        const argv = ['/path/to/electron', 'main.js', '--flag', 'myapp://auth/token?token=x'];
        ctx.expect(ctx.manager.deepLink._extractUrlFromArgv(argv)).toBe('myapp://auth/token?token=x');
      },
    },
    {
      name: '_extractUrlFromArgv returns null when no scheme matches',
      run: (ctx) => {
        const argv = ['/path/to/electron', 'main.js', '--flag', 'https://example.com'];
        ctx.expect(ctx.manager.deepLink._extractUrlFromArgv(argv)).toBeNull();
      },
    },
    {
      // wave-5 F1: a cold-start auth/token used to dispatch via setImmediate,
      // long before client-bridge booted Firebase — the token was dropped.
      name: 'dispatches before markManagerReady() are queued and drained on it',
      run: (ctx) => {
        const dl = ctx.manager.deepLink;
        const calls = [];
        const off = dl.on('queued/route', (c) => calls.push(c.query.v));
        const origReady = dl._managerReady;
        try {
          dl._managerReady = false;
          dl._handle('myapp://queued/route?v=early', 'cold-start');
          ctx.expect(calls).toEqual([]);            // held, not dispatched
          ctx.expect(dl._bootQueue.length).toBe(1);

          dl.markManagerReady();
          ctx.expect(calls).toEqual(['early']);     // drained in order
          ctx.expect(dl._bootQueue.length).toBe(0);
          ctx.expect(dl._managerReady).toBe(true);
        } finally {
          dl._managerReady = origReady;
          off();
        }
      },
    },
    {
      name: 'handler errors do not stop subsequent handlers',
      run: (ctx) => {
        const calls = [];
        const off1 = ctx.manager.deepLink.on('error/route', () => { throw new Error('boom'); });
        const off2 = ctx.manager.deepLink.on('error/route', () => { calls.push('after-error'); });

        // Should not throw to the caller.
        ctx.manager.deepLink.dispatch('myapp://error/route');
        off1(); off2();

        ctx.expect(calls).toEqual(['after-error']);
      },
    },
  ],
};
