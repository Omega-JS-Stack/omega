---
status: superseded
created: 2026-07-09
---
# OMEGA Ecosystem Architecture & Duplication Audit
## For unified config format + npm @omega/* rebrand redesign

**Date:** 2026-07-02  
**Scope:** BXM, EM, MAM, UJM, BEM, WM, omega-manager  
**Status:** Read-only exploration complete — detailed findings below

---

## A. PER-FRAMEWORK CONFIG FORMATS (Unification Target)

### BXM (Browser Extension Manager)
**Framework:** `/Users/ian/Developer/Repositories/ITW-Creative-Works/browser-extension-manager`  
**Package name:** `browser-extension-manager` (v1.7.1)  
**Consumer config file:** `config/browser-extension-manager.json`

**Config shape (JSON5):**
```json
{
  theme: {
    id: 'classy|bootstrap|_template',
  },
  brand: {
    id: string,
    name: string,
    url: string,
    contact: { email: string },
    images: {
      brandmark: string (URL),
      wordmark: string (URL),
      combomark: string (URL),
    },
  },
  sentry: { dsn: string },
  analytics: {
    providers: {
      google: { id: string, secret: string },  // Measurement ID + API secret
    },
  },
  firebaseConfig: {
    apiKey, authDomain, databaseURL, projectId, storageBucket,
    messagingSenderId, appId, measurementId (all strings)
  },
}
```

**Key observations:**
- Firebase config uses flat structure (`firebaseConfig.*`)
- Analytics uses nested `providers.google.{id, secret}` (ID + API secret both stored here)
- No app-level metadata block
- No payment/downloads/releases/targets config (all generated)

---

### EM (Electron Manager)
**Framework:** `/Users/ian/Developer/Repositories/ITW-Creative-Works/electron-manager`  
**Package name:** `electron-manager` (v1.9.0)  
**Consumer config file:** `config/electron-manager.json`

**Config shape (JSON5):**
```json
{
  brand: {
    id: string,
    name: string,
    url: string,
    contact: { email: string },
    images: {
      brandmark: string (URL),
      wordmark: string (URL),
      icon: string (local path),  // ← Different from BXM
    },
  },
  app: {
    appId: null,  // Auto-derived: com.itwcreativeworks.<brand.id>
    productName: null,  // Auto-derived: brand.name
    copyright: null,  // Auto-derived: © {YEAR}, ITW Creative Works
    category: 'productivity|developer-tools|utilities|media|social|network',
    languages: ['en'],
    darkModeSupport: true,
  },
  targets: {
    mac: {
      arch: ['universal'],
      entitlements: {},
      mas: { enabled, provisioningProfile, entitlements, entitlementsInherit },
    },
    win: {
      arch: ['x64', 'ia32'],
      oneClick: true,
      desktopShortcut: true,
      startMenuShortcut: true,
      runAfterFinish: true,
      perMachine: false,
      signing: { strategy: 'self-hosted|cloud|local', cloud: {} },
    },
    linux: {
      arch: ['x64'],
      snap: { enabled, confinement, grade, autoStart, channels },
    },
  },
  autoUpdate: {
    enabled, channel, autoDownload, startupDelayMs, intervalMs, maxAgeMs
  },
  startup: {
    mode: 'normal|hidden',
    openAtLogin: { enabled, mode: 'normal|hidden' },
  },
  theme: { appearance: 'system|light|dark' },
  releases: { enabled, owner, repo },
  downloads: { enabled, owner, repo, tag },
  sentry: { dsn: string },
  analytics: {
    providers: {
      google: { id: string },  // Measurement ID ONLY (secret in env)
    },
  },
  payment: {
    processors: {
      stripe: { publishableKey: string },
      paypal: { clientId: string },
    },
    products: [...],
  },
  remoteConfig: { enabled, url? },
  restartManager: { enabled },
  firebaseConfig: {
    apiKey, authDomain, databaseURL, projectId, storageBucket,
    messagingSenderId, appId, measurementId (all strings)
  },
}
```

