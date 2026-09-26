<p align="center">
  <a href="https://itwcreativeworks.com">
    <img src="https://cdn.itwcreativeworks.com/assets/itw-creative-works/images/logo/itw-creative-works-brandmark-black-x.svg" width="100px">
  </a>
</p>

<p align="center">
  <strong>OMEGA Client</strong> — the shared frontend runtime (auth, data binding, storage, push notifications, error tracking) embedded by
  <a href="../web/">@omega.js/web</a>,
  <a href="../desktop/">@omega.js/desktop</a>, and
  <a href="../extension/">@omega.js/extension</a>.
</p>

## Table of Contents
- [Installation](#-installation)
- [Requirements](#-requirements)
- [Quick Start](#-quick-start)
- [Supported Environments](#-supported-environments)
- [Features](#-features)
- [Configuration](#-configuration)
- [API Reference](#-api-reference)
  - [The omega Instance](#the-omega-instance)
  - [Storage API](#storage-api)
  - [Authentication](#authentication)
  - [Data Binding System](#data-binding-system)
  - [Firestore](#firestore)
  - [Push Notifications](#push-notifications)
  - [Service Worker](#service-worker)
  - [Sentry Error Tracking](#sentry-error-tracking)
  - [DOM Utilities](#dom-utilities)
  - [Utility Functions](#utility-functions)
- [HTML Data Attributes](#-html-data-attributes)
- [Direct Module Imports](#-direct-module-imports)
- [Browser Support](#-browser-support)
- [Projects Using This Library](#-projects-using-this-library)
- [Support](#-support)

## Installation
```shell
npm install @omega.js/client
```

## Requirements
- **Node.js**: >= 12
- **Browser**: Modern browsers (ES6+ support, transpiled to ES5 for older browsers)

**Note**: This library does not include TypeScript definitions.

## Quick Start

`@omega.js/client` exports the base class `Omega` and no instance. @omega.js/web, @omega.js/extension and @omega.js/desktop each subclass it and export the one ready-made instance, `omega`, and they initialize it for you: a web page module receives it (`export default async ({ omega, options }) => { }`), an extension context imports `@omega.js/extension/<context>`, a desktop view imports `@omega.js/desktop/renderer`. A consumer never writes `new`.

The host initializes the instance with the brand's browser config; `initialize()` returns the instance, and `omega.ready` is the same promise:

```javascript
// Inside a host framework: `omega` is its instance
await omega.initialize({
  environment: 'production',
  buildTime: Date.now(),
  brand: {
    id: 'my-app',
    name: 'My Application'
  },
  firebase: {
    app: {
      enabled: true,
      config: {
        apiKey: 'your-api-key',
        authDomain: 'your-app.com', // brand host — the site self-hosts /__/auth/*
        projectId: 'your-project-id',
        storageBucket: 'your-app.appspot.com',
        messagingSenderId: '123456789',
        appId: '1:123456789:web:abcdef'
      }
    }
  }
});

console.log('OMEGA Client initialized!');
```

Anywhere after that:

```javascript
omega.auth.listen({ once: true }, ({ user }) => {
  if (user.authenticated) console.log(user.email, user.plan);
});
omega.utilities.escapeHTML(untrustedText);
```

## Supported Environments

OMEGA Client is designed to work in multiple environments:

| Environment | Support | Notes |
|-------------|---------|-------|
| **Web** | Full | Primary target, works with webpack bundlers |
| **Electron** | Full | Works in renderer process |
| **Chrome Extension** | Full | Content scripts and popup pages |
| **Firefox Extension** | Full | Content scripts and popup pages |
| **Safari Extension** | Partial | Basic functionality supported |

## Features
- **Firebase v12 Integration**: Modern Firebase Auth, Firestore, and Cloud Messaging
- **Data Binding System**: Reactive DOM updates with `data-omega-bind` attributes
- **Storage API**: Enhanced localStorage/sessionStorage with path-based access and JSON serialization
- **Utilities**: `clipboardCopy()`, `escapeHTML()`, `sanitizeURL()`, `renderMarkdown()`, `getContext()`, `showNotification()`, `getPlatform()`, `getBrowser()`, `getRuntime()`, `isMobile()`, `getDevice()`
- **DOM Utilities**: Dynamic script loading with retry/timeout support
- **Service Worker Management**: Registration, messaging, and state tracking
- **Push Notifications**: Firebase Cloud Messaging with auto-subscription
- **Error Tracking**: Sentry integration with session replay
- **App Check**: Optional reCAPTCHA Enterprise protection
- **Version Checking**: Auto-reload when new version is deployed
- **HTML Data Attributes**: Automatic `data-platform`, `data-browser`, `data-runtime`, `data-device` on `<html>`

## Configuration

> **Local stack = local Firebase, zero flags.** When `environment` is `'development'`, or `'testing'` with a resolved `dev.ports` map (the desktop boot lane and the extension's emulator run bake one), the client auto-connects the REAL Auth + Firestore SDKs to the local emulator suite and routes the API to the local ports, never live Firebase. `omega dev` injects development automatically; a testing page with no map stays live; production builds never connect. There is deliberately no live-Firebase opt-out for dev: build production locally if you truly need live.
>
> **Dev ports (N7):** the client resolves the port map with precedence `window.__OMEGA_DEV_PORTS__` (runtime channel — set by drivers like the devkit e2e harness after the page was built) → `config.dev.ports` (baked into the chrome by `omega dev`) → classic defaults (auth `:9099`, firestore `:8080`, functions `:5001`, hosting `:5002`). The emulator connects, `getFunctionsUrl()`, and `getApiUrl()` all read it, so bumped ports (a second brand's concurrent stack) reach the browser. Dev `getApiUrl()`: mapped `hosting` → plain `http://127.0.0.1:<port>` (the hosting emulator speaks http), mapped `https` → `mgr serve`'s mkcert proxy, no map → the classic `https://localhost:5002` serve assumption.

### Full Configuration Reference

```javascript
await omega.initialize({
  // Environment: 'development' or 'production'
  environment: 'production',

  // Build timestamp for version checking
  buildTime: Date.now(),

  // Brand information
  brand: {
    id: 'my-app',                    // Used for custom protocol URLs
    name: 'My Application',
    description: 'App description',
    type: 'Organization',
    images: {
      brandmark: 'https://example.com/logo.png',
      wordmark: 'https://example.com/wordmark.png',
      combomark: 'https://example.com/combomark.png'
    },
    contact: {
      email: 'support@example.com',
      phone: '+1-555-0123'
    }
  },

  // Firebase configuration
  firebase: {
    app: {
      enabled: true,
      config: {
        apiKey: 'your-api-key',
        authDomain: 'your-app.com', // brand host — the site self-hosts /__/auth/*
        projectId: 'your-project-id',
        storageBucket: 'your-app.appspot.com',
        messagingSenderId: '123456789',
        appId: '1:123456789:web:abcdef'
      }
    },
    appCheck: {
      enabled: false,
      config: {
        siteKey: 'your-recaptcha-enterprise-site-key'
      }
    }
  },

  // Authentication settings
  auth: {
    enabled: true,
    config: {
      redirects: {
        authenticated: '/account',     // Redirect after login
        unauthenticated: '/signup'     // Redirect when not logged in
      }
    }
  },

  // Sentry error tracking
  sentry: {
    enabled: true,
    config: {
      dsn: 'https://your-sentry-dsn',
      release: '1.0.0',
      replaysSessionSampleRate: 0.01,  // 1% of sessions
      replaysOnErrorSampleRate: 0.01   // 1% of error sessions
    }
  },

  // Push notifications
  pushNotifications: {
    enabled: true,
    config: {
      autoRequest: 60000,              // Auto-request after 60s of first click
      vapidKey: 'your-vapid-key'       // Optional VAPID key
    }
  },

  // Service worker
  serviceWorker: {
    enabled: true,
    config: {
      path: '/service-worker.js'
    }
  },

  // Version checking (auto-reload on new version)
  refreshNewVersion: {
    enabled: true,
    config: {
      interval: 3600000                // Check every hour (1000 * 60 * 60)
    }
  },

  // Valid hosts for auth redirects (security)
  validRedirectHosts: ['example.com', 'app.example.com']
});
```

### Configuration Notes

- **One blob from every surface**: web, desktop and the extension all hand over
  `OMEGA_BUILD_JSON.config`, the browser-safe subset of the brand's resolved
  `omega.json5` ([#894](https://github.com/Omega-JS-Stack/omega/issues/894)). The client
  maps that canonical shape onto the reference above itself: the `client` section IS this
  top level (so a brand's `client.consent` reads as `config.consent`), `cloud.config` is
  the Firebase home it boots from, and `monitoring.providers.sentry` is the one
  error-reporting switch (a DSN there outranks a legacy `sentry` blob). Nothing composes a
  bridge for it any more.
- **Timeout values** can be specified as strings with math expressions: `'1000 * 60 * 60'` (evaluated safely)
- **Deep merge**: Your config is deep-merged with defaults, so you only need to specify what you want to change
- **Firebase required**: Most features require Firebase to be configured and enabled

## API Reference

### The omega Instance

The host framework's instance extends the `Omega` base class; every module is a plain property:

```javascript
// Modules
omega.storage;        // Storage API
omega.auth;           // Firebase Auth wrapper (omega.auth.user is the current User)
omega.bindings;       // Data binding system
omega.firestore;      // Firestore wrapper
omega.notifications;  // Push notifications
omega.serviceWorker;  // Service worker management
omega.sentry;         // Error tracking
omega.dom;            // DOM utilities
omega.utilities;      // Utility functions
omega.verts;          // Verts (provider ladder + in-house fallback units)
omega.device;         // Local device stats
omega.analytics;      // Runtime event tracking
omega.triggers;       // Click-trigger registry (omega.triggers.register('name', handler))
omega.icons;          // Font Awesome auto-render
omega.motion;         // Motion engine behind the data-omega-* attributes

// Helper methods
omega.request('/omega/user/token', { method: 'POST' }); // API fetch with a fresh Bearer token
omega.getEnvironment();                         // 'development' | 'testing' | 'production'
omega.isDevelopment();                          // Also isProduction(), isTesting()
omega.getFunctionsUrl();                        // Get Firebase Functions URL
omega.getFunctionsUrl('development');           // Force development URL
omega.getApiUrl();                              // Get API URL (api.<brand.url host>)
omega.isValidRedirectUrl('https://...');        // Validate redirect URL

// Firebase instances (after initialization)
omega.firebaseApp;       // Firebase App instance
omega.firebaseAuth;      // Firebase Auth instance
omega.firebaseFirestore; // Firestore instance
omega.firebaseMessaging; // FCM instance

// Configuration
omega.config;            // Access full configuration
omega.ready;             // The promise initialize() settles
```

### Storage API

Enhanced localStorage and sessionStorage with path-based access:

```javascript
const storage = omega.storage;

// LocalStorage (persists across browser sessions)
storage.set('user.name', 'John');
storage.set('user.preferences', { theme: 'dark', lang: 'en' });

const name = storage.get('user.name');                    // 'John'
const theme = storage.get('user.preferences.theme');      // 'dark'
const all = storage.get();                                // Entire storage object
const fallback = storage.get('missing.path', 'default');  // 'default'

storage.remove('user.name');
storage.clear();

// SessionStorage (cleared when browser closes)
storage.session.set('temp.token', 'abc123');
storage.session.get('temp.token');
storage.session.remove('temp.token');
storage.session.clear();
```

**Features**:
- Automatic JSON serialization/deserialization
- Nested path access using dot notation
- Fallback to in-memory storage if localStorage unavailable
- Uses lodash `get`/`set` for reliable path access

### Authentication

Firebase Authentication with one `User` per auth state change:

```javascript
const auth = omega.auth;

// Listen once: waits for auth to settle, fires exactly once
auth.listen({ once: true }, ({ user, denied }) => {
  if (user.authenticated) {
    console.log('Logged in:', user.email, 'on plan', user.plan);
  } else {
    console.log('Not logged in');
  }
});

// Persistent listener: fires on every auth state change
const unsubscribe = auth.listen(({ user }) => {
  console.log('Auth changed:', user.email || 'signed out');
});

// The current user, any time (a signed-out User until auth settles)
if (auth.user.authenticated) {
  console.log('Logged in as:', auth.user.profile.displayName);
}

// Re-read the account (after a purchase, say) and land a new state
const { user } = await auth.reload();

// Sign in
await auth.signInWithEmailAndPassword('user@example.com', 'password');

// Sign in with custom token (from backend)
await auth.signInWithCustomToken('custom-jwt-token');

// Get ID token for API calls
const idToken = await auth.getIdToken();
const freshToken = await auth.getIdToken(true); // Force refresh

// Sign out
await auth.signOut();

// Stop persistent listener
unsubscribe();
```

**Auth State Design**:

On page load, Firebase Auth takes time to restore the user session. Each auth state change builds ONE state (`{ user, denied }`, one account fetch, one `User`) before anything reads it, and every listener, `auth.user` and the bindings hold that same `User`. `auth.settled` resolves the first time a state lands, so consumers never see an intermediate/unknown state.

- `{ once: true }`: Waits for `auth.settled`, calls the callback once with the newest landed state, done. No cleanup needed.
- `{}` (persistent): Fires on every landed state; registered after a state already landed, it catches up with that state once, asynchronously.
- `denied` is true only when Firestore rules refused the account read. An account document not written yet (right after signup) is a normal, empty account.

**`auth.user` is a `User`** (from `@omega.js/account`, the same class the backend builds as `ctx.user`), never null:

```javascript
{
  // The stored account document, as own fields
  auth: { uid: 'abc123', email: 'user@example.com' },
  subscription: { product: { id: 'premium' }, status: 'active', /* ... */ },
  roles: { admin: false, betaTester: false },
  // ...every other schema field

  // Getters, computed on every read
  authenticated: true,   // a non-empty uid
  uid: 'abc123',
  email: 'user@example.com',
  plan: 'premium',       // effective plan right now ('basic' if cancelled/suspended)
  active: true,          // active, trialing, or cancelling
  trialing: false,       // an unexpired trial on an active paid plan
  cancelling: false,     // a cancellation pending on an active paid plan
  everPaid: true,        // a payment start date exists

  // From the sign-in, not the stored document
  profile: {
    displayName: 'John Doe',   // Falls back to the email prefix or 'User'
    photoURL: 'https://...',   // Falls back to ui-avatars.com
    emailVerified: true,
  },
}
```

`user.toJSON()` returns the stored document alone, so storing or sending a `User` carries one shape.

**HTML Auth Classes**:
- `.omega-signout` - Sign out button (shows confirmation dialog)

Usage:
```javascript
auth.listen({ once: true }, ({ user }) => {
  if (!user.active) {
    // User is on free plan or subscription ended
  }

  if (user.trialing) {
    // Show trial banner
  }

  if (user.cancelling) {
    // Show "your plan will cancel at end of period" notice
  }

  // user.plan is the effective plan ID
  const product = products.find(p => p.id === user.plan);
});
```

**⚠️ Auth State Timing**:

`auth.user` and `auth.getIdToken()` read the current state directly: before auth settles, `auth.user` is the signed-out `User` and `getIdToken()` throws, since there is no Firebase user yet.

```javascript
// ❌ May fail on page load - auth state not yet determined
const token = await auth.getIdToken();

// ✅ Wait for auth to settle first
auth.listen({ once: true }, async ({ user }) => {
  if (user.authenticated) {
    const token = await auth.getIdToken(); // Safe
  }
});
```

### Data Binding System

Reactive DOM updates with `data-omega-bind` attributes:

#### Basic Text Binding
```html
<!-- Display text content (default action) -->
<span data-omega-bind="auth.user.email"></span>
<span data-omega-bind="@text auth.user.profile.displayName"></span>
```

#### Input/Textarea Value Binding
```html
<input data-omega-bind="@value settings.email" />
<textarea data-omega-bind="@value user.bio"></textarea>
```

#### Conditional Visibility
```html
<!-- Show when truthy -->
<div data-omega-bind="@show auth.user.authenticated">Welcome back!</div>

<!-- Hide when truthy -->
<div data-omega-bind="@hide auth.user.authenticated">Please log in</div>

<!-- Negation -->
<div data-omega-bind="@show !auth.user.authenticated">Not logged in</div>

<!-- Comparisons -->
<div data-omega-bind="@show auth.user.plan === 'premium'">Premium content</div>
<div data-omega-bind="@hide settings.notifications === false">Notifications on</div>
```

#### Attribute Binding
```html
<img data-omega-bind="@attr src auth.user.profile.photoURL" />
<a data-omega-bind="@attr href settings.profileUrl">Profile</a>
<input data-omega-bind="@attr disabled auth.loading" />
```

#### Style Binding
```html
<!-- CSS custom properties -->
<div data-omega-bind="@style --rating-width ratings.percent"></div>

<!-- Inline styles -->
<div data-omega-bind="@style background-color theme.primary"></div>
```

#### Multiple Actions
Combine actions with commas:
```html
<img data-omega-bind="@show auth.user.authenticated, @attr src auth.user.profile.photoURL, @attr alt auth.user.profile.displayName" />
```

#### JavaScript API
```javascript
const bindings = omega.bindings;

// Update context data
bindings.update({
  settings: { theme: 'dark', email: 'user@example.com' },
  custom: { value: 123 }
});

// Get current context
const context = bindings.getContext();

// Clear all bindings
bindings.clear();
```

#### Skeleton Loaders
```html
<!-- Shows shimmer animation until bound -->
<span data-omega-bind="auth.user.profile.displayName" class="omega-binding-skeleton"></span>
```

The skeleton automatically:
- Displays shimmer animation while loading
- Fades in smoothly when data arrives
- Adds `omega-bound` class when complete
- Respects `prefers-reduced-motion`

#### Supported Actions

| Action | Syntax | Description |
|--------|--------|-------------|
| `@text` | `@text path` | Set text content (default) |
| `@value` | `@value path` | Set input/textarea value |
| `@show` | `@show condition` | Show element if truthy |
| `@hide` | `@hide condition` | Hide element if truthy |
| `@attr` | `@attr name path` | Set attribute value |
| `@style` | `@style prop path` | Set CSS property or variable |

### Firestore

Simplified Firestore wrapper with chainable queries:

```javascript
const db = omega.firestore;

// Document operations - two syntax options
await db.doc('users/user123').set({ name: 'John', age: 30 });
await db.doc('users', 'user123').update({ age: 31 });

const docSnap = await db.doc('users/user123').get();
if (docSnap.exists()) {
  console.log('Data:', docSnap.data());
  console.log('ID:', docSnap.id);
}

await db.doc('users/user123').delete();

// Collection queries
const snapshot = await db.collection('users').get();
console.log('Count:', snapshot.size);
console.log('Empty:', snapshot.empty);
snapshot.docs.forEach(doc => {
  console.log(doc.id, doc.data());
});

// Query with filters (chainable)
const results = await db.collection('users')
  .where('age', '>=', 18)
  .where('active', '==', true)
  .orderBy('createdAt', 'desc')
  .limit(20)
  .get();

// Pagination
const page2 = await db.collection('users')
  .orderBy('name')
  .startAt('M')
  .endAt('N')
  .get();
```

**Where Operators**: `<`, `<=`, `==`, `!=`, `>=`, `>`, `array-contains`, `in`, `array-contains-any`, `not-in`

### Push Notifications

Firebase Cloud Messaging integration:

```javascript
const notifications = omega.notifications;

// Check support
if (notifications.isSupported()) {
  console.log('Push notifications available');
}

// Check subscription status
const isSubscribed = await notifications.isSubscribed();

// Subscribe
try {
  const result = await notifications.subscribe({
    vapidKey: 'your-vapid-key' // Optional
  });
  console.log('Token:', result.token);
} catch (error) {
  if (error.message.includes('permission')) {
    console.log('User denied permission');
  }
}

// Unsubscribe
await notifications.unsubscribe();

// Get current token
const token = await notifications.getToken();

// Listen for foreground messages
const unsubscribe = await notifications.onMessage((payload) => {
  console.log('Received:', payload);
});

// Sync subscription with auth state
await notifications.syncSubscription();
```

**Features**:
- Stores subscription in localStorage and Firestore
- Tracks device context (platform, runtime, device)
- Auto-requests after configurable delay post-click
- Syncs with user authentication state

### Service Worker

Service worker registration and messaging:

```javascript
const sw = omega.serviceWorker;

// Check support
if (sw.isSupported()) {
  console.log('Service workers available');
}

// Register (done automatically during init if enabled)
const registration = await sw.register({
  path: '/service-worker.js',
  scope: '/'
});

// Wait for ready state
await sw.ready();

// Get registration
const reg = sw.getRegistration();

// Post message with response
try {
  const response = await sw.postMessage({
    command: 'cache-clear',
    payload: { pattern: '*.js' }
  }, { timeout: 5000 });
  console.log('Response:', response);
} catch (error) {
  console.error('Timeout or error:', error);
}

// Listen for messages from service worker
const unsubscribe = sw.onMessage('notification-click', (data, event) => {
  console.log('Clicked:', data);
});

// Get current state
const state = sw.getState(); // 'none', 'installing', 'waiting', 'active', 'unknown'
```

### Sentry Error Tracking

Automatic error tracking with Sentry:

```javascript
const sentry = omega.sentry;

// Capture an exception
try {
  throw new Error('Something went wrong');
} catch (error) {
  sentry.captureException(error, {
    tags: { feature: 'checkout' },
    extra: { orderId: '12345' }
  });
}
```

**Automatic Features**:
- Environment and release tracking from config
- User context from auth state (uid, email)
- Session duration tracking
- Filters out Lighthouse and automated browsers (Selenium, Puppeteer)
- Blocks sending in development mode
- Dynamic import to reduce bundle size

### DOM Utilities

```javascript
import { loadScript, ready } from '@omega.js/client/modules/dom';
// Or: const { loadScript, ready } = omega.dom;

// Wait for DOM ready
await ready();

// Load external script
await loadScript({
  src: 'https://example.com/script.js',
  async: true,
  defer: false,
  crossorigin: 'anonymous',
  integrity: 'sha384-...',
  timeout: 30000,
  retries: 2,
  parent: document.head,
  attributes: { 'data-custom': 'value' }
});

// Simple string syntax
await loadScript('https://example.com/script.js');
```

**loadScript Options**:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `src` | string | required | Script URL |
| `async` | boolean | `true` | Load asynchronously |
| `defer` | boolean | `false` | Defer execution |
| `crossorigin` | boolean/string | `false` | CORS setting |
| `integrity` | string | `null` | SRI hash |
| `timeout` | number | `60000` | Timeout in ms |
| `retries` | number | `0` | Retry attempts |
| `parent` | Element | `document.head` | Parent element |
| `attributes` | object | `{}` | Custom attributes |

### Utility Functions

```javascript
import {
  clipboardCopy,
  escapeHTML,
  sanitizeURL,
  renderMarkdown,
  showNotification,
  getPlatform,
  getBrowser,
  getRuntime,
  isMobile,
  getDevice,
  getContext
} from '@omega.js/client/modules/utilities';
// Or: const utils = omega.utilities;

// Copy to clipboard (rejects when the clipboard refuses — catch it)
await clipboardCopy('Text to copy');
await clipboardCopy(document.querySelector('#input')); // From element

// Escape HTML (XSS prevention)
const safe = escapeHTML('<script>alert("xss")</script>');
// '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'

// Sanitize a URL (returns '' for javascript:, data:, and every non-http(s) scheme)
sanitizeURL('https://example.com/a'); // 'https://example.com/a'
sanitizeURL('javascript:alert(1)');   // ''

// Render untrusted text as safe markup — escape-first mini-markdown
// (headings, fenced + inline code, lists, bold/italic, http(s) links only)
renderMarkdown('## Spec\n\nOne **bold** and `code`.');
// '<h5 class="h6 mt-3 mb-2">Spec</h5><p>One <strong>bold</strong> and <code>code</code>.</p>'

// Show notification (Bootstrap-styled)
showNotification('Success!', { type: 'success', timeout: 5000 });
showNotification('Error!', 'danger');
showNotification(new Error('Failed'), { timeout: 0 }); // No auto-dismiss

// Platform detection
getPlatform(); // 'windows', 'mac', 'linux', 'ios', 'android', 'chromeos', 'unknown'

// Browser detection
getBrowser(); // 'chrome', 'firefox', 'safari', 'edge', 'opera', 'brave', null

// Runtime detection
getRuntime(); // 'web', 'browser-extension'

// Device detection
isMobile();   // true/false
getDevice();  // 'mobile' (<768px), 'tablet' (768-1199px), 'desktop' (>=1200px)

// Full context
getContext();
// {
//   client: { language, mobile, device, platform, browser, vendor, runtime, userAgent, url },
//   geolocation: { ip, country, region, city, latitude, longitude }
// }
```

**showNotification Options**:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | string | `'info'` | `'info'`, `'success'`, `'warning'`, `'danger'` |
| `timeout` | number | `5000` | Auto-dismiss after ms (0 = never) |

## HTML Data Attributes

OMEGA Client sets these attributes on the `<html>` element during initialization:

```html
<html data-platform="mac" data-browser="chrome" data-runtime="web" data-device="desktop">
```

| Attribute | Values | Description |
|-----------|--------|-------------|
| `data-platform` | `windows`, `mac`, `linux`, `ios`, `android`, `chromeos`, `unknown` | Operating system |
| `data-browser` | `chrome`, `firefox`, `safari`, `edge`, `opera`, `brave` | Browser name |
| `data-runtime` | `web`, `browser-extension` | Runtime environment |
| `data-device` | `mobile`, `tablet`, `desktop` | Device type by screen width |

**CSS Usage**:
```css
/* Platform-specific styles */
[data-platform="ios"] .download-btn { display: none; }
[data-platform="windows"] .app-icon { content: url('windows-icon.png'); }

/* Browser-specific styles */
[data-browser="safari"] .webkit-fix { -webkit-transform: translateZ(0); }
[data-browser="firefox"] .gecko-fix { overflow: hidden; }

/* Device-responsive styles */
[data-device="mobile"] .sidebar { display: none; }
[data-device="desktop"] .mobile-menu { display: none; }
```

## Direct Module Imports

Import individual modules to reduce bundle size:

```javascript
// Storage only
import Storage from '@omega.js/client/modules/storage';
const storage = new Storage();

// Utilities only
import { clipboardCopy, escapeHTML } from '@omega.js/client/modules/utilities';

// DOM utilities only
import { loadScript, ready } from '@omega.js/client/modules/dom';

// The base class a host framework extends
import { Omega } from '@omega.js/client';
```

**Available Modules**:
- `@omega.js/client/modules/storage` - Storage class
- `@omega.js/client/modules/utilities` - Utility functions
- `@omega.js/client/modules/dom` - DOM utilities
- `@omega.js/client/modules/auth` - Auth class (constructed with the instance)
- `@omega.js/client/modules/bindings` - Bindings class (constructed with the instance)
- `@omega.js/client/modules/firestore` - Firestore class (constructed with the instance)
- `@omega.js/client/modules/notifications` - Notifications class (constructed with the instance)
- `@omega.js/client/modules/service-worker` - ServiceWorker class (constructed with the instance)
- `@omega.js/client/modules/sentry` - Sentry class (constructed with the instance)

## Browser Support

OMEGA Client is transpiled to ES5 for broad browser support:

| Browser | Version | Support |
|---------|---------|---------|
| Chrome | 60+ | Full |
| Firefox | 55+ | Full |
| Safari | 11+ | Full |
| Edge | 79+ | Full |
| IE | 11 | Not supported |

**Notes**:
- Service Workers require HTTPS (except localhost)
- Push Notifications require Service Worker support
- Some features use modern APIs with fallbacks

## Projects Using This Library

- [Somiibo](https://somiibo.com/): A Social Media Bot with an open-source module library
- [JekyllUp](https://jekyllup.com/): A website devoted to sharing the best Jekyll themes
- [Slapform](https://slapform.com/): A backend provider for HTML forms on static sites
- [SoundGrail Music App](https://app.soundgrail.com/): A resource for producers, musicians, and DJs
- [Hammock Report](https://hammockreport.com/): An API for exploring and listing backyard products

*Want your project listed? [Open an issue](https://github.com/Omega-JS-Stack/omega/issues)!*

## Support

If you're having issues or have questions:
- [Open an issue](https://github.com/Omega-JS-Stack/omega/issues) on GitHub
- Include code samples and relevant files to help us help you faster

## License

[Elastic License 2.0](LICENSE). The source is free to use and modify; a license key unlocks payments in production deploys and removes the attribution (local dev and test payments are always free); and you may not offer `@omega.js/client` to third parties as a hosted or managed service.
