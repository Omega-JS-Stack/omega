# Storage

Persistent KV store accessible from both main and renderer. Backed by [`electron-store`](https://github.com/sindresorhus/electron-store) under the hood.

## File location

```
macOS:   ~/Library/Application Support/<productName>/omega-storage.json
Windows: %APPDATA%/<productName>/omega-storage.json
Linux:   ~/.config/<productName>/omega-storage.json
```

## Main-process API (sync, direct disk-backed)

```js
manager.storage.get(key, defaultValue)   // any
manager.storage.set(key, value)
manager.storage.delete(key)
manager.storage.has(key)                 // boolean
manager.storage.clear()
manager.storage.onChange(key, fn)        // returns unsubscribe fn
manager.storage.getPath()                // absolute path to omega-storage.json
```

## Renderer-process API (async, proxied through preload + IPC)

```js
await window.desktop.storage.get(key, defaultValue)
await window.desktop.storage.set(key, value)
await window.desktop.storage.delete(key)
await window.desktop.storage.has(key)
await window.desktop.storage.clear()

const off = window.desktop.storage.onChange(key, ({ value, previous }) => { ... });
// pass '*' as key to receive all changes
off();
```

## Dot-notation paths

Keys support dot-notation for nested objects natively:

```js
manager.storage.set('window.main.bounds', { x: 10, y: 20, w: 800, h: 600 });
manager.storage.get('window.main.bounds.w');   // → 800
```

## Change broadcasts

Every `set` / `delete` / `clear` in main broadcasts an `desktop:storage:change` IPC event to all renderer windows. The renderer's `window.desktop.storage.onChange` filters by key locally.

In main, `manager.storage.onChange(key, fn)` registers a callback fired with `(value, previous)`.

## Implementation notes

- Storage initialization is async — `Manager.initialize()` `await`s it before any other lib boots, since features like `app-state` and `windows` rely on it.
- IPC handlers (`desktop:storage:get` etc.) are registered on the @omega.js/desktop `ipc` bus, not directly on `ipcMain`. See [ipc.md](ipc.md).
- The store uses `name: 'omega-storage'` (filename `omega-storage.json`). Don't reuse this name in a separate `electron-store` instance.
- `electron-store@11` is ESM-only. The bundler inlines it INTO `main.bundle.js` (the static-specifier `import()` in `lib/storage.js`) — consumers install NOTHING; packaged apps carry it inside the bundle with no runtime resolution. (It used to be a runtime import the bundler was told to ignore, which silently no-op'd storage in packaged consumers — @omega.js/desktop is a devDependency and never ships in the asar.)