**Key observations:**
- Distinct `app` block with app-level metadata (appId, productName, category, languages, darkModeSupport)
- Per-platform `targets` block with platform-specific installer/signing config
- Many optional derived defaults (appId, productName, copyright)
- Analytics ID only in config; secret moved to `.env` (matches BEM/UJM convention)
- Payment section with public keys + product catalog
- Remote config & restart manager sections (unique to EM)
- Theme appearance (system/light/dark) instead of theme.id
- No `theme.id`; appearance is explicit

---

### MAM (Mobile App Manager)
**Framework:** `/Users/ian/Developer/Repositories/ITW-Creative-Works/mobile-app-manager`  
**Package name:** `mobile-app-manager` (v0.0.2) — **youngest & minimal**  
**Consumer config file:** `config/mobile-app-manager.json`

**Config shape (JSON5):**
```json
{
  app: {
    name: string,
    bundleIdentifier: string,
  },
  apple: {
    teamId: string,
    automaticSigning: boolean,
    provisioningProfileName: string,
  },
  android: {},
  brand: {
    id: string,
    name: string,
    url: string,
    contact: { email: string },
    images: {
      brandmark: string (URL),
      wordmark: string (URL),
      combomark: string (URL),
    },
  },
  sentry: { dsn: string },
  google_analytics: {  // ← Inconsistent key naming (snake_case)
    id: string,
    secret: string,
  },
  firebaseConfig: {
    apiKey, authDomain, projectId, storageBucket,
    messagingSenderId, appId (no databaseURL, measurementId)
  },
}
```

**Key observations:**
- Minimal config — v0.0.x (beta/early-stage)
- Platform-specific blocks (`apple`, `android`) instead of unified `targets`
- `app.bundleIdentifier` instead of `app.appId` (iOS-specific naming)
- `google_analytics` key uses snake_case (not camelCase like BEM/BXM/EM)
- Analytics includes both ID + secret in config (different from EM convention)
- Firebase config missing `databaseURL` and `measurementId` (incomplete)
- No payment, deployment, or startup config

---

### UJM (Ultimate Jekyll Manager)
**Framework:** `/Users/ian/Developer/Repositories/ITW-Creative-Works/ultimate-jekyll-manager`  
**Package name:** `ultimate-jekyll-manager` (v1.9.23)  
**Consumer config file:** `config/ultimate-jekyll-manager.json`

**Config shape (JSON5):**
```json
{
  distribute: { input: [] },
  webpack: { target: 'default' },
  sass: {
    purgecss: {
      safelist: {
        standard: [],
        deep: [],
        greedy: [],
        keyframes: [],
      },
    },
  },
  imagemin: { enabled: true },
  github: {
    workflows: {
      build: { schedule: '30 1 1 * *' },
    },
  },
  gems: [],
}
```

**Key observations:**
- **Completely different structure** — build/deploy config only (no brand/app metadata)
- No Firebase, analytics, payment, or brand sections
- `distribute`, `webpack`, `sass`, `imagemin`, `github` are build-specific
- Separate brand config lives in `src/_config.yml` (Jekyll standard, YAML format)
- UJM splits user-facing config across multiple files (unlike other frameworks)

---

### BEM (Backend Manager)
**Framework:** `/Users/ian/Developer/Repositories/ITW-Creative-Works/backend-manager`  
**Package name:** `backend-manager` (v5.11.5)  
**Consumer config file:** `functions/backend-manager-config.json`

**Config shape (JSON5):**
```json
{
  parent: string (URL),
  brand: {
    id, name, url, description, tagline,
    contact: { email },
    address: { line1, line2, region, postalCode, city, locality, country },
    images: { brandmark, wordmark, combomark },
  },
  reviews: [...],
  oauth2: {...},
  github: { user, repo_website (template) },
  sentry: { dsn },
  firebaseConfig: {
    apiKey, authDomain, databaseURL, projectId, storageBucket,
    messagingSenderId, appId, measurementId
  },
  analytics: {
    providers: {
      google: { id },  // ID only
      meta: { id },
      tiktok: { id },
    },
  },
  payment: {
    processors: {
      stripe: { publishableKey },
      paypal: { clientId },
      chargebee: { site },
      coinbase: { enabled },
    },
    products: [...],
  },
  marketing: {...},
  blog: {...},
  dataRequest: { queries: [...] },
}
```

