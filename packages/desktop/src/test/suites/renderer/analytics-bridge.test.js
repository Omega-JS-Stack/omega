// Renderer-layer round-trip tests for window.desktop.{analytics,context,usage,remoteConfig}.
// Verifies the contextBridge surfaces actually round-trip through IPC into main.

module.exports = {
  type: 'suite',
  layer: 'renderer',
  description: 'analytics + context + usage + remote-config bridges (renderer)',
  tests: [
    {
      name: 'window.desktop.analytics has event / pageview / screenview / setUserProperties / getStatus',
      run: (ctx) => {
        ctx.expect(typeof window.desktop.analytics.event).toBe('function');
        ctx.expect(typeof window.desktop.analytics.pageview).toBe('function');
        ctx.expect(typeof window.desktop.analytics.screenview).toBe('function');
        ctx.expect(typeof window.desktop.analytics.setUserProperties).toBe('function');
        ctx.expect(typeof window.desktop.analytics.getStatus).toBe('function');
      },
    },
    {
      name: 'window.desktop.analytics.getStatus round-trips main state',
      run: async (ctx) => {
        const status = await window.desktop.analytics.getStatus();
        ctx.expect(status).toBeDefined();
        // Should always have the enabled boolean — even when analytics is off.
        ctx.expect(typeof status.enabled).toBe('boolean');
      },
    },
    {
      name: 'window.desktop.analytics.event is fire-and-forget (no throw)',
      run: (ctx) => {
        // No await — send is one-way. Just verify it doesn't throw.
        window.desktop.analytics.event('renderer_test_event', { from: 'renderer' });
        window.desktop.analytics.pageview('/test/path');
        window.desktop.analytics.screenview('TestScreen');
        ctx.expect(true).toBe(true);
      },
    },
    {
      name: 'window.desktop.context.get returns the context snapshot',
      run: async (ctx) => {
        const snap = await window.desktop.context.get();
        ctx.expect(snap).toBeDefined();
        ctx.expect(snap.session).toBeDefined();
        ctx.expect(snap.client).toBeDefined();
        ctx.expect(typeof snap.session.id).toBe('string');
        ctx.expect(snap.session.id.length).toBe(36);   // uuid
        ctx.expect(typeof snap.client.platform).toBe('string');
      },
    },
    {
      name: 'window.desktop.usage.get returns the usage snapshot',
      run: async (ctx) => {
        const snap = await window.desktop.usage.get();
        ctx.expect(snap).toBeDefined();
        ctx.expect(typeof snap.opens).toBe('number');
        ctx.expect(typeof snap.hoursTotal).toBe('number');
        ctx.expect(typeof snap.hoursThisSession).toBe('number');
      },
    },
    {
      name: 'window.desktop.remoteConfig.get / refreshNow / onUpdate are functions',
      run: (ctx) => {
        ctx.expect(typeof window.desktop.remoteConfig.get).toBe('function');
        ctx.expect(typeof window.desktop.remoteConfig.refreshNow).toBe('function');
        ctx.expect(typeof window.desktop.remoteConfig.onUpdate).toBe('function');
      },
    },
    {
      name: 'window.desktop.remoteConfig.onUpdate returns an unsub function',
      run: (ctx) => {
        const off = window.desktop.remoteConfig.onUpdate(() => {});
        ctx.expect(typeof off).toBe('function');
        off();
      },
    },
  ],
};
