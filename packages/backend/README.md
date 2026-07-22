<p align="center">
  <a href="https://itwcreativeworks.com">
    <img src="https://cdn.itwcreativeworks.com/assets/itw-creative-works/images/logo/itw-creative-works-brandmark-black-x.svg" width="100px">
  </a>
</p>

<p align="center">
  <strong>OMEGA Backend</strong> — all-in-one development framework for Firebase Cloud Functions backends. Sister project to
  <a href="../desktop/">@omega.js/desktop</a>,
  <a href="../extension/">@omega.js/extension</a>, and
  <a href="https://github.com/itw-creative-works/ultimate-jekyll-manager">Ultimate Jekyll Manager</a>.
</p>

## Installation

```bash
npm install @omega.js/backend
```

**Requirements:**
- Node.js 22
- Firebase project with Firestore and Authentication enabled
- `service-account.json` - Firebase service account credentials
- `config/omega.json5` - OMEGA configuration file (in your functions directory)

## Quick Start

Create `functions/index.js`:

```javascript
const Manager = (new (require('@omega.js/backend'))).init(exports, {
  setupFunctionsIdentity: true,
});
const { functions } = Manager.libraries;

// Create a custom function
exports.myEndpoint = functions
  .runWith({ memory: '256MB', timeoutSeconds: 120 })
  .https.onRequest((req, res) => Manager.Middleware(req, res).run('myEndpoint', { /* options */ }));
```

Create `functions/routes/myEndpoint/index.js`:

```javascript
function Route() {}

Route.prototype.main = async function (ctx) {
  const Manager = ctx.Manager;
  const user = ctx.usage.user;
  const settings = ctx.settings;

  ctx.log('Request data:', ctx.request.data);

  // Return response
  ctx.respond({ success: true, timestamp: new Date().toISOString() });
};

module.exports = Route;
```

Create `functions/schemas/myEndpoint/index.js`:

```javascript
module.exports = function (ctx) {
  return {
    defaults: {
      message: {
        types: ['string'],
        default: 'Hello World',
      },
    },
  };
};
```

Run the setup command:

```bash
npx omega setup
```

## Initialization Options

```javascript
const Manager = (new (require('@omega.js/backend'))).init(exports, options);
```

| Option | Default | Description |
|--------|---------|-------------|
| `initialize` | `true` | Initialize Firebase Admin SDK |
| `projectType` | `'firebase'` | `'firebase'` for Cloud Functions, `'custom'` for Express server |
| `setupFunctions` | `true` | Setup built-in Cloud Functions (`omega_api`, etc.) |
| `setupFunctionsIdentity` | `true` | Setup auth event functions (onCreate, onDelete, beforeCreate, beforeSignIn) |
| `setupFunctionsLegacy` | `false` | Setup legacy admin functions |
| `setupServer` | `true` | Setup custom Express server for routes |
| `routes` | `'/routes'` | Directory for custom route handlers |
| `schemas` | `'/schemas'` | Directory for schema definitions |
| `resourceZone` | `'us-central1'` | Firebase/GCP region |
| `sentry` | `true` | Enable Sentry error tracking |
| `serviceAccountPath` | `'service-account.json'` | Path to Firebase service account |
| `initializeLocalStorage` | `false` | Initialize local lowdb storage on startup |
| `checkNodeVersion` | `true` | Validate Node.js version on startup |
| `express.bodyParser.json` | `{ limit: '100kb' }` | Express JSON body parser options |
| `express.bodyParser.urlencoded` | `{ limit: '100kb', extended: true }` | Express URL-encoded options |

## Configuration File

Create `config/omega.json5` in your functions directory (`npx omega setup` scaffolds it from the template). Shared sections (`brand`, `cloud`, `analytics`, `payment`, `monitoring`, `oauth2`) sit at the top level with identical spelling in every OMEGA project; backend-specific settings live under `targets.backend`. Secrets NEVER go in this file — they belong in `.env` (the loader hard-fails on secret-shaped keys).

```json5
{
  brand: {
    id: 'my-app',
    name: 'My Brand',
    url: 'https://example.com',
    contact: {
      email: 'support@example.com',
    },
    images: {
      wordmark: 'https://example.com/wordmark.png',
      brandmark: 'https://example.com/brandmark.png',
      combomark: 'https://example.com/combomark.png',
    },
  },
  monitoring: {
    provider: 'sentry',
    dsn: 'https://xxx@xxx.ingest.sentry.io/xxx',
  },
  analytics: {
    providers: {
      google: { id: 'G-XXXXXXXXXX' },
    },
  },
  cloud: {
    provider: 'firebase',
    config: {
      apiKey: 'xxx',
      authDomain: 'project-id.firebaseapp.com',
      projectId: 'project-id',
      storageBucket: 'project-id.appspot.com',
      messagingSenderId: '123456789',
      appId: '1:123:web:456',
      measurementId: 'G-XXXXXXXXXX',
    },
  },
  targets: {
    backend: {
      parent: '',
      github: { user: 'username' },
      marketing: { /* campaigns, newsletter, prune */ },
      reviews: { enabled: true, sites: ['trustpilot.com'] },
    },
  },
}
```