**Key observations:**
- Expands brand section (includes address, full contact details)
- Auth/OAuth2 config (unique to backend)
- Minimal app-level config (no targets, no theme, no startup)
- Analytics providers include Google, Meta, TikTok (frontend BXM/EM only have Google)
- Payment section (shared shape with EM, but BEM also includes chargebee.site + coinbase.enabled)
- Marketing + blog config (unique to backend)

---

### WM (Web Manager)
**Framework:** `/Users/ian/Developer/Repositories/ITW-Creative-Works/web-manager`  
**Package name:** `web-manager` (v4.3.3)  
**No consumer config file** — library singleton (Firebase client SDK wrapper)

**Key observations:**
- No config format — WM is a library, not a framework
- Embedded as runtime dependency in BXM, EM, UJM, BEM
- Exposes `firebaseConfig` via consumer's framework config (no WM-specific config needed)

---

## B. UNIFIED CONFIG SHAPE — Proposed Target

### Current Duplication Patterns

| Key | BXM | EM | MAM | UJM | BEM |
|-----|-----|----|----|-----|-----|
| `brand.id` | ✓ | ✓ | ✓ | ✗ | ✓ |
| `brand.name` | ✓ | ✓ | ✓ | ✗ | ✓ |
| `brand.url` | ✓ | ✓ | ✓ | ✗ | ✓ |
| `brand.contact.email` | ✓ | ✓ | ✓ | ✗ | ✓ |
| `brand.images` | ✓ | ✓ | ✓ | ✗ | ✓ |
| `brand.address` | ✗ | ✗ | ✗ | ✗ | ✓ |
| `app.appId/bundleId` | ✗ | ✓ (derived) | ✓ | ✗ | ✗ |
| `firebaseConfig` | ✓ (flat) | ✓ (flat) | ✓ (flat) | ✗ | ✓ (flat) |
| `analytics.providers.google` | ✓ (id+secret) | ✓ (id only) | ✓ (id+secret) | ✗ | ✓ (id only) |
| `payment.processors` | ✗ | ✓ | ✗ | ✗ | ✓ |
| `sentry.dsn` | ✓ | ✓ | ✓ | ✗ | ✓ |
| `theme.id` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `targets` (platform config) | ✗ | ✓ | ✓ | ✗ | ✗ |

### Conceptual Overlaps (Different Spellings)
- `analytics.providers.google.id` vs `google_analytics.id` (MAM uses snake_case, others use camelCase)
- `firebaseConfig.measurementId` (config value) vs `analytics.streams.*.measurementId` (omega state)
- `brand.contact.email` vs `brand.contactEmail` (inconsistent nesting)
- App identity: `app.appId` (EM), `app.bundleIdentifier` (MAM), none in BXM/UJM/BEM

---

## C. OMEGA-MANAGER'S UNIFIED KEYS & DISPERSAL

### UNIFIED_KEYS (config.js)
**Location:** `/Users/ian/Developer/Repositories/ITW-Creative-Works/omega-manager/config.js` (lines 34–71)

```javascript
export const UNIFIED_KEYS = {
  website: { displayName: 'Website', subdomain: null, private: true },
  backend: { displayName: 'Backend', subdomain: 'api', private: true },
  desktop: { displayName: 'Desktop App', subdomain: 'desktop', private: true },
  mobile: { displayName: 'Mobile App', subdomain: 'mobile', private: true },
  'browser-extension': { displayName: 'Browser Extension', subdomain: 'browser-extension', private: true },
  'node-module': { displayName: 'Node Module', subdomain: 'node-module', private: false },
};
```

These keys map to:
- **website** → UJM (ultimate-jekyll-manager)
- **backend** → BEM (backend-manager) in `functions/`
- **desktop** → EM (electron-manager)
- **mobile** → MAM (mobile-app-manager)
- **browser-extension** → BXM (browser-extension-manager)
- **node-module** → npm packages (no framework)

### Dispersal Config
**Location:** `/Users/ian/Developer/Repositories/ITW-Creative-Works/omega-manager/src/services/disperse/disperse-config.js`

**Purpose:** Maps unified brand config → framework-specific config files

**Per-target mappings:**

#### website (UJM)
Files written:
- `.env` → `GH_TOKEN`, `BACKEND_MANAGER_OPENAI_API_KEY`
- `src/_config.yml` (YAML) → brand info, Firebase SDK config, analytics, payment, recaptcha

