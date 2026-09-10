// Mock browser globals for Node.js testing

// Every listener registration is RECORDED as well as ignored. The session
// probe's moments of doubt (#798) are wired at boot with nothing to observe
// but the registration itself; the handlers still do nothing by default, so
// every other suite behaves exactly as it did.
global.__omegaListeners = { window: {}, document: {} };

function recordListener(target, type, handler) {
  const listeners = global.__omegaListeners[target];
  listeners[type] = listeners[type] || [];
  listeners[type].push(handler);
}

global.window = {
  location: {
    href: 'http://localhost:3000/test',
    search: '',
    origin: 'http://localhost:3000',
    protocol: 'http:',
    hostname: 'localhost',
  },
  screen: {
    width: 1920,
    height: 1080
  },
  innerWidth: 1024,
  innerHeight: 768,
  devicePixelRatio: 1,
  matchMedia: () => ({ matches: false }),
  addEventListener: (type, handler) => recordListener('window', type, handler),
  removeEventListener: () => {},
  localStorage: {
    _data: {},
    getItem(key) { return this._data[key] || null; },
    setItem(key, value) { this._data[key] = value; },
    removeItem(key) { delete this._data[key]; },
    clear() { this._data = {}; }
  },
  sessionStorage: {
    _data: {},
    getItem(key) { return this._data[key] || null; },
    setItem(key, value) { this._data[key] = value; },
    removeItem(key) { delete this._data[key]; },
    clear() { this._data = {}; }
  }
};

// Expose globals that some modules reference directly (not via window.*)
global.localStorage = global.window.localStorage;
global.sessionStorage = global.window.sessionStorage;

// Node ships `navigator` as a getter-only global, so a plain assignment
// silently loses (and `'serviceWorker' in navigator` would stay false).
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'Mozilla/5.0 (Testing) Node.js',
    language: 'en-US',
    platform: 'Node.js',
    vendor: 'Test',
    clipboard: {
      writeText: async (text) => text
    },
    userAgentData: {
      mobile: false
    },
    // Declared (so `'serviceWorker' in navigator` support gates read true) and
    // inert: the container APIs the modules touch, doing nothing.
    serviceWorker: {
      register: async (path, options) => ({ scope: options?.scope || '/', active: null, unregister: async () => true }),
      getRegistrations: async () => [],
      ready: Promise.resolve({ scope: '/', active: null }),
      addEventListener: () => {},
      removeEventListener: () => {},
      controller: null,
    }
  },
  configurable: true,
  writable: true,
});

global.document = {
  readyState: 'complete',
  createElement: (tag) => {
    const attributes = {};
    const element = {
      tag,
      className: '',
      textContent: '',
      type: '',
      setAttribute: (name, value) => { attributes[name] = String(value); },
      getAttribute: (name) => attributes[name] ?? null,
      addEventListener: () => {},
      removeEventListener: () => {},
      remove: () => {},
      appendChild: (child) => {
        if (child.nodeValue) {
          element.innerHTML = child.nodeValue
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        }
      },
      innerHTML: '',
      value: '',
      select: () => {},
      style: {
        cssText: '',
        setProperty: () => {},
        removeProperty: () => {},
      },
    };
    return element;
  },
  createTextNode: (text) => ({ nodeValue: text }),
  documentElement: {
    dataset: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    appendChild: () => {},
  },
  head: {
    appendChild: () => {},
  },
  addEventListener: (type, handler) => recordListener('document', type, handler),
  removeEventListener: () => {},
  querySelectorAll: () => [],
  querySelector: () => null,
  body: {
    appendChild: () => {},
    removeChild: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  execCommand: () => true
};

global.URL = URL;
global.URLSearchParams = URLSearchParams;

// Firebase Messaging checks for self
global.self = global.window;
