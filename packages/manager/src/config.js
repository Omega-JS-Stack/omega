/**
 * Manager registry — SERVICE_ORDER, per-service OPERATIONS, and the manager
 * defaults layer. This is omega-manager's config.js reborn for the brand-
 * monorepo world: the brand's config/omega.json5 is the single source of
 * user choices (no .brands/ mirror), durable derived data lives in
 * .omega/state.json, and per-run transients in .omega/runs/{ts}.json.
 *
 * Services port over from omega-manager in stages. The full provisioning
 * order there is:
 *
 *   github → cloudflare → domain → firebase → recaptcha → analytics →
 *   search-console → adsense → sendgrid → beehiiv → payment → slapform →
 *   chatsy → replyify → server → assets → certificates → seo → disperse →
 *   update → account → migrations → bookmark → testing
 *
 * Ported so far: the local trio that makes a brand monorepo itself work —
 * workspace (structure/config health), update (install + build every app),
 * testing (per-target health checks) — plus the external provisioning
 * services github, cloudflare, domain, firebase, and recaptcha. External-API
 * services join this list one at a time, keeping their omega-manager names
 * and operation granularity.
 */

// =============================================================================
// APP DIRECTORY CONVENTIONS
// =============================================================================
// apps/<dir> → target mapping when the app doesn't declare its target in its
// own omega.json5. Exact match or `<name>-*` prefix (apps/website-docs → web).
const APP_DIR_TARGETS = {
  website: 'web',
  backend: 'backend',
  desktop: 'desktop',
  extension: 'extension',
  mobile: 'mobile',
};

// Inverse: canonical app dir name to suggest when an enabled target has no app
const TARGET_APP_DIRS = Object.fromEntries(
  Object.entries(APP_DIR_TARGETS).map(([dir, target]) => [target, dir]),
);