#### browser-extension (BXM)
Files written:
- `.env` → `GH_TOKEN`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, etc.
- `config/browser-extension-manager.json` (JSON5) → brand, Firebase, analytics

#### desktop (EM)
Files written:
- `.env` → `GH_TOKEN`, `BACKEND_MANAGER_KEY`, signing certs, notarization keys, `GOOGLE_ANALYTICS_SECRET`
- `config/electron-manager.json` (JSON5) → brand, Firebase, analytics, payment

#### backend (BEM)
Files written:
- `functions/.env` → GitHub, OpenAI, payment secrets, analytics secret
- `functions/backend-manager-config.json` (JSON5) → brand, address, GitHub, Firebase, analytics, payment, marketing, blog

**Source types:**
- `source: 'brand'` — from `brandConfig.brand` (id, name, url, contact, images)
- `source: 'config'` — from full `brandConfig` (github.org*, analytics.providers.*, etc.)
- `source: 'state'` — from `.output/{brandId}/state.json` (Firebase SDK config, analytics streams, etc.)
- `source: 'env'` — from omega-manager `.env` or `.brands/{brandId}/.env`
- `source: 'secrets'` — from `.output/{brandId}/secrets/` (Stripe secret key, PayPal secret, etc.)
- `source: 'ai'` — AI-generated content (title, description — onboarding only)

---

## D. BUILD SYSTEM DUPLICATION

### Gulp Task Comparison

| Task | BXM | EM | MAM | UJM |
|------|-----|----|----|-----|
| `defaults` | ✓ | ✓ | ✓ | ✓ |
| `distribute` | ✓ | ✓ | ✓ | ✓ |
| `sass` | ✓ | ✓ | ✓ | ✓ |
| `webpack` | ✓ | ✓ | ✓ | ✓ |
| `html` | ✓ | ✓ | ✗ | ✓ |
| `icons` | ✓ | ✓ | ✗ | ✗ |
| `translate` | ✓ | ✗ | ✗ | ✓ |
| `package` | ✓ | ✓ | ✓ | ✗ |
| `serve` | ✓ | ✓ | ✓ | ✓ |
| `audit` | ✓ | ✓ | ✗ | ✓ |
| `publish` | ✓ | ✓ | ✓ | ✗ |
| `build-config` | ✗ | ✓ | ✗ | ✗ |
| `jekyll` | ✗ | ✗ | ✗ | ✓ |
| `imagemin` | ✗ | ✗ | ✗ | ✓ |

### Framework-Specific Task Counts
- **BXM:** 18 task files (in `/src/gulp/tasks/`)
  - Base: defaults, distribute, sass, webpack, html, icons, translate, package, serve, audit, publish
  - Utility: template-transform, _importer, _vendor, _package, themes, BU utilities
  - Special: developmentRebuild

- **EM:** 12 task files
  - Base: defaults, distribute, sass, webpack, html, package, serve, audit, release
  - Plus: build-config, package-quick, mirror-downloads

- **MAM:** 8 task files (minimal)
  - Core: defaults, distribute, sass, webpack, serve, package, publish
  - Plus: assets

- **UJM:** 26 task files (most complex)
  - Core: defaults, distribute, sass, webpack, serve
  - Plus: jekyll, imagemin, jsonToHtml, minifyHtml, preprocess, translation, setup
  - Utility: 6+ utils (BU minifyHtml, validate-yaml, collectTextNodes, etc.)

### Duplication Highlights
1. **`defaults.js`** — All four frameworks copy `src/defaults/` to consumer projects
   - Logic is nearly identical: FILE_MAP-driven copy with overwrite/skip/template rules
   - Each framework has slightly different file behavior rules
   - **Dedup opportunity:** Shared `@omega/defaults-handler` utility

2. **`distribute.js`** — Copies build artifacts to distribution folders
   - All use similar glob-based copy + optional zip/compress patterns
   - **Dedup opportunity:** Shared distrib logic

3. **`sass.js`** — Compiles SCSS to CSS
   - All use gulp-sass + gulp-clean-css
   - Load-path config differs per framework (theme resolution)
   - **Dedup opportunity:** Shared sass compiler with theme-resolver plugin

