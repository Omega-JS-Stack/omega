// Main-process tests for lib/menu.js — file-based application menu + builder API.
//
// In the harness, no consumer src/menu/index.js exists, so menu falls back to
// the default template. We then exercise the runtime define()/builder API.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'menu (main)',
  cleanup: (ctx) => {
    ctx.omega.menu.destroy();
  },
  tests: [
    {
      name: 'initialize ran (enabled by default)',
      run: (ctx) => {
        ctx.expect(ctx.omega.menu._initialized).toBe(true);
      },
    },
    {
      name: 'no consumer definition file → default template loaded',
      run: (ctx) => {
        const items = ctx.omega.menu.getItems();
        ctx.expect(Array.isArray(items)).toBe(true);
        ctx.expect(items.length).toBeGreaterThan(0);

        // Find expected top-level entries (some are platform-specific; Edit/View/Window are universal).
        const labels = items.map((i) => i.label);
        ctx.expect(labels).toContain('Edit');
        ctx.expect(labels).toContain('View');
        ctx.expect(labels).toContain('Window');
      },
    },
    {
      name: 'default template renders and Menu.setApplicationMenu was called',
      run: (ctx) => {
        ctx.expect(ctx.omega.menu.isRendered()).toBe(true);
        ctx.expect(ctx.omega.menu.getMenu()).toBeTruthy();
      },
    },
    {
      name: 'macOS: first menu is the app menu (productName)',
      run: (ctx) => {
        if (process.platform !== 'darwin') {
          ctx.skip('macOS-only behavior');
        }
        // Menu falls back to brand.name when no productName is configured (lib/menu.js).
        const productName = ctx.omega.config.app?.productName || ctx.omega.config.brand.name;
        const items = ctx.omega.menu.getItems();
        ctx.expect(items[0].label).toBe(productName);
      },
    },
    {
      name: 'define() runs the builder fn and replaces items',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu }) => {
          menu.menu('Test', [
            { label: 'Hello', click: () => {} },
            { type: 'separator' },
            { label: 'World', click: () => {} },
          ]);
        });

        const items = ctx.omega.menu.getItems();
        ctx.expect(items.length).toBe(1);
        ctx.expect(items[0].label).toBe('Test');
        ctx.expect(Array.isArray(items[0].submenu)).toBe(true);
        ctx.expect(items[0].submenu.length).toBe(3);
      },
    },
    {
      name: 'define() throws on non-function input',
      run: (ctx) => {
        ctx.expect(() => ctx.omega.menu.define(null)).toThrow(/must be a function/);
      },
    },
    {
      name: 'menu.menu(label, items) appends a top-level entry',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu }) => {
          menu.menu('First', [{ label: 'a' }]);
          menu.menu('Second', [{ label: 'b' }]);
        });
        const labels = ctx.omega.menu.getItems().map((i) => i.label);
        ctx.expect(labels).toEqual(['First', 'Second']);
      },
    },
    {
      name: 'useDefaults() replaces items with the platform default template',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu }) => {
          menu.menu('Custom', [{ label: 'x' }]);
          menu.useDefaults();
        });
        const labels = ctx.omega.menu.getItems().map((i) => i.label);
        ctx.expect(labels).toContain('Edit');
        ctx.expect(labels).not.toContain('Custom');
      },
    },
    {
      name: 'clear() empties the items list',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu }) => {
          menu.menu('A', [{ label: 'a' }]);
          menu.clear();
        });
        ctx.expect(ctx.omega.menu.getItems()).toEqual([]);
      },
    },
    {
      name: 'append() adds a raw descriptor at top level',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu }) => {
          menu.append({ label: 'Raw', submenu: [{ label: 'inside' }] });
        });
        const items = ctx.omega.menu.getItems();
        ctx.expect(items.length).toBe(1);
        ctx.expect(items[0].label).toBe('Raw');
      },
    },
    {
      name: 'dynamic label functions are evaluated at resolve time',
      run: (ctx) => {
        let count = 0;
        ctx.omega.menu.define(({ menu }) => {
          menu.menu('Counter', [{ label: () => `Count: ${count}` }]);
        });

        const item = ctx.omega.menu.getItems()[0].submenu[0];
        const resolved1 = ctx.omega.menu._resolveItem(item);
        ctx.expect(resolved1.label).toBe('Count: 0');

        count = 7;
        const resolved2 = ctx.omega.menu._resolveItem(item);
        ctx.expect(resolved2.label).toBe('Count: 7');
      },
    },
    {
      name: 'click handlers are wrapped to catch errors',
      run: (ctx) => {
        let called = false;
        ctx.omega.menu.define(({ menu }) => {
          menu.menu('M', [
            { label: 'Boom', click: () => { called = true; throw new Error('boom'); } },
          ]);
        });
        const inner = ctx.omega.menu.getItems()[0].submenu[0];
        const resolved = ctx.omega.menu._resolveItem(inner);
        resolved.click(null, null, null);
        ctx.expect(called).toBe(true);
      },
    },
    {
      name: 'submenu items are recursively resolved',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu }) => {
          menu.menu('Top', [
            {
              label: 'Parent',
              submenu: [
                { label: () => 'Dyn child' },
                { type: 'separator' },
              ],
            },
          ]);
        });
        const top = ctx.omega.menu.getItems()[0];
        const resolved = ctx.omega.menu._resolveItem(top);
        ctx.expect(resolved.submenu[0].label).toBe('Parent');
        ctx.expect(resolved.submenu[0].submenu[0].label).toBe('Dyn child');
        ctx.expect(resolved.submenu[0].submenu[1].type).toBe('separator');
      },
    },
    {
      name: 'default template includes platform-appropriate check-for-updates item',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu: m }) => m.useDefaults());
        // Mac → main/check-for-updates; win/linux → help/check-for-updates.
        const id = process.platform === 'darwin' ? 'main/check-for-updates' : 'help/check-for-updates';
        const item = ctx.omega.menu.find(id);
        ctx.expect(item).toBeTruthy();
        ctx.expect(typeof item.label).toBe('string');
        ctx.expect(typeof item.click).toBe('function');
      },
    },
    {
      name: 'find returns null for unknown id',
      run: (ctx) => {
        ctx.expect(ctx.omega.menu.find('does-not-exist')).toBe(null);
      },
    },
    {
      name: 'update patches label and re-renders',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu: m }) => m.useDefaults());
        const id = process.platform === 'darwin' ? 'main/check-for-updates' : 'help/check-for-updates';
        const ok = ctx.omega.menu.update(id, { label: 'PROBE LABEL' });
        ctx.expect(ok).toBe(true);
        const item = ctx.omega.menu.find(id);
        ctx.expect(item.label).toBe('PROBE LABEL');
      },
    },
    {
      name: 'update returns false for unknown id',
      run: (ctx) => {
        const ok = ctx.omega.menu.update('nope', { label: 'nope' });
        ctx.expect(ok).toBe(false);
      },
    },
    {
      name: 'remove deletes item from tree',
      run: (ctx) => {
        // Recreate the default template so we have the item to remove (previous test may have mutated).
        ctx.omega.menu.define(({ menu: m }) => m.useDefaults());
        const id = process.platform === 'darwin' ? 'main/check-for-updates' : 'help/check-for-updates';
        ctx.expect(ctx.omega.menu.find(id)).toBeTruthy();

        const removed = ctx.omega.menu.remove(id);
        ctx.expect(removed).toBe(true);
        ctx.expect(ctx.omega.menu.find(id)).toBe(null);

        // Restore for subsequent tests.
        ctx.omega.menu.define(({ menu: m }) => m.useDefaults());
      },
    },
    {
      name: 'insertAfter splices in a new sibling by id-path',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu: m }) => m.useDefaults());
        const anchor = process.platform === 'darwin' ? 'main/check-for-updates' : 'help/check-for-updates';
        const ok = ctx.omega.menu.insertAfter(anchor, { id: 'main/preferences', label: 'PREF PROBE' });
        ctx.expect(ok).toBe(true);
        ctx.expect(ctx.omega.menu.find('main/preferences')).toBeTruthy();
      },
    },
    {
      name: 'auto-updater status updates the menu item label',
      run: async (ctx) => {
        ctx.omega.menu.define(({ menu: m }) => m.useDefaults());

        // Force a known state and trigger menu update.
        ctx.omega.autoUpdater._state = {
          code: 'downloaded', version: '5.0.0', percent: 100, error: null, downloadedAt: Date.now(), lastCheckedAt: null,
        };
        ctx.omega.autoUpdater._updateMenuItem();

        const id = process.platform === 'darwin' ? 'main/check-for-updates' : 'help/check-for-updates';
        const item = ctx.omega.menu.find(id);
        ctx.expect(item.label).toContain('Restart to Update');
        ctx.expect(item.label).toContain('5.0.0');
        ctx.expect(item.enabled).toBe(true);
      },
    },
    {
      name: 'auto-updater downloading status disables item',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu: m }) => m.useDefaults());

        ctx.omega.autoUpdater._state = {
          code: 'downloading', version: '5.0.0', percent: 42, error: null, downloadedAt: null, lastCheckedAt: null,
        };
        ctx.omega.autoUpdater._updateMenuItem();

        const id = process.platform === 'darwin' ? 'main/check-for-updates' : 'help/check-for-updates';
        const item = ctx.omega.menu.find(id);
        ctx.expect(item.label).toContain('42%');
        ctx.expect(item.enabled).toBe(false);
      },
    },
    {
      name: 'consumer function receives omega + menu builder + defaults (no manager key)',
      run: (ctx) => {
        let received;
        ctx.omega.menu.define((arg) => {
          received = arg;
          arg.menu.menu('probe', []);
        });
        ctx.expect(received.omega).toBe(ctx.omega);
        ctx.expect(received.manager).toBeUndefined();
        ctx.expect(typeof received.menu.menu).toBe('function');
        ctx.expect(typeof received.menu.useDefaults).toBe('function');
        ctx.expect(typeof received.menu.clear).toBe('function');
        ctx.expect(typeof received.menu.append).toBe('function');
        ctx.expect(typeof received.menu.find).toBe('function');
        ctx.expect(typeof received.menu.has).toBe('function');
        ctx.expect(typeof received.menu.insertBefore).toBe('function');
        ctx.expect(typeof received.menu.appendTo).toBe('function');
        ctx.expect(Array.isArray(received.defaults)).toBe(true);
      },
    },
    {
      name: 'menu.has reports presence by id-path',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu: m }) => m.useDefaults());
        ctx.expect(ctx.omega.menu.has('edit/copy')).toBe(true);
        ctx.expect(ctx.omega.menu.has('edit/does-not-exist')).toBe(false);
      },
    },
    {
      name: 'menu.hide / menu.show toggle visibility by id-path',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu: m }) => m.useDefaults());
        ctx.omega.menu.hide('edit/copy');
        ctx.expect(ctx.omega.menu.find('edit/copy').visible).toBe(false);
        ctx.omega.menu.show('edit/copy');
        ctx.expect(ctx.omega.menu.find('edit/copy').visible).toBe(true);
      },
    },
    {
      name: 'menu.enable toggles enabled by id-path',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu: m }) => m.useDefaults());
        ctx.omega.menu.enable('edit/copy', false);
        ctx.expect(ctx.omega.menu.find('edit/copy').enabled).toBe(false);
        ctx.omega.menu.enable('edit/copy');
        ctx.expect(ctx.omega.menu.find('edit/copy').enabled).toBe(true);
      },
    },
    {
      name: 'menu.insertBefore splices into a submenu by id-path',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu: m }) => m.useDefaults());
        const ok = ctx.omega.menu.insertBefore('edit/copy', { id: 'edit/probe', label: 'PROBE' });
        ctx.expect(ok).toBe(true);
        // Find the edit submenu and confirm probe is right before copy.
        const edit = ctx.omega.menu.find('edit');
        const sub  = edit.submenu;
        const copyIdx  = sub.findIndex((i) => i.id === 'edit/copy');
        const probeIdx = sub.findIndex((i) => i.id === 'edit/probe');
        ctx.expect(probeIdx).toBe(copyIdx - 1);
      },
    },
    {
      name: 'menu.appendTo pushes into a submenu (creating it if absent)',
      run: (ctx) => {
        ctx.omega.menu.define(({ menu: m }) => {
          m.menu('Tools', []);
        });
        const ok = ctx.omega.menu.appendTo('Tools', { id: 'tools/x', label: 'X' });
        // 'Tools' was added with label='Tools' but no id field — appendTo lookups id-path,
        // so this should miss. Use a different anchor that has an id.
        ctx.expect(ok).toBe(false);

        ctx.omega.menu.define(({ menu: m }) => {
          m.append({ id: 'tools', label: 'Tools', submenu: [] });
        });
        const ok2 = ctx.omega.menu.appendTo('tools', { id: 'tools/x', label: 'X' });
        ctx.expect(ok2).toBe(true);
        ctx.expect(ctx.omega.menu.find('tools').submenu[0].id).toBe('tools/x');
      },
    },
    {
      name: 'menu deep-path lookup walks segments (view/developer/toggle-devtools)',
      run: (ctx) => {
        // Force isDevelopment() so the dev menu renders.
        const orig = ctx.omega.isDevelopment;
        ctx.omega.isDevelopment = () => true;
        try {
          ctx.omega.menu.define(({ menu: m }) => m.useDefaults());
          ctx.expect(ctx.omega.menu.has('view/developer')).toBe(true);
          ctx.expect(ctx.omega.menu.has('view/developer/toggle-devtools')).toBe(true);
        } finally {
          ctx.omega.isDevelopment = orig;
        }
      },
    },
    {
      name: 'view/developer carries the Simulate update submenu (dev only)',
      run: (ctx) => {
        const orig = ctx.omega.isDevelopment;
        ctx.omega.isDevelopment = () => true;
        try {
          ctx.omega.menu.define(({ menu: m }) => m.useDefaults());
          const item = ctx.omega.menu.find('view/developer/simulate-update');
          ctx.expect(item).toBeTruthy();
          ctx.expect(item.label).toBe('Simulate update');
          ctx.expect(item.submenu.map((i) => i.id)).toEqual([
            'view/developer/simulate-update/available',
            'view/developer/simulate-update/unavailable',
            'view/developer/simulate-update/error',
          ]);
        } finally {
          ctx.omega.isDevelopment = orig;
        }

        ctx.omega.isDevelopment = () => false;
        try {
          ctx.omega.menu.define(({ menu: m }) => m.useDefaults());
          ctx.expect(ctx.omega.menu.has('view/developer/simulate-update')).toBe(false);
        } finally {
          ctx.omega.isDevelopment = orig;
        }
      },
    },
    {
      name: 'menu development top-level appears only in dev mode',
      run: (ctx) => {
        const orig = ctx.omega.isDevelopment;
        ctx.omega.isDevelopment = () => true;
        try {
          ctx.omega.menu.define(({ menu: m }) => m.useDefaults());
          ctx.expect(ctx.omega.menu.has('development')).toBe(true);
          ctx.expect(ctx.omega.menu.has('development/open-logs')).toBe(true);
        } finally {
          ctx.omega.isDevelopment = orig;
        }

        ctx.omega.isDevelopment = () => false;
        try {
          ctx.omega.menu.define(({ menu: m }) => m.useDefaults());
          ctx.expect(ctx.omega.menu.has('development')).toBe(false);
        } finally {
          ctx.omega.isDevelopment = orig;
        }
      },
    },
  ],
});