// =============================================================================
// DEFAULT SETTINGS - The manager defaults layer under every brand config
// =============================================================================
// Deliberately minimal: omega-manager's giant DEFAULTS block is service-owned
// data — each section moves here WITH its service port (cloudflare settings
// arrive with the cloudflare service, etc.). Never park defaults for services
// that don't exist here yet.
const DEFAULTS = {
  // Whether the brand is active (disabled brands are skipped)
  enabled: true,

  // GitHub settings (brand omega.json5 `github` key; org has no default — the
  // service skips with a message until it's configured)
  github: {
    shared: false, // true = the org is shared with other brands; skips org-level reconciliation
    private: true, // brand repo visibility
  },

  // Domain registrar + email. The domain service reconciles registrar
  // nameservers from `provider`; the cloudflare dns/email-routing operations
  // read `email.provider` + `email.forwarding`
  domain: {
    provider: null, // 'squarespace' | 'namecheap' | null (not chosen yet — the service skips)
    email: {
      provider: null, // 'squarespace' | 'privateemail' | 'cloudflare' | null
      forwarding: [], // [{ from: 'support' | '*', to: 'inbox@example.com' }]
    },
  },

  // Firebase settings. Auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the
  // brand .env. projectId has no default — the service skips until it's set
  // (project selection/creation rides the onboarding port). Company values
  // omega-manager hardcoded (billing account, googlegroup support email,
  // GCloud org) are config now — they land in company/brand config.
  firebase: {
    shared: false,        // true = project shared with other brands; only per-brand ops run (service-account, sdk-config)
    supportEmail: null,   // OAuth consent screen support email (defaults to support@{domain}; must be the authed user's email or a Google Group they own)
    organizationId: null, // GCloud org ID for project creation (onboarding port)
    billingAccount: null, // 'billingAccounts/XXXXXX-XXXXXX-XXXXXX' — required to auto-upgrade to Blaze
    apiSubdomain: true,   // false = skip the api.{domain} Firebase Hosting custom domain
  },

  // Classic reCAPTCHA — keys shared across brands, read from the brand .env
  // (RECAPTCHA_SITE_KEY + RECAPTCHA_SECRET_KEY; missing keys → the service
  // skips). `project` = the GCP project hosting the shared key, used only for
  // the console deep-link in guidance (omega-manager hardcoded the company
  // project here).
  recaptcha: {
    project: null,
  },

  // Cloudflare settings — the engine defaults are PLATFORM defaults only.
  // Company-specific records (DMARC report addresses, BIMI logo, SendGrid
  // domain-auth CNAMEs, verification TXTs, extra CSP hosts) belong in company/
  // brand config, NOT here — omega-manager hardcoded them; the port moved them
  // to config: dns.dmarcReports { rua, ruf }, dns.bimiLogo, dns.sendgrid
  // { id, whitelabel }, dns.records [...], and the responseHeaders rules.
  cloudflare: {
    dns: {
      spf: 'strict', // 'strict' (-all) | 'soft' (~all)
      dmarcPolicy: 'quarantine', // 'none' | 'quarantine' | 'reject'
      spfIncludes: ['_spf.google.com', 'sendgrid.net'], // provider include appended automatically
    },
    // Zone settings — flat map matching the Cloudflare API setting IDs exactly.
    // Managed by the generic `zone-settings` operation which diffs all keys in
    // one pass. Includes both bulk settings (from /zones/{id}/settings) and
    // addon settings (speed_brain, fonts) fetched individually.
    // Any brand can override with `cloudflare.settings.{setting_id}`.
    settings: {
      // SSL / TLS
      ssl: 'full',
      min_tls_version: '1.2',
      always_use_https: 'on',
      automatic_https_rewrites: 'on',
      opportunistic_encryption: 'on',
      opportunistic_onion: 'on',
      tls_1_3: 'zrt',
      tls_1_2_only: 'off',
      tls_client_auth: 'off',
      ech: 'on',                  // Encrypted Client Hello
      pq_keyex: 'on',             // Post-quantum key exchange
      replace_insecure_js: 'on',  // Block mixed content by rewriting http:// → https://

      // Scrape Shield
      email_obfuscation: 'off',   // Injects cloudflare-static/email-decode.min.js — breaks clean HTML
      server_side_exclude: 'on',
      hotlink_protection: 'off',  // Breaks legit embeds (Slack unfurls, etc.)

      // Speed
      brotli: 'on',
      early_hints: 'on',
      rocket_loader: 'off',       // Rewrites <script> tags — causes issues with modern frameworks
      speed_brain: 'on',          // Speculation Rules API — addon setting (not in bulk endpoint)
      fonts: 'on',                // Cloudflare Fonts — addon setting (not in bulk endpoint)

      // Network
      http3: 'on',
      '0rtt': 'on',
      ipv6: 'on',
      websockets: 'on',
      ip_geolocation: 'on',
      pseudo_ipv4: 'off',
      orange_to_orange: 'off',
      visitor_ip: 'on',

      // Caching
      cache_level: 'aggressive',
      browser_cache_ttl: 432000,  // 5 days
      always_online: 'on',
      development_mode: 'off',
      edge_cache_ttl: 7200,       // 2 hours — only applies without cache rules

      // Security
      security_level: 'low',
      browser_check: 'on',
      challenge_ttl: 1800,
      privacy_pass: 'on',
      waf: 'off',                 // Legacy WAF — Cloudflare replaced with rulesets
      max_upload: 100,
      security_header: {
        strict_transport_security: {
          enabled: true,
          max_age: 0,
          include_subdomains: true,
          preload: true,
          nosniff: true,
        },
      },

      // Logging
      log_to_cloudflare: 'on',
      filter_logs_to_cloudflare: 'off',
    },
    // Speed scheduled tests — custom API endpoint, kept as separate operation
    speedTest: {
      frequency: 'WEEKLY',
      region: 'us-central1',
    },
    // Cache rules — complex ruleset, kept as separate operation
    cacheRules: [
      {
        name: 'Assets: Cache for 1 Year',
        expression: '(http.request.uri.path wildcard r"/assets/*") or (http.request.uri.path eq "/__/auth/iframe.js")',
        edgeTtl: 31536000,
        browserTtl: 31536000,
        enabled: true,
        priority: 100,
      },
    ],
    rules: {
      managedTransforms: {
        request: {
          addClientCertificateHeaders: false,
          addVisitorLocationHeaders: true,
          removeVisitorIpHeaders: false,
          addWafCredentialCheckStatusHeader: false,
        },
        response: {
          removeXPoweredByHeader: true,
          addSecurityHeaders: false,
        },
      },
      responseHeaders: [
        {
          name: 'CSP: Allow iframe from self',
          expression: 'true',
          headers: {
            // Brand/company config overrides this rule to append extra hosts
            'Content-Security-Policy': "frame-ancestors 'self' https://localhost:* https://{ domain } https://*.{ domain }",
          },
          enabled: true,
          priority: 100,
        },
      ],
      redirect: [
        {
          name: 'Redirect: Remove Trailing Slash',
          expression: '(ends_with(http.request.uri.path, "/") and http.request.uri.path ne "/")',
          statusCode: 301,
          preserveQueryString: true,
          targetUrl: {
            expression: 'concat("https://", http.host, substring(http.request.uri.path, 0, -1))',
          },
          enabled: true,
          priority: 100,
        },
      ],
      security: [
        {
          name: 'API: Minimal Security',
          action: 'skip',
          expression: '(http.host eq "api.{ domain }")',
          skipProducts: ['uaBlock', 'bic', 'hot', 'securityLevel', 'rateLimit', 'zoneLockdown', 'waf'],
          skipPhases: ['http_ratelimit', 'http_request_firewall_managed', 'http_request_sbfm'],
          skipRuleset: 'current',
          logging: true,
          enabled: true,
          priority: 100,
        },
      ],
    },
  },
};