In a brand monorepo (`{brand}/apps/backend`), shared sections can live in the brand root's `config/omega.json5` instead — the loader merges `brand shared → brand targets.backend → app shared → app targets.backend`, and any shared key inside `targets.backend` acts as a backend-only override.

## Creating Custom Functions

### Routes

Routes handle HTTP requests. Create files in your `routes/` directory:

**Structure:**
- `routes/{name}/index.js` - Handles all HTTP methods
- `routes/{name}/get.js` - Handles GET requests only
- `routes/{name}/post.js` - Handles POST requests only
- (also supports `put.js`, `delete.js`, `patch.js`)

**Route File Pattern:**

```javascript
function Route() {}

Route.prototype.main = async function (ctx) {
  // Access Manager and helpers
  const Manager = ctx.Manager;
  const usage = ctx.usage;
  const user = ctx.usage.user;
  const analytics = ctx.analytics;
  const settings = ctx.settings;

  // Access request data
  const data = ctx.request.data;       // Merged body + query
  const body = ctx.request.body;       // POST body
  const query = ctx.request.query;     // Query params
  const headers = ctx.request.headers;
  const method = ctx.request.method;
  const geolocation = ctx.request.geolocation; // { ip, country, region, city, latitude, longitude }
  const client = ctx.request.client;   // { userAgent, language, platform, mobile }

  // Check authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  // Check admin role
  if (!user.roles.admin) {
    return ctx.respond('Admin required', { code: 403 });
  }

  // Track analytics
  analytics.event('my_event', { action: 'test' });

  // Validate usage limits
  await usage.validate('requests');
  usage.increment('requests');
  await usage.update();

  // Send response
  ctx.respond({ success: true, data: settings });
};

module.exports = Route;
```

### Schemas

Schemas define and validate request parameters with defaults and plan-based limits:

```javascript
module.exports = function (ctx, settings, options) {
  const user = options.user;

  return {
    // Default values for all plans
    defaults: {
      message: {
        types: ['string'],
        default: 'Hello',
        required: false,
      },
      count: {
        types: ['number'],
        default: 10,
        min: 1,
        max: 100,
      },
      format: {
        types: ['string'],
        default: 'json',
        // Dynamic required based on other settings
        required: (ctx, settings) => settings.output === 'file',
        // Clean/sanitize input
        clean: (value) => value.toLowerCase().trim(),
      },
    },

    // Override defaults for premium plan
    premium: {
      count: {
        types: ['number'],
        default: 100,
        max: 1000,
      },
    },
  };
};
```

**Schema Property Options:**

| Property | Type | Description |
|----------|------|-------------|
| `types` | `string[]` | Allowed types: `'string'`, `'number'`, `'boolean'`, `'object'`, `'array'` |
| `default` | `any` | Default value if not provided |
| `required` | `boolean \| function` | Whether the field is required |
| `clean` | `RegExp \| function` | Sanitize/transform the value |
| `min` | `number` | Minimum value (for numbers) |
| `max` | `number` | Maximum value (for numbers) |
| `available` | `boolean` | Whether the field is available |

### Middleware Options

```javascript
Manager.Middleware(req, res).run('routeName', {
  authenticate: true,           // Authenticate user (default: true)
  setupAnalytics: true,         // Initialize analytics (default: true)
  setupUsage: true,             // Initialize usage tracking (default: true)
  setupSettings: true,          // Resolve settings from schema (default: true)
  schema: 'routeName',          // Schema file to use (default: same as route)
  parseMultipartFormData: true, // Parse multipart uploads (default: true)
  routesDir: '/routes',         // Custom routes directory
  schemasDir: '/schemas',       // Custom schemas directory
});
```

## Built-in Functions

### HTTP API (`omega_api`)

