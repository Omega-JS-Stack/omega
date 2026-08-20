// Main-layer tests for lib/analytics.js — disabled-without-creds path,
// uuidv5 cross-platform identity, event-name normalization, queueing,
// auth-bridge user_id flipping, IPC handlers.

const { v5: uuidv5 } = require('uuid');

async function reinit(ctx, env, configOverrides) {
  ctx.manager.analytics.shutdown();
  const saved = {
    GOOGLE_ANALYTICS_SECRET: process.env.GOOGLE_ANALYTICS_SECRET,
  };
  for (const [k, v] of Object.entries(env || {})) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  const cfgOrig = ctx.manager.config.analytics;
  if (configOverrides !== undefined) {
    ctx.manager.config.analytics = configOverrides;
  }
  ctx.manager.analytics.initialize(ctx.manager);
  return () => {
    ctx.manager.analytics.shutdown();
    for (const [k, v] of Object.entries(saved)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
    ctx.manager.config.analytics = cfgOrig;
    ctx.manager.analytics.initialize(ctx.manager);
  };
}

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'analytics (main)',
  cleanup: async (ctx) => {
    ctx.manager.analytics.shutdown();
    delete process.env.GOOGLE_ANALYTICS_SECRET;
    ctx.manager.analytics.initialize(ctx.manager);
  },
  tests: [
    {
      name: 'analytics module wired on manager',
      run: (ctx) => {
        ctx.expect(ctx.manager.analytics).toBeDefined();
      },
    },
    {
      name: 'enabled=false: short-circuits, no measurementId, no clientId',
      run: async (ctx) => {
        const restore = await reinit(ctx, {}, { enabled: false });
        try {
          ctx.expect(ctx.manager.analytics._enabled).toBe(false);
          ctx.expect(ctx.manager.analytics._clientId).toBe(null);
        } finally { await restore(); }
      },
    },
    {
      name: 'no measurement ID: disabled with warning, no clientId',
      run: async (ctx) => {
        const restore = await reinit(ctx, { GOOGLE_ANALYTICS_SECRET: 'fake-secret' }, {
          enabled: true,
          providers: { google: { id: '' } },
        });
        try {
          ctx.expect(ctx.manager.analytics._enabled).toBe(false);
        } finally { await restore(); }
      },
    },
    {
      name: 'no API secret: disabled (matches @omega.js/backend env-var convention)',
      run: async (ctx) => {
        const restore = await reinit(ctx, { GOOGLE_ANALYTICS_SECRET: null }, {
          enabled: true,
          providers: { google: { id: 'G-TESTID12' } },
        });
        try {
          ctx.expect(ctx.manager.analytics._enabled).toBe(false);
        } finally { await restore(); }
      },
    },
    {
      name: 'fully configured: enabled, has clientId (uuidv5 of deviceId)',
      run: async (ctx) => {
        const restore = await reinit(ctx, { GOOGLE_ANALYTICS_SECRET: 'fake-secret' }, {
          enabled: true,
          providers: { google: { id: 'G-TESTID12' } },
        });
        try {
          ctx.expect(ctx.manager.analytics._enabled).toBe(true);
          ctx.expect(typeof ctx.manager.analytics._clientId).toBe('string');
          ctx.expect(ctx.manager.analytics._clientId.length).toBe(36);
          // Confirm it's a stable derivation: same deviceId + same namespace should
          // produce the same uuidv5 every time.
          const ns = ctx.manager.analytics._namespace;
          const deviceId = ctx.manager.context.session.deviceId;
          ctx.expect(ctx.manager.analytics._clientId).toBe(uuidv5(deviceId, ns));
        } finally { await restore(); }
      },
    },
    {
      name: 'cross-platform identity: same firebase uid → same uuidv5 across surfaces',
      run: async (ctx) => {
        // The whole point: @omega.js/client and @omega.js/backend seeing the same firebase uid
        // produce identical uuidv5 outputs for user_id, given same projectId namespace.
        const restore = await reinit(ctx, { GOOGLE_ANALYTICS_SECRET: 'fake-secret' }, {
          enabled: true,
          providers: { google: { id: 'G-TESTID12' } },
        });
        try {
          const a = ctx.manager.analytics;
          const ns = a._namespace;
          a.setUserId('firebase-uid-abc-123');
          const expected = uuidv5('firebase-uid-abc-123', ns);
          ctx.expect(a._userId).toBe(expected);
          // Re-derive from a fresh uuidv5 call — must match (deterministic).
          ctx.expect(uuidv5('firebase-uid-abc-123', ns)).toBe(expected);
        } finally { await restore(); }
      },
    },
    {
      // wave-5 F5: a pre-init setUserId stored _pendingUid that initialize()
      // never read — the uid was silently discarded.
      name: 'setUserId before initialize is applied at init (pending uid)',
      run: async (ctx) => {
        // Hand-rolled (not reinit()): the helper's leading shutdown() would
        // wipe the very _pendingUid this test plants.
        const a = ctx.manager.analytics;
        a.shutdown(); // _namespace null — the pre-init state

        a.setUserId('early-uid-before-boot');
        ctx.expect(a._pendingUid).toBe('early-uid-before-boot');

        const savedSecret = process.env.GOOGLE_ANALYTICS_SECRET;
        process.env.GOOGLE_ANALYTICS_SECRET = 'fake-secret';
        const cfgOrig = ctx.manager.config.analytics;
        ctx.manager.config.analytics = { enabled: true, providers: { google: { id: 'G-TESTID12' } } };
        try {
          a.initialize(ctx.manager);
          ctx.expect(a._pendingUid).toBe(null);
          ctx.expect(a._userId).toBe(uuidv5('early-uid-before-boot', a._namespace));
        } finally {
          a.shutdown();
          if (savedSecret == null) delete process.env.GOOGLE_ANALYTICS_SECRET;
          else process.env.GOOGLE_ANALYTICS_SECRET = savedSecret;
          ctx.manager.config.analytics = cfgOrig;
          a.initialize(ctx.manager);
        }
      },
    },
    {
      name: 'setUserId(null) clears user_id',
      run: async (ctx) => {
        const restore = await reinit(ctx, { GOOGLE_ANALYTICS_SECRET: 'fake-secret' }, {
          enabled: true,
          providers: { google: { id: 'G-TESTID12' } },
        });
        try {
          ctx.manager.analytics.setUserId('some-uid');
          ctx.expect(ctx.manager.analytics._userId).not.toBe(null);
          ctx.manager.analytics.setUserId(null);
          ctx.expect(ctx.manager.analytics._userId).toBe(null);
        } finally { await restore(); }
      },
    },
    {
      // The catalog owns the NAME now (#328 stage E): this module no longer
      // normalizes free-typed strings, it fires canonical events and the shared
      // adapters decide what GA4 is told. An uncatalogued name is a programmer
      // error — logged and skipped rather than posted as junk.
      name: 'the shared catalog decides the name; an unknown one never posts',
      run: async (ctx) => {
        const restore = await reinit(ctx, { GOOGLE_ANALYTICS_SECRET: 'fake-secret' }, {
          enabled: true,
          providers: { google: { id: 'G-TESTID12' } },
        });

        const a = ctx.manager.analytics;
        const origSend = a._send;
        const sent = [];
        a._send = (descriptor) => { sent.push(descriptor); return true; };

        try {
          a.event('screen_view', { screen_name: 'Settings' });
          ctx.expect(sent.length).toBe(1);
          ctx.expect(sent[0].provider).toBe('ga4');
          ctx.expect(sent[0].name).toBe('screen_view');
          ctx.expect(sent[0].payload.screen_name).toBe('Settings');
          // The enrichment desktop still owns rides the payload
          ctx.expect(typeof sent[0].payload.session_id).toBe('string');
          ctx.expect(typeof sent[0].payload.engagement_time_msec).toBe('number');

          sent.length = 0;
          a.event('Hello World!', { x: 1 });
          ctx.expect(sent.length).toBe(0);
        } finally {
          a._send = origSend;
          await restore();
        }
      },
    },
    {
      name: '_enrichParams adds session_id + engagement_time_msec',
      run: (ctx) => {
        const params = ctx.manager.analytics._enrichParams({ custom: 'value' });
        ctx.expect(params.custom).toBe('value');
        ctx.expect(typeof params.session_id).toBe('string');
        ctx.expect(typeof params.engagement_time_msec).toBe('number');
        ctx.expect(params.engagement_time_msec >= 1).toBe(true);
        ctx.expect('page_location' in params).toBe(true);
        ctx.expect('page_title' in params).toBe(true);
      },
    },
    {
      name: 'event() with disabled analytics is a no-op (no throw)',
      run: async (ctx) => {
        const restore = await reinit(ctx, {}, { enabled: false });
        try {
          // Should not throw.
          ctx.manager.analytics.event('app_launch', { x: 1 });
          ctx.expect(true).toBe(true);
        } finally { await restore(); }
      },
    },
    {
      name: 'event() before init queues, queue is bounded',
      run: (ctx) => {
        const a = ctx.manager.analytics;
        a.shutdown();   // back to uninitialized state
        a.event('queued_one');
        a.event('queued_two');
        ctx.expect(a._queue.length).toBe(2);
        ctx.manager.analytics.initialize(ctx.manager);   // restore for downstream tests
      },
    },
    {
      name: 'queue flushes on init',
      run: async (ctx) => {
        // Force a "before init" state with a couple of queued items.
        ctx.manager.analytics.shutdown();
        ctx.manager.analytics._queue.push({ name: 'x', params: {} });
        ctx.manager.analytics._queue.push({ name: 'y', params: {} });
        const restore = await reinit(ctx, { GOOGLE_ANALYTICS_SECRET: 'fake-secret' }, {
          enabled: true,
          providers: { google: { id: 'G-TESTID12' } },
        });
        try {
          // After init, queue should be drained.
          ctx.expect(ctx.manager.analytics._queue.length).toBe(0);
        } finally { await restore(); }
      },
    },
    {
      name: 'auth bridge: setUserId fires on auth, clears on logout',
      run: async (ctx) => {
        const restore = await reinit(ctx, { GOOGLE_ANALYTICS_SECRET: 'fake-secret' }, {
          enabled: true,
          providers: { google: { id: 'G-TESTID12' } },
        });
        try {
          const a = ctx.manager.analytics;
          // Simulate auth bridge firing.
          a._handleAuthChange({ uid: 'user-123' });
          ctx.expect(a._userId).not.toBe(null);
          // Logout.
          a._handleAuthChange({ uid: null });
          ctx.expect(a._userId).toBe(null);
        } finally { await restore(); }
      },
    },
    {
      name: 'setUserProperties merges into _userProperties as { value: ... }',
      run: async (ctx) => {
        const restore = await reinit(ctx, { GOOGLE_ANALYTICS_SECRET: 'fake-secret' }, {
          enabled: true,
          providers: { google: { id: 'G-TESTID12' } },
        });
        try {
          ctx.manager.analytics.setUserProperties({ plan: 'premium', custom_flag: true });
          ctx.expect(ctx.manager.analytics._userProperties.plan).toEqual({ value: 'premium' });
          ctx.expect(ctx.manager.analytics._userProperties.custom_flag).toEqual({ value: true });
        } finally { await restore(); }
      },
    },
    {
      name: 'IPC handler desktop:analytics:status returns the JSON snapshot',
      run: async (ctx) => {
        const restore = await reinit(ctx, { GOOGLE_ANALYTICS_SECRET: 'fake-secret' }, {
          enabled: true,
          providers: { google: { id: 'G-TESTID12' } },
        });
        try {
          const snap = await ctx.manager.ipc.invoke('desktop:analytics:status');
          ctx.expect(snap.enabled).toBe(true);
          ctx.expect(snap.measurementId).toBe('G-TESTID12');
        } finally { await restore(); }
      },
    },
    {
      name: 'IPC listener desktop:analytics:event routes to analytics.event',
      run: async (ctx) => {
        const a = ctx.manager.analytics;
        const origEvent = a.event;
        let captured = null;
        a.event = (name, params) => { captured = { name, params }; };
        try {
          // Simulate an inbound IPC call (renderer would do ipcRenderer.send).
          const listeners = ctx.manager.ipc._listeners?.['desktop:analytics:event'];
          ctx.expect(listeners).toBeDefined();
          listeners.forEach((fn) => fn({ name: 'rendererEvent', params: { x: 1 } }));
          ctx.expect(captured).toEqual({ name: 'rendererEvent', params: { x: 1 } });
        } finally { a.event = origEvent; }
      },
    },
    {
      name: 'toJSON exposes safe inspection state (no secret)',
      run: async (ctx) => {
        const restore = await reinit(ctx, { GOOGLE_ANALYTICS_SECRET: 'fake-secret' }, {
          enabled: true,
          providers: { google: { id: 'G-TESTID12' } },
        });
        try {
          const j = ctx.manager.analytics.toJSON();
          ctx.expect(j.enabled).toBe(true);
          ctx.expect(j.measurementId).toBe('G-TESTID12');
          ctx.expect(typeof j.clientId).toBe('string');
          ctx.expect('userId' in j).toBe(true);
          ctx.expect('queueLength' in j).toBe(true);
          // Secret must NOT leak.
          ctx.expect('apiSecret' in j).toBe(false);
          ctx.expect(JSON.stringify(j).indexOf('fake-secret')).toBe(-1);
        } finally { await restore(); }
      },
    },
  ],
};