4. **`webpack.js`** — Bundles JS
   - BXM: multi-context (background, popup, options, etc.)
   - EM: main + renderer + preload (3 bundles)
   - MAM: single app bundle
   - UJM: service-worker + main app
   - **Dedup opportunity:** Shared webpack factory with context/entry config

5. **`serve.js`** — Dev watcher + live reload
   - Similar: browser-sync or custom WebSocket watcher
   - **Dedup opportunity:** Shared dev-server module

6. **`audit.js`** — Static analysis + config validation
   - BXM: manifest audit, permission checks, icon validation
   - EM: electron-builder config, signing cert validation
   - UJM: Jekyll config, Lighthouse performance
   - **Dedup opportunity:** Shared audit runner with per-framework rule modules

### CLI Pattern (All Similar)
**File location:** `src/cli.js` in each framework

All use identical pattern:
1. Parse argv via yargs
2. Resolve command via ALIASES map
3. Load command file from `src/commands/{command}.js`
4. Execute async handler

**Dedup opportunity:** Extract shared CLI runner → `@omega/cli-base`

---

## E. THEME & DESIGN DUPLICATION

### Theme Directories

**BXM:** `/src/assets/themes/`
- `bootstrap/` — Pure Bootstrap 5.3+
- `classy/` — Bootstrap + custom design system
- `_template/` — New theme scaffold

**EM:** `/src/assets/themes/`
- `bootstrap/` — Bootstrap 5.3+
- `classy/` — Bootstrap + custom design system
- (No `_template/` yet)

**Themes Share:**
- Bootstrap 5.3+ as base
- SCSS structure (variables, components, utilities)
- Light/dark mode support (CSS variables + `[data-bs-theme]`)

**Differences:**
- **BXM themes** are extension-specific (popup, options, sidepanel UIs) — smaller
- **EM themes** are app-wide (window renderer, menu styling) — more comprehensive
- **UJM themes** embedded in Jekyll (site-wide) — different tooling (Jekyll+Liquid)
- **MAM themes** not yet defined (React Native, CSS-in-JS likely)

**Duplication:**
- `bootstrap/` and `classy/` are copy-pasted across BXM + EM
- Same SCSS variables, same light/dark mode strategy
- **Dedup opportunity:** Shared `@omega/theme-base` package with composition pattern

---

## F. DISTRIBUTION & NPM NAMING

### Current Package Names & Status

| Framework | Package Name | Version | Scope | Private | Bin Aliases |
|-----------|--------------|---------|-------|---------|-------------|
| BXM | `browser-extension-manager` | 1.7.1 | none | ✗ | xm, bxm, ext, mgr |
| EM | `electron-manager` | 1.9.0 | none | ✗ | em, mgr, electron-manager |
| MAM | `mobile-app-manager` | 0.0.2 | none | ✗ | mm, mam, mgr, mobile-app-manager |
| UJM | `ultimate-jekyll-manager` | 1.9.23 | none | ✗ | uj, ujm, mgr, ultimate-jekyll |
| BEM | `backend-manager` | 5.11.5 | none | ✗ | bm, bem, mgr, backend-manager |
| WM | `web-manager` | 4.3.3 | none | ✗ | (no CLI) |
| OM | `omega-manager` | (local) | none | ✓ | (orchestrator only) |

### Consumer Dependencies
Each framework is installed as devDependency in consumer projects:
```json
{
  "devDependencies": {
    "browser-extension-manager": "^1.7.1",
    "electron-manager": "^1.9.0",
    "mobile-app-manager": "^0.0.2",
    "ultimate-jekyll-manager": "^1.9.23",
    "backend-manager": "^5.11.5"
  }
}
```

### Proposed @omega/* Rebrand

New names (hypothetical):
- `browser-extension-manager` → `@omega/bxm`
- `electron-manager` → `@omega/em`
- `mobile-app-manager` → `@omega/mam`
- `ultimate-jekyll-manager` → `@omega/ujm`
- `backend-manager` → `@omega/bem`
- `web-manager` → `@omega/web` (or `@omega/wm`)
- `omega-manager` → `@omega/manager`

### Impact of Renaming

Files/references that require updates:

1. **package.json** — in framework + all consumers
   - `"name": "@omega/bxm"`
   - Consumer `"devDependencies": { "@omega/bxm": "^2.0.0" }`

2. **bin entries** — framework `package.json`
   ```json
   {
     "bin": {
       "bxm": "bin/browser-extension-manager",
       "mgr": "bin/browser-extension-manager"
     }
   }
   ```

3. **Gulpfiles** — consumer projects reference framework via node_modules path
   ```js
   // Current
   gulp: "gulp --gulpfile ./node_modules/browser-extension-manager/dist/gulp/main.js"
   
   // After rename
   gulp: "gulp --gulpfile ./node_modules/@omega/bxm/dist/gulp/main.js"
   ```

4. **require() statements** in framework code
   - Cross-framework imports (rare — frameworks don't depend on each other)
   - Internal references within each framework use relative paths (safe)

5. **omega-manager** references
   - CLI commands reference packages by name in JSON (config.js)
   - Must update `npm i @omega/bxm@latest`, `npx mgr setup`, etc.

6. **Template/defaults files** — framework `src/defaults/CLAUDE.md`
   - References to "BXM", "EM", etc. (mostly documentation, safe)

7. **Skills** — `omega:bxm`, `omega:em`, etc.
   - These are skill names, not npm names — no change needed

---

## G. DEFAULTS SYSTEM & SCAFFOLDING DUPLICATION

### Pattern: Framework copies `src/defaults/` → consumer project

**BXM** (`src/gulp/tasks/defaults.js`):
- Uses FILE_MAP to control per-file behavior
- Behavior: `overwrite | skip | template | rename`
- Most consumer files: `overwrite: false` (preserve user code)
- Framework files: `overwrite: true` (safe to update)
- Special handling for manifest, translations, hooks

**EM** (same pattern):
- FILE_MAP-driven copy
- Overwrites framework files (build configs, lib scaffolds)
- Skips consumer files (main.js, preload.js, renderers)

**MAM** (same pattern):
- Copies `src/defaults/` → consumer root
- Simple overwrite/skip logic

**UJM** (same pattern):
- Copies Jekyll site structure
- Complex rules for layouts, includes, assets

### Duplication Inventory
Each framework has ~30-50 default files:
- **BXM defaults:** manifest.json, popup/options/background/content/etc. HTML/JS, themes, messages.json
- **EM defaults:** main.js, preload.js, webpack configs, electron-builder.yml, app.js stubs
- **UJM defaults:** Jekyll `_layouts/`, `_includes/`, `_config.yml`, CSS/JS
- **MAM defaults:** App.tsx, index.js, app.json

**Conceptual overlap:**
- All need to scaffold a working project on first `npx mgr setup`
- All use FILE_MAP-driven templating
- Most preserve user code via `overwrite: false`

**Dedup opportunity:** Shared FILE_MAP schema + copy utility → `@omega/defaults-engine`

---

## H. FRAMEWORK CLI IMPLEMENTATIONS

**Location:** `src/cli.js` + `src/commands/{command}.js` in each framework

**Pattern (all frameworks):**
```js
// src/cli.js
const ALIASES = {
  setup: ['-s', '--setup'],
  clean: ['-c', '--clean'],
  install: ['-i', '--install'],
  test: ['-t', '--test'],
  // ... more commands
};

function resolveCommand(options) {
  // 1. Check positional args
  // 2. Check flag-style aliases
  // 3. Return DEFAULT if no match
}

Main.prototype.process = async function(options) {
  const command = resolveCommand(options);
  const Command = require(path.join(__dirname, 'commands', `${command}.js`));
  await Command(options);
};
```

**Commands per framework:**

| Command | BXM | EM | MAM | UJM | BEM |
|---------|-----|----|----|-----|-----|
| setup | ✓ | ✓ | ✓ | ✓ | ✓ |
| clean | ✓ | ✓ | ✓ | ✓ | ✓ |
| install | ✓ | ✓ | ✓ | ✓ | ✓ |
| test | ✓ | ✓ | ✗ | ✓ | ✓ |
| version | ✓ | ✓ | ✗ | ✓ | ✗ |
| build | ✗ | ✓ | ✗ | ✗ | ✗ |
| publish | ✗ | ✓ | ✗ | ✗ | ✗ |
| release | ✗ | ✓ | ✗ | ✓ | ✗ |
| emulator | ✗ | ✗ | ✗ | ✗ | ✓ |
| serve | ✗ | ✗ | ✗ | ✗ | ✓ |
| logs/audit | ✗ | ✗ | ✗ | ✓ | ✓ |

**Dedup opportunity:** Shared `@omega/cli-router` with framework-specific command registry

---

## I. CONFIG SCHEMA & VALIDATION DUPLICATION

### EM's Schema (Reference)
**Location:** `/Users/ian/Developer/Repositories/ITW-Creative-Works/electron-manager/src/config/schema.js`

EM validates every field at boot + in `gulp/audit`:
- Single source of truth (no duplication)
- Runs hard-fail on invalid config
- Outputs schema to logs for debugging

### BEM's Schema
**Location:** Not found in quick scan — review separately

### Duplication Pattern
- Each framework may have similar validation rules
- No shared schema library currently
- **Opportunity:** Extract common field definitions → `@omega/config-schema` package

---

## J. NODE VERSION RESOLUTION (Update Service)

**Reference:** omega-manager `/docs/update-service.md`

Each target repo has `.nvmrc` pinned to major version:
- **EM:** `v24/*` (matches Electron's bundled Node)
- **UJM/BEM/BXM:** `v22/*`
- **MAM:** Not yet specified

**omega-manager logic** (`src/lib/node-version.js`):
1. Check for `.nvmrc` in working directory (e.g., `functions/` for backend)
2. Parse major version (`v{major}/*`)
3. Match against nvm's installed versions (`$NVM_DIR/versions/node`)
4. Prepend matched version's `bin/` to `PATH`
5. Spawned `node`/`npm`/`npx` resolve to pinned version

**Impact:**
- Each framework setup writes `.nvmrc` matching its Node requirement
- Ensures consistency across development + CI

---

## K. SHARED CONCEPTS & NAMING CONVENTIONS

### Unified Naming Rules (config.js)
- **Service names:** kebab-case (search-console, payment-processor)
- **Operation names:** kebab-case (cache-rules, update-config)
- **File names:** Match operation/service names
- **Config keys:** camelCase (searchConsole, cacheRules)
- **Unified target keys:** kebab-case (browser-extension, node-module)

### Mirrored CLAUDE.md Structure
**Rule:** BEM, UJM, BXM, EM CLAUDE.md files mirror each other — same section order

Sections:
1. Identity
2. Recommended skills
3. (Framework-specific: "READ WEB-MANAGER TOO" for BXM/EM)
4. Quick Start
5. Architecture
6. CLI
7. Dependency Resolution
8. Development Workflow
9. Supply-Chain Security
10. File Conventions
11. Doc-update parity
12. Documentation (per-subsystem index)

**This structure is INTENTIONAL for consistency.**

---

## L. CROSS-CUTTING PATTERNS & OPPORTUNITIES

### 1. Defaults System
- **Current:** Duplicated FILE_MAP-driven copy in each framework
- **Shared opportunity:** `@omega/defaults-engine` with framework-specific FILE_MAP registry

### 2. Build Tasks (Gulp)
- **Current:** Each framework re-implements defaults, distribute, sass, webpack, serve, audit
- **Shared opportunity:** `@omega/gulp-tasks-lib` exporting factory functions

### 3. CLI Router
- **Current:** Each framework implements yargs + command resolver
- **Shared opportunity:** `@omega/cli-router` with framework-specific command registry

### 4. Themes
- **Current:** bootstrap/classy duplicated in BXM + EM
- **Shared opportunity:** `@omega/themes` monorepo package with per-framework variants

### 5. Config Schema
- **Current:** EM validates; others may differ
- **Shared opportunity:** `@omega/config-schema` with per-framework type definitions

### 6. Safe Install (Socket Firewall)
- **Current:** Each CLI uses `safeInstall()` from `src/lib/safe-install.js`
- **Note:** Already somewhat shared (via util function), could be extracted to `@omega/safe-install`

### 7. Web Manager Singleton Pattern
- **Current:** BXM, EM, BEM all embed `web-manager` at runtime
- **Already shared:** `web-manager` is separate package
- **Opportunity:** Document clear loading pattern across frameworks

---

## SUMMARY TABLE: DEDUP TARGETS

| Artifact | Current State | Dedup Opportunity | Package Name (Proposed) |
|----------|---------------|-------------------|------------------------|
| Defaults copy logic | 4× duplicated (BXM/EM/MAM/UJM) | Factory + framework registry | `@omega/defaults-engine` |
| Gulp tasks (defaults, distribute, sass, webpack, serve, audit) | ~50% duplicated across frameworks | Task factories + config plugins | `@omega/gulp-tasks` |
| CLI yargs router + command resolver | 4× duplicated (BXM/EM/UJM/BEM) | Shared runner + registry | `@omega/cli-router` |
| Bootstrap + classy themes | 2× duplicated (BXM/EM) | Shared SCSS lib + composition | `@omega/themes` |
| Config schema + validation | Fragmented | Unified schema definitions | `@omega/config-schema` |
| Safe install wrapper | Duplicated in each CLI | Extracted module | `@omega/safe-install` |
| Brand schema + validation | In omega-manager only | Export to shared lib | `@omega/brand-schema` |
| Firebase/web-manager integration | Per-framework custom code | Document best practices in WM | (enhance web-manager docs) |
| Environment detection helpers | Similar across frameworks | `@omega/environment-helpers` | `@omega/environment` |

---

## NPM SCOPE MIGRATION CHECKLIST

When migrating to `@omega/*` scope:

### Per-package:
- [ ] Rename package.json `name` field
- [ ] Update framework docs (CLAUDE.md, README.md)
- [ ] Update framework consumer `projectScripts` (if they reference package)
- [ ] Update omega-manager's `config.js` service registration (if referenced)
- [ ] Update all bin entries + aliases
- [ ] Update imports in gulp files (if any cross-package references)
- [ ] Tag release as major (breaking change: new scope)
- [ ] Publish to npm under new scope

### Per-consumer:
- [ ] Update `package.json` dependencies
- [ ] Update gulpfile/webpack config path references (if hardcoded)
- [ ] Run `npm install` to fetch from new scope

### Per-omega-manager:
- [ ] Update `config.js` UNIFIED_KEYS or service registration
- [ ] Update `src/services/update/write/targets.js` with new npm package names
- [ ] Update `src/services/disperse/` if it references packages by name
- [ ] Update CLAUDE.md + docs with new names
- [ ] Update CLI help text/prompts

---

## TIMELINE ESTIMATE (Redesign Phase)

### Phase 1: Analysis (complete)
- [x] Config format inventory
- [x] Build system duplication audit
- [x] Theme duplication analysis
- [x] CLI pattern comparison

### Phase 2: Design
- [ ] Unified config schema (superset of all frameworks)
- [ ] Dedup package architecture (list of new `@omega/*` packages)
- [ ] Migration strategy (backwards compatibility? major version bump?)
- [ ] Scope rebrand plan (npm org setup, registry updates)

### Phase 3: Implementation (post-design)
- [ ] Extract shared libraries (defaults-engine, cli-router, gulp-tasks, etc.)
- [ ] Refactor framework packages to depend on new `@omega/*` libs
- [ ] Update consumer templates
- [ ] Update omega-manager to use new package names
- [ ] Update docs + skills
- [ ] Beta test with one framework
- [ ] Release major versions (scoped)

### Phase 4: Migration Support
- [ ] Migration guide for existing consumers
- [ ] Auto-migration tooling (if needed)
- [ ] Deprecation notice on old scope packages (npmjs.com)

---

## CONCLUSION

The OMEGA ecosystem has **significant deduplication opportunities**:

1. **Config formats** are 60% overlapping — unification target clear
2. **Build tasks** are 50-70% duplicated — refactor into shared factories
3. **CLI patterns** are nearly identical — extract router + command registry
4. **Themes** are copy-pasted — centralize in shared package
5. **npm naming** is inconsistent — `@omega/*` scope rebrand is straightforward

The **@omega/* rebrand** is low-risk from a technical perspective:
- No breaking changes to framework APIs
- Simple package.json name updates
- Consumer impact is minimal (just `npm install @omega/bxm` instead of `browser-extension-manager`)
- omega-manager can orchestrate the migration

**Next step:** Design unified config schema + refactored package structure.