The main API endpoint serves the RESTful routes system. Requests to `/omega/<route>` (hosting rewrite; the legacy `/backend-manager/` prefix works as an alias) resolve to `routes/{name}/{method}.js` handlers with their matching schemas — see [Creating Custom Functions](#creating-custom-functions) above.

```javascript
// POST https://api.<yourdomain>/omega/user/token
// → routes/user/token/post.js (responds { token })
```

### Auth Events

| Function | Trigger | Description |
|----------|---------|-------------|
| `omega_authBeforeCreate` | `beforeUserCreated` | Runs before user creation, can block signup |
| `omega_authBeforeSignIn` | `beforeUserSignedIn` | Runs before sign-in, can block login |
| `omega_authOnCreate` | `onCreate` | Runs after user creation, creates user document |
| `omega_authOnDelete` | `onDelete` | Runs when user is deleted, cleanup |

### Firestore Events

| Function | Trigger | Description |
|----------|---------|-------------|
| `omega_notificationsOnWrite` | `onWrite` | Triggers on `notifications/{id}` changes |

### Cron Jobs

| Function | Schedule | Description |
|----------|----------|-------------|
| `omega_cronDaily` | Every 24 hours | Runs daily jobs from `cron/daily/` and `hooks/cron/daily/` |

**Creating Custom Cron Jobs:**

Create `hooks/cron/daily/myJob.js` in your functions directory:

```javascript
function Job() {}

Job.prototype.main = function () {
  const self = this;
  const Manager = self.Manager;
  const ctx = self.ctx;

  return new Promise(async function(resolve, reject) {
    ctx.log('Running my daily job...');

    // Your job logic here

    return resolve();
  });
};

module.exports = Job;
```

## Email System

Unified MJML-based email rendering for transactional, marketing, and newsletter emails. All emails are rendered server-side — no SendGrid dynamic templates.

- **Unified pipeline** — shared `prepare.js` layer for brand, sender, content, signoff, categories, unsubscribe URL
- **Composable template system** — `base.js` provides building blocks (skeleton, logo, card wrapper, signoff, button, footer); templates compose what they need
- **4 email templates** — `card` (default workhorse), `plain` (personal email feel), `order` (all 9 payment event types), `feedback` (rating faces)
- **MJML compilation** — templates return MJML strings, compiled to email-safe HTML via the `mjml` package
- **Hidden ASM + category tags** — baked into the skeleton to suppress SendGrid's auto-unsubscribe and enable email sorting

### Email API

```javascript
const email = Manager.Email(ctx);
await email.send({
  template: 'card',
  subject: 'Welcome!',
  to: 'user@example.com',
  sender: 'hello',
  data: { body: { title: 'Welcome', message: '# Hello!\n\nWelcome aboard.' } },
});
```

## Marketing & Campaigns

Built-in marketing system with multi-provider support (SendGrid + Beehiiv + FCM push).

- **Contact management** — add, sync, remove contacts across providers with custom field syncing
- **Campaign CRUD** — `POST/GET/PUT/DELETE /marketing/campaign` with calendar-backed scheduling
- **Recurring campaigns** — seasonal sales, newsletters with automatic sendAt advancement
- **Newsletter generator** — AI-assembled newsletters from parent server content sources
- **Newsletter-driven blog articles** — `content.article.enabled` expands the newsletter's lead section into a full blog post (via Ghostii → `admin/post`) and links to it with a "Read the full article" CTA
- **Segment SSOT** — 22 segment definitions resolved to provider IDs at runtime
- **UTM auto-tagging** — brand domain links tagged automatically in marketing + transactional emails
- **Contact pruning** — monthly 2-stage re-engagement + deletion of inactive contacts
- **Template variables** — `{brand.name}`, `{holiday.name}`, `{season.name}`, `{date.*}` resolved at send time

Configure via the `marketing` section under `targets.backend` in `config/omega.json5`. See CLAUDE.md for full documentation.

## Marketing Consent

GDPR/CASL-compliant consent capture and cross-provider unsubscribe sync.

- **Two-checkbox signup form** — separate legal (required) and marketing (optional) consent
- **Canonical user-doc shape** — `consent.{legal,marketing}.{status, grantedAt, revokedAt}` with full audit metadata (timestamp, source, IP, exact label text)
- **Server-authoritative timestamps** — client timestamps ignored, defending against clock manipulation
- **Account-page toggle** — `/account` notifications section lets logged-in users opt in/out, hits both SendGrid + Beehiiv
- **HMAC unsubscribe links** — email-footer one-click flow continues to work; unsubscribe removes the contact from ALL providers (not just the SendGrid ASM group), re-subscribe re-adds the contact
- **Provider webhook receivers** — `POST /marketing/webhook?provider=sendgrid|beehiiv&key=X` catches unsubscribe / spam / bounce events from SendGrid and Beehiiv, writes the user doc + syncs to the OTHER provider
- **Parent forwarder** — single public webhook endpoint (`/marketing/webhook/forward`) on the parent @omega.js/backend fans out to every brand's child @omega.js/backend so each one updates its own Firestore
- **Library-level consent gate** — `email.add()` and `email.sync()` skip users whose `consent.marketing.status === 'revoked'` (covers every call site: payment syncs, admin re-syncs, newsletter form); admin contact DELETE mirrors `revoked` back to the user doc so removals stick

See [docs/consent.md](docs/consent.md) for the full architecture, source enum reference, migration script template, and provider configuration steps.

## Helper Classes

### RouteContext

Handles request/response lifecycle, authentication, and logging.

```javascript
const ctx = Manager.RouteContext({ req, res });

// Authentication
const user = await ctx.authenticate();
// Returns: { authenticated, auth: { uid, email }, roles, plan, ... }

// Request data
ctx.request.data;        // Merged body + query
ctx.request.body;        // POST body
ctx.request.query;       // Query params
ctx.request.headers;     // Request headers
ctx.request.method;      // HTTP method
ctx.request.geolocation; // { ip, country, region, city, latitude, longitude }
ctx.request.client;      // { userAgent, language, platform, mobile }

// Response
ctx.respond({ success: true });              // 200 JSON
ctx.respond({ success: true }, { code: 201 }); // Custom status
ctx.respond('https://example.com', { code: 302 }); // Redirect

// Errors
ctx.report('Something went wrong', { code: 500, sentry: true });
ctx.respond(new Error('Bad request'), { code: 400 });

// Logging
ctx.log('Info message');
ctx.warn('Warning message');
ctx.error('Error message');
ctx.debug('Debug message');

// Environment
ctx.isDevelopment(); // true in emulator
ctx.isProduction();  // true in production
ctx.isTesting();     // true when running tests

// File uploads
const { fields, files } = await ctx.parseMultipartFormData();
```

### User

Creates user objects with default properties:

```javascript
const userProps = Manager.User(existingData, { defaults: true }).properties;

// User structure:
{
  auth: { uid, email, temporary },
  subscription: {
    product: { id, name },   // product from config ('basic', 'premium', etc.)
    status: 'active',        // active | suspended | cancelled
    expires: { timestamp, timestampUNIX },
    trial: { claimed, expires: {...} },
    cancellation: { pending, date: {...} },
    limits: {},
    payment: { processor, resourceId, frequency, startDate, updatedBy }
  },
  roles: { admin, betaTester, developer },
  affiliate: { code, referrals, referrer },
  metadata: { created, updated },
  activity: { geolocation, client },
  api: { clientId, privateKey },
  usage: { requests: { monthly, daily, total, last } },
  personal: { birthday, gender, location, name, company, telephone },
  oauth2: {}
}

// Methods
userProps.merge(otherUser);    // Merge with another user object
```

### Analytics

Send events to Google Analytics 4:

```javascript
const analytics = Manager.Analytics({
  ctx: ctx,
  uuid: user.auth.uid,
});

analytics.event('purchase', {
  item_id: 'product-123',
  value: 29.99,
  currency: 'USD',
});
```

**Auto-tracked User Properties:**
- `app_version`, `device_category`, `operating_system`, `platform`
- `authenticated`, `subscription_id`, `subscription_trial_claimed`, `activity_created`
- `country`, `city`, `language`, `age`, `gender`

### Usage

Track and limit API usage:

```javascript
const usage = await Manager.Usage().init(ctx, {
  app: 'my-app',                    // App ID for limits
  key: 'custom-key',                // Optional custom key (default: user UID or IP)
  whitelistKeys: ['admin-key'],     // Keys that bypass limits
  unauthenticatedMode: 'firestore', // 'firestore' or 'local'
  refetch: false,                   // Force refetch app limits
  log: true,                        // Enable logging
});

// Check and validate limits
const currentUsage = usage.getUsage('requests');  // Get current monthly usage
const limit = usage.getLimit('requests');         // Get plan limit (monthly)
await usage.validate('requests');                 // Throws if over daily or monthly limit

// Increment usage (increments monthly, daily, and total counters)
usage.increment('requests', 1);
usage.set('requests', 0);  // Reset monthly to specific value

// Save to Firestore
await usage.update();

// Whitelist keys
usage.addWhitelistKeys(['another-key']);

// Proxy usage: bill a different user and mirror writes to additional docs
await usage.setUser('owner-uid');          // Switch target user (fetches from Firestore)
usage.addMirror('agents/agent-id');        // Also write usage to this doc on update()
usage.setMirrors(['agents/a', 'orgs/b']); // Overwrite mirror list
```

### Middleware

Process requests through the middleware pipeline:

```javascript
// In your function definition
exports.myEndpoint = functions
  .https.onRequest((req, res) => Manager.Middleware(req, res).run('myEndpoint', {
    authenticate: true,
    setupAnalytics: true,
    setupUsage: true,
    setupSettings: true,
    schema: 'myEndpoint',
  }));
```

The middleware automatically:
1. Parses multipart form data
2. Logs request details
3. Loads route handler (method-specific or index.js)
4. Authenticates user
5. Initializes usage tracking
6. Sets up analytics
7. Resolves settings from schema
8. Calls your route handler

### Settings

Resolve and validate request settings against a schema:

```javascript
const settings = Manager.Settings().resolve(ctx, schema, inputSettings, {
  dir: '/schemas',
  schema: 'mySchema',
  user: user,
  checkRequired: true,
});

// Timestamp constants
const timestamp = Manager.Settings().constant('timestamp');
// { types: ['string'], value: undefined, default: '2024-01-01T00:00:00.000Z' }

const timestampUNIX = Manager.Settings().constant('timestampUNIX');
// { types: ['number'], value: undefined, default: 1704067200 }

const timestampFULL = Manager.Settings().constant('timestampFULL');
// { timestamp: {...}, timestampUNIX: {...} }
```

### Utilities

Batch operations and helper functions:

```javascript
const utilities = Manager.Utilities();

// Batch iterate Firestore collection
const results = await utilities.iterateCollection(
  async ({ docs }, batch, totalCount) => {
    for (const doc of docs) {
      // Process each document
    }
    return { processed: docs.length };
  },
  {
    collection: 'users',
    batchSize: 1000,
    maxBatches: 10,
    where: [{ field: 'subscription.product.id', operator: '==', value: 'premium' }],
    orderBy: { field: 'metadata.created.timestamp', direction: 'desc' },
    startAfter: 'lastDocId',
    log: true,
  }
);

// Batch iterate Firebase Auth users
await utilities.iterateUsers(
  async ({ users, pageToken }, batch) => {
    for (const user of users) {
      // Process each auth user
    }
  },
  {
    batchSize: 1000,
    maxBatches: Infinity,
    log: true,
  }
);

// Get document with owner user
const { document, user } = await utilities.getDocumentWithOwnerUser('posts/abc123', {
  owner: 'owner',
  resolve: {
    schema: 'posts',
    ctx: ctx,
    checkRequired: false,
  },
});

// Generate random ID
const id = utilities.randomId({ size: 14 }); // 'A1b2C3d4E5f6G7'

// Cached Firestore read
const doc = await utilities.get('users/abc123', {
  maxAge: 1000 * 60 * 5, // 5 minute cache
  format: 'data',        // 'raw' or 'data'
});
```

### Metadata

Add timestamps and tags to documents:

```javascript
const metadata = Manager.Metadata(document);

document.metadata = metadata.set({ tag: 'my-operation' });
// {
//   updated: { timestamp: '...', timestampUNIX: ... },
//   tag: 'my-operation'
// }
```

### Local Storage

Persistent JSON storage using lowdb:

```javascript
const storage = Manager.storage({
  name: 'myStorage',     // Storage name (default: 'main')
  temporary: false,      // Use OS temp directory (default: false)
  clear: true,           // Clear on dev startup (default: true)
  log: false,            // Enable logging
});

// lowdb API
storage.set('key', 'value').write();
const value = storage.get('key').value();
storage.set('nested.path', { data: true }).write();
```

## Authentication

@omega.js/backend supports multiple authentication methods (checked in order):

1. **Bearer Token (JWT)**
   ```
   Authorization: Bearer <firebase-id-token>
   ```

2. **API Key**
   ```javascript
   { apiKey: 'user-private-key' }
   // or
   { authenticationToken: 'user-private-key' }
   ```

3. **OMEGA Admin Key** (Admin access — header only, never query/body)
   ```
   omega-admin-key: <OMEGA_ADMIN_KEY>
   ```
   A separate lane from `Authorization` (which stays user-only), so one request can be admin-authenticated AND carry a user token at the same time.

4. **Session Cookie**
   ```
   Cookie: __session=<firebase-id-token>
   ```

**Authenticated User Object:**

```javascript
const user = await ctx.authenticate();

{
  authenticated: true,
  auth: { uid: 'abc123', email: 'user@example.com' },
  roles: { admin: false, betaTester: false, developer: false },
  subscription: { product: { id: 'basic', name: 'Basic' }, status: 'active', ... },
  api: { clientId: '...', privateKey: '...' },
  // ... other user properties
}
```

## CLI Commands

@omega.js/backend includes a CLI for development and deployment:

```bash
# Install globally or use npx
npm install -g @omega.js/backend
# or
npx @omega.js/backend <command>
```

| Command | Description |
|---------|-------------|
| `mgr setup` | Run Firebase project setup and validation |
| `mgr serve` | Start local Firebase emulator |
| `mgr deploy` | Deploy functions to Firebase |
| `mgr test [paths...]` | Run integration tests |
| `mgr emulator` | Start Firebase emulator (keep-alive mode; HTTPS proxy on the public port, `--no-https` for plain http) |
| `mgr stripe` | Start Stripe CLI webhook forwarding to local server |
| `mgr version`, `mgr v` | Show @omega.js/backend version |
| `mgr clear` | Clear cache and temp files |
| `mgr install`, `mgr i` | Install @omega.js/backend (local — links every `@omega.js/*` dep from the Omega monorepo — or production) |
| `mgr clean:npm` | Clean and reinstall npm modules |
| `mgr firestore:indexes:get` | Get Firestore indexes |
| `mgr cwd` | Show current working directory |
| `mgr firestore:get <path>` | Read a Firestore document |
| `mgr firestore:set <path> '<json>'` | Write/merge a Firestore document |
| `mgr firestore:query <collection>` | Query a Firestore collection |
| `mgr firestore:delete <path>` | Delete a Firestore document |
| `mgr auth:get <uid-or-email>` | Get an Auth user by UID or email |
| `mgr auth:list` | List Auth users |
| `mgr auth:delete <uid-or-email>` | Delete an Auth user |
| `mgr auth:set-claims <uid-or-email> '<json>'` | Set custom claims on an Auth user |
| `mgr logs:read` | Fetch Cloud Function logs from Google Cloud Logging |
| `mgr logs:tail` | Stream live Cloud Function logs |

All Firestore and Auth commands support `--emulator` to target the local emulator, `--force` to skip confirmation, and `--raw` for compact JSON output.

Logs commands support `--fn <name>` (function name filter), `--severity <level>`, `--since <duration>` (read only), `--limit <n>` (read only), and `--raw`. Requires `gcloud` CLI installed and authenticated.

## Environment Variables

Set these in your `functions/.env` file:

| Variable | Description |
|----------|-------------|
| `OMEGA_ADMIN_KEY` | Admin authentication key |
| `STRIPE_SECRET_KEY` | Stripe secret key (enables auto webhook forwarding in `serve`/`emulator`) |

## Response Headers

@omega.js/backend attaches metadata to responses:

```
omega-properties: {"code":200,"tag":"functionName/executionId","usage":{...},"schema":{...}}
```

## Testing

@omega.js/backend includes an integration test framework that runs against the Firebase emulator.

### Running Tests

```bash
# Option 1: Two terminals (recommended for development)
npx omega emulator  # Terminal 1 - keeps emulator running
npx omega test      # Terminal 2 - runs tests

# Option 2: Single command (auto-starts emulator, shuts down after)
npx omega test
```

`npx omega emulator` **seeds the test personas on boot** (same wipe-and-create pass the test runner uses), so an emulator-connected dev site is signin-able immediately — any persona email + the deterministic `TEST_ACCOUNT_PASSWORD` (`omega-test-password`). Pass `--no-seed` to boot without seeding. Seeding is non-fatal: if it fails (e.g. missing config), the emulator keeps running. See [docs/test-framework.md](docs/test-framework.md#personas-n6).

**Ports auto-allocate (N7)**: boot resolves each emulator port from firebase.json, bumping +1 when taken — so a second brand's emulator runs ALONGSIDE the first instead of killing it (bumped runs boot via a generated, gitignored `firebase.resolved.json`; the committed firebase.json never changes). The resolved map publishes to `.temp/ports.json` (sibling processes — `omega test` reads it automatically) and `OMEGA_<NAME>_PORT` env (URL getters). Pin a port explicitly with the config `ports` section — pins never bump (busy pin = hard error). Single-brand dev on free defaults behaves exactly as before. `mgr serve` and `mgr emulator` allocate the same way (`--port` pins) and publish `https` (the mkcert proxy on the public port) + `hosting` (the internal plain-http port) so siblings — including `omega dev`'s page chrome — follow even a bumped run; Stripe forwarding targets the resolved plain-http port. Plain-http requests to the public port get a 307 redirect to https (typing `http://localhost:5002` lands in the right place). Pass `--no-https` (or run without mkcert installed) for plain http on the public port; the emulator an `omega test` run auto-starts is always plain.

### Extended Mode (real APIs)

Pass `--extended` (or set `TEST_EXTENDED_MODE=true`) on the **test command** to opt into real external API calls (SendGrid, Beehiiv, Stripe webhook handlers, marketing libraries). `--extended` is the CLI shorthand for the shared, unprefixed `TEST_EXTENDED_MODE` env var standardized across @omega.js/backend/BXM/UJM/EM — the two forms are equivalent. The mode flows automatically to BOTH the test-runner subprocess and the running emulator (via `<projectRoot>/.temp/test-mode.json`) — no need to set it on the emulator too:

```bash
# Terminal 1 — start once, no flag needed
npx omega emulator

# Terminal 2 — toggle freely between runs
npx omega test --extended ...                 # extended mode (--extended sets TEST_EXTENDED_MODE)
TEST_EXTENDED_MODE=true npx omega test ...    # identical — the env-var form
npx omega test ...                            # normal mode (next run flips back)
```

See [docs/test-framework.md](docs/test-framework.md#extended-mode-test_extended_mode) for the full mechanism.

### Filtering Tests

```bash
npx omega test rules/             # Project rules tests (bare paths = project source; C5 — docs/testing.md)
npx omega test framework:rules/   # Only @omega.js/backend's rules tests (aliases: omega:, mgr:, backend:)
npx omega test full:rules/        # Both sources
npx omega test user/ admin/       # Multiple project paths
```

### Log Files

@omega.js/backend CLI commands automatically save output to log files in the project's `functions/` directory (alongside firebase-tools' own `*-debug.log` files so everything is grep-able from one place):
- **`functions/dev.log`** — Output from `npx omega serve` (@omega.js/backend's local dev server)
- **`functions/emulator.log`** — Full emulator + Cloud Functions output (`npx omega emulator`)
- **`functions/test.log`** — Test runner output (`npx omega test`, when running against an existing emulator)
- **`functions/production.log`** — Production Cloud Function logs (`npx omega logs:read` or `npx omega logs:tail`)

Logs are overwritten on each run and gitignored via `*.log`. Use them to debug failing tests or review function output. Transient internal artifacts (reset sentinels, watch trigger, `test-mode.json`) live separately in `<projectDir>/.temp/`.

### Test Locations

- **@omega.js/backend core tests:** `test/`
- **Project tests:** `functions/test/`

Bare runs and bare paths are PROJECT-scoped (C5); reach the framework corpus explicitly with `framework:`/`omega:`/`mgr:`/`backend:`, or `full:` for both. Grammar: docs/testing.md in the Omega repo.

### Writing Tests

**Suite** - Sequential tests with shared state (stops on first failure):

```javascript
// test/functions/user/sign-up.js
module.exports = {
  description: 'User signup flow with affiliate tracking',
  type: 'suite',
  tests: [
    {
      name: 'verify-referrer-exists',
      async run({ firestore, assert, state, accounts }) {
        state.referrerUid = accounts.referrer.uid;
        const doc = await firestore.get(`users/${state.referrerUid}`);
        assert.ok(doc, 'Referrer should exist');
      },
    },
    {
      name: 'call-user-signup-with-affiliate',
      async run({ http, assert, state }) {
        const response = await http.as('referred').command('user:sign-up', {
          attribution: { affiliate: { code: 'TESTREF' } },
        });
        assert.isSuccess(response);
      },
    },
  ],
};
```

**Group** - Independent tests (continues even if one fails):

```javascript
// test/functions/admin/firestore-write.js
module.exports = {
  description: 'Admin Firestore write operation',
  type: 'group',
  tests: [
    {
      name: 'admin-auth-succeeds',
      auth: 'admin',
      async run({ http, assert }) {
        const response = await http.command('admin:firestore-write', {
          path: '_test/doc',
          document: { test: 'value' },
        });
        assert.isSuccess(response);
      },
    },
    {
      name: 'unauthenticated-rejected',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.command('admin:firestore-write', {
          path: '_test/doc',
          document: { test: 'value' },
        });
        assert.isError(response, 401);
      },
    },
  ],
};
```

**Auth levels:** `none`, `user`/`basic`, `admin`, `premium-active`, `premium-expired`

See `CLAUDE.md` for complete test API documentation.

## Subscription System

@omega.js/backend includes a built-in payment/subscription system with Stripe and PayPal integration.

### Subscription Statuses

| Status | Meaning | User can delete account? |
|--------|---------|--------------------------|
| `active` | Subscription is current and valid (includes trialing) | No (unless `product.id === 'basic'`) |
| `suspended` | Payment failed (Stripe: `past_due`, `unpaid`) | No |
| `cancelled` | Subscription terminated (Stripe: `canceled`, `incomplete`, `incomplete_expired`) | Yes |

### Stripe Status Mapping

| Stripe Status | `subscription.status` | Notes |
|---|---|---|
| `active` | `active` | Normal active subscription |
| `trialing` | `active` | `trial.claimed = true` |
| `past_due` | `suspended` | Payment failed, retrying |
| `unpaid` | `suspended` | Payment failed |
| `canceled` | `cancelled` | Subscription terminated |
| `incomplete` | `cancelled` | Never completed initial payment |
| `incomplete_expired` | `cancelled` | Expired before completion |
| `active` + `cancel_at_period_end` | `active` | `cancellation.pending = true` |

### PayPal Status Mapping

| PayPal Status | `subscription.status` | Notes |
|---|---|---|
| `ACTIVE` | `active` | Normal active subscription |
| `SUSPENDED` | `suspended` | Payment failed or manually suspended |
| `CANCELLED` | `cancelled` | Subscription terminated |
| `EXPIRED` | `cancelled` | Billing cycles completed |

### Product Configuration

Products are defined in `config.payment.products` with flat prices and per-processor IDs:

```javascript
payment: {
  products: [
    { id: 'basic', name: 'Basic', type: 'subscription', limits: { requests: 10 } },
    {
      id: 'plus', name: 'Plus', type: 'subscription',
      limits: { requests: 100 }, trial: { days: 14 },
      prices: { monthly: 28, annually: 276 },  // also supports 'weekly' and 'daily'
      stripe: { productId: 'prod_xxx' },
      paypal: { productId: 'PROD-abc123' },
    },
    {
      id: 'boost', name: 'Boost Pack', type: 'one-time',
      prices: { once: 9.99 },
      stripe: { productId: 'prod_yyy' },
    },
  ],
}
```

### Unified Subscription Object

The same subscription shape is stored in `users/{uid}.subscription` and `payments-orders/{orderId}.subscription`:

```javascript
subscription: {
  product: {
    id: 'basic',                   // product ID from config ('basic', 'premium', etc.)
    name: 'Basic',                 // display name from config
  },
  status: 'active',                // 'active' | 'suspended' | 'cancelled'
  expires: { timestamp, timestampUNIX },
  trial: {
    claimed: false,                // has user EVER used a trial
    expires: { timestamp, timestampUNIX },
  },
  cancellation: {
    pending: false,                // true = cancel at period end
    date: { timestamp, timestampUNIX },
  },
  payment: {
    processor: null,               // 'stripe' | 'paypal' | etc.
    resourceId: null,              // provider subscription ID (e.g., 'sub_xxx')
    frequency: null,               // 'monthly' | 'annually' | 'weekly' | 'daily'
    startDate: { timestamp, timestampUNIX },
    updatedBy: {
      event: { name: null, id: null },
      date: { timestamp, timestampUNIX },
    },
  },
}
```

### Access Check Patterns

```javascript
// Is premium (paid)?
user.subscription.status === 'active' && user.subscription.product.id !== 'basic'

// Is on trial?
user.subscription.trial.claimed && user.subscription.status === 'active'

// Has pending cancellation?
user.subscription.cancellation.pending === true

// Payment failed?
user.subscription.status === 'suspended'
```

### resolveSubscription(account)

Static method on the `User` helper that derives calculated subscription fields. Returns only fields that require derivation logic — raw data lives on the account object directly.

```javascript
const User = require('@omega.js/backend/dist/manager/helpers/user');

const resolved = User.resolveSubscription(account);
// Returns: { plan, active, trialing, cancelling }
```

| Field | Type | Description |
|-------|------|-------------|
| `plan` | `string` | Effective plan ID right now (`'basic'` if cancelled/suspended) |
| `active` | `boolean` | Has paid access (product is not `'basic'` and status is `'active'`) |
| `trialing` | `boolean` | In active trial (status `'active'` + claimed + unexpired) |
| `cancelling` | `boolean` | Cancellation pending (status `'active'` + `cancellation.pending`) |

The same function exists as `auth.resolveSubscription(account)` in [@omega.js/client](../client/) with identical logic and return shape.

## Final Words

If you are still having difficulty, open an issue in the OMEGA monorepo. It is much easier to answer questions that include your code and relevant files! So if you can provide them, we'd be extremely grateful (and more likely to help you find the answer!)

## Projects Using this Library

[Somiibo](https://somiibo.com/): A Social Media Bot with an open-source module library.
[JekyllUp](https://jekyllup.com/): A website devoted to sharing the best Jekyll themes.
[Slapform](https://slapform.com/): A backend processor for your HTML forms on static sites.
[SoundGrail Music App](https://app.soundgrail.com/): A resource for producers, musicians, and DJs.
[Hammock Report](https://hammockreport.com/): An API for exploring and listing backyard products.

Ask us to have your project listed! :)

## License

ISC