// =============================================================================
// SERVICE ORDER - Services run in this order due to dependencies
// =============================================================================
const SERVICE_ORDER = [
  'workspace',   // brand monorepo structure + config health — everything depends on a sane workspace
  'github',      // the brand repo must exist before services that write to it
  'cloudflare',  // zone must exist before DNS-dependent services
  'domain',      // registrar nameservers point at the zone cloudflare just created/verified
  'firebase',    // project must exist before analytics/backend-dependent services
  'recaptcha',   // validates the shared keys the frontend/backend consume from .env
  'update',      // installs deps + builds every app
  'testing',     // health checks after everything else ran
];

// =============================================================================
// OPERATIONS CONFIG - What operations to run for each service
// =============================================================================
const OPERATIONS = {
  workspace: [
    { name: 'structure', ensure: true },  // Root workspaces + an app per enabled target
    { name: 'config', ensure: true },     // omega.json5 loads + validates (brand and per-app)
    { name: 'gitignore', ensure: true },  // .omega/ is gitignored (state never gets committed)
  ],

  github: [
    { name: 'org', ensure: true },        // Org profile matches the brand (skipped for shared orgs)
    { name: 'repo', ensure: true },       // The brand-monorepo repo exists with the right settings
    { name: 'pages', ensure: true },      // GitHub Pages on gh-pages + custom domain (web target)
  ],

  cloudflare: [
    { name: 'zone', ensure: true },                     // Zone exists (created when missing; nameservers reported when pending)
    { name: 'dns-records', ensure: true },              // Required + custom records diff-synced
    { name: 'email-routing', ensure: true },            // Cloudflare Email Routing (only when domain.email.provider === 'cloudflare')
    { name: 'zone-settings', ensure: true },            // Generic — diffs all /zones/{id}/settings values + addons
    { name: 'cache-rules', ensure: true },
    { name: 'rules-managed-transforms', ensure: true },
    { name: 'rules-redirect', ensure: true },
    { name: 'rules-configuration', ensure: true },
    { name: 'rules-response-headers', ensure: true },
    { name: 'rules-security', ensure: true },
    { name: 'speed-scheduled-tests', ensure: true },    // Custom Speed API endpoint
    { name: 'workers', ensure: true },                  // Worker scripts + routes (only when cloudflare.workers configured)
  ],

  domain: [
    { name: 'nameservers', ensure: true }, // Registrar nameservers → Cloudflare (namecheap via API, manual registrars get instructions)
  ],

  firebase: [
    { name: 'billing', ensure: true },          // Blaze plan (links firebase.billingAccount when configured)
    { name: 'services', ensure: true },         // Required Google Cloud APIs + compute deploy roles
    { name: 'project-settings', ensure: true }, // GCP display name + the 'Web App' web app
    { name: 'oauth-consent', ensure: true },    // OAuth consent screen (support email)
    { name: 'service-account', ensure: true },  // Admin SDK service account + key → .omega/secrets + backend functions/
    { name: 'hosting', ensure: true },          // Hosting site + api.{domain} custom domains (DNS via Cloudflare)
    { name: 'firestore', ensure: true },        // Firestore database + PITR
    { name: 'database', ensure: true },         // Realtime Database
    { name: 'authentication', ensure: true },   // Identity Platform + sign-in methods + authorized domains
    { name: 'storage', ensure: true },          // Default storage bucket
    { name: 'functions', ensure: true },        // Cloud Functions readiness check (read-only)
    { name: 'cloud-messaging', ensure: true },  // FCM API + VAPID key pair (from state)
    { name: 'sdk-config', ensure: true },       // Web SDK config → state + omega.json5 drift check
  ],

  recaptcha: [
    { name: 'site-key', ensure: true }, // Secret key proven valid via siteverify; domain list is manual guidance (no classic API)
  ],

  update: [
    { name: 'targets', write: true },     // Installs deps, builds every app
  ],

  testing: [
    { name: 'target-checks', ensure: true }, // Per-target health checks (build output, backend files)
  ],
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Replace `{ key }` placeholders (spaces allowed) in every string of an
 * object tree — omega-manager's templateObject, minus the node-powertools
 * dependency. Unknown keys are left untouched.
 *
 * @param {*} obj - Any value; strings are templated, objects/arrays recursed
 * @param {Object} data - Placeholder values (e.g. { domain: 'somiibo.com' })
 * @returns {*} - Same shape with placeholders substituted
 */
function templateObject(obj, data) {
  if (typeof obj === 'string') {
    return obj.replace(/\{\s*([\w.]+)\s*\}/g, (match, key) => {
      return key in data ? data[key] : match;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => templateObject(item, data));
  }

  if (obj !== null && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = templateObject(value, data);
    }
    return result;
  }

  return obj;
}

module.exports = {
  APP_DIR_TARGETS,
  TARGET_APP_DIRS,
  DEFAULTS,
  SERVICE_ORDER,
  OPERATIONS,
  templateObject,
};
