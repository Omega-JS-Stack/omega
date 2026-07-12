/**
 * Manager registry — SERVICE_ORDER, per-service OPERATIONS, and the manager
 * defaults layer. This is omega-manager's config.js reborn for the brand-
 * monorepo world: the brand's config/omega.json5 is the single source of
 * user choices (no .brands/ mirror), durable derived data lives in
 * .omega/state.json, and per-run transients in .omega/runs/{ts}.json.
 *
 * omega-manager's full provisioning order is ported — every service in
 *
 *   github → cloudflare → domain → firebase → recaptcha → analytics →
 *   search-console → adsense → sendgrid → beehiiv → payment → slapform →
 *   chatsy → replyify → server → assets → certificates → seo → disperse →
 *   update → account → migrations → bookmark → testing
 *
 * now runs here, plus the workspace service (brand structure/config
 * health) the monorepo world added. disperse is the remnant of its old
 * self (signing artifacts + composed app .env files — the config
 * dispersal dissolved into the omega.json5 hierarchy), and bookmark +
 * the beehiiv segment automation talk to the companion Chrome extension
 * in extension/ (the last piece, ported with it). Onboarding is the
 * `onboard` wizard and company mode rides runCompany.
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

// Framework package per target — used by the testing service to compare each
// app's installed framework against the npm latest. Names flip to their
// @omega.js/* successors at each rename cutover; mobile is reserved (MAM
// parked, no framework to check).
const TARGET_FRAMEWORKS = {
  web: '@omega.js/web',
  backend: '@omega.js/backend',
  extension: '@omega.js/extension',
  desktop: '@omega.js/desktop',
};

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

  // Parent brand URL — the central backend that children fan webhook events
  // to (sendgrid event-webhook, beehiiv webhook) and newsletter generators
  // fetch sources from. The parent brand itself uses 'self'. omega-manager
  // defaulted this to the company's parent URL — it's config now, no default.
  parent: null,

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
  // brand .env. projectId has no default — interactive runs offer the
  // project selection/creation flow and land it here; non-interactive runs
  // skip until it's set. Company values omega-manager hardcoded (billing
  // account, googlegroup support email, GCloud org) are config now — they
  // land in company/brand config.
  firebase: {
    shared: false,        // true = project shared with other brands; only per-brand ops run (service-account, sdk-config)
    supportEmail: null,   // OAuth consent screen support email (defaults to the AUTHORIZING user's email — Google rejects any address the caller doesn't own; set only for an owned Google Group)
    organizationId: null, // GCloud org ID — the project-create flow creates projects inside it (proper default permissions)
    billingAccount: null, // 'billingAccounts/XXXXXX-XXXXXX-XXXXXX' — required to auto-upgrade to Blaze
    apiSubdomain: true,   // false = skip the api.{domain} Firebase Hosting custom domain
  },

  // Analytics providers. Google auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
  // in the brand .env (analytics.edit scope, tokens cached separately from
  // firebase's). propertyId is required config — interactive runs offer the
  // account + property selection/creation flow and land both ids here
  // (comment-preserving writeback). Meta/TikTok pixel IDs are public config;
  // their access tokens live in the brand .env (META_ACCESS_TOKEN /
  // TIKTOK_ACCESS_TOKEN — the names @omega.js/backend reads).
  analytics: {
    providers: {
      google: {
        accountId: null,  // GA account number — console deep-links; the selection flow lands it
        propertyId: null, // GA4 property number — google operations skip until set (the selection/create flow lands it)
        timeZone: 'America/Los_Angeles', // GA4 property reporting time zone (used when the flow creates the property)
        currency: 'USD',                 // GA4 property reporting currency (used when the flow creates the property)
        enhancedMeasurement: {
          streamEnabled: true,
          scrollsEnabled: true,
          outboundClicksEnabled: true,
          siteSearchEnabled: true,
          videoEngagementEnabled: true,
          fileDownloadsEnabled: true,
          pageChangesEnabled: true,
          formInteractionsEnabled: true,
        },
      },
      meta: { id: null },   // Meta Pixel ID
      tiktok: { id: null }, // TikTok Pixel Code
    },
  },

  // Devlog — auto-generated commit-digest blog posts (standalone
  // `omega-manager devlog`). Stateless: each run fetches commits from the
  // last `lookbackDays` days, has the provider (Ghostii) write the article,
  // and publishes to `destinations`. Not a service — never runs during manage.
  devlog: {
    enabled: false,
    provider: 'ghostii',        // Article writer (only ghostii supported)
    lookbackDays: 5,
    orgs: [],                   // GitHub orgs/users to fully scan — for NON-brand repos (frameworks, tooling); brand repos are always scanned via the brand configs
    excludeRepos: [],           // Repo names never fetched or mentioned
    excludeCommits: [],         // Regex patterns (case-insensitive) — matching commit messages never reach the digest
    excludeTopics: [],          // Topics the writer must never discuss
    includePrivate: true,       // Scan private repos too — exclude rules govern what gets WRITTEN, not what gets read
    postPath: 'devlog',         // Sub-folder under src/_posts/{year}/ in the website app
    destinations: ['website'],  // website | devto | hashnode | medium (planned)
    overrides: {                // Ghostii API overrides
      length: 'long',
      research: false,          // The digest is the source — no web research
      insertImages: false,      // Local publisher doesn't mirror images into the repo (yet)
      headerImageUrl: 'disabled',
      maxLinks: 10,             // Backlinks are the point — allow more than Ghostii's default 6
    },
  },

  // Search Console. The domain property (sc-domain:) covers every subdomain;
  // DNS TXT verification writes through Cloudflare. Auth: the same
  // GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET as firebase/analytics (own token
  // cache — webmasters + siteverification scopes). omega-manager also carried
  // a `subdomains: []` key here that nothing ever read — dropped.
  searchConsole: {
    submitSitemap: true,          // false = skip sitemap submission
    sitemapPaths: ['/sitemap.xml'], // submitted as https://{domain}{path}
  },

  // AdSense. The Management API v2 is read-only — sites can't be added or
  // configured programmatically — so the service verifies the domain is
  // present and reports its approval state; adding is a console deep-link.
  // accountId is required config (omega-manager defaulted it to the company's
  // shared pub- account; put it in company config for that). Interactive
  // runs offer the account selection flow. Auth: the same GOOGLE creds
  // (adsense.readonly scope, own token cache).
  adsense: {
    accountId: null, // 'pub-XXXXXXXXXXXXXXXX' — the service skips until set (the selection flow lands it)
  },

  // Marketing. campaigns = the email-marketing provider (the sendgrid
  // service); newsletter = the newsletter provider (the beehiiv service).
  // listId/publicationId are resolved by the services and written back here
  // (comment-preserving writeback), with a state mirror as the resolution
  // cache. Auth: SENDGRID_API_KEY / BEEHIIV_API_KEY in the brand .env
  // (+ OMEGA_WEBHOOK_KEY for the webhook operations).
  // omega-manager also carried a newsletter.content generator blob here —
  // it's @omega.js/backend newsletter-generator data, not service config; it rides the
  // config-hierarchy dispersal story.
  marketing: {
    campaigns: {
      enabled: true,
      provider: 'sendgrid',
      listId: null,
    },
    newsletter: {
      enabled: true,
      provider: 'beehiiv',
      publicationId: null,
    },
  },

  // Payment processors + products. Public halves live here (publishableKey,
  // clientId, site); secrets come from the brand .env (STRIPE_SECRET_KEY,
  // PAYPAL_CLIENT_SECRET, CHARGEBEE_API_KEY). Interactive runs offer the
  // key-collection flow when an enabled processor is missing credentials
  // (public keys land here, secrets in the .env). Set a processor to
  // `false` to disable it — the flow's Disable answer writes that.
  // Product IDs are written back here by the services (state keeps a mirror).
  // omega-manager's DEFAULTS also carried the company's Stripe organizationId
  // (dashboard deep-links use the account ID from state now) and hardcoded
  // the company CDN for product images (brand.images.brandmark now).
  payment: {
    enabled: true,
    processors: {
      stripe: {
        publishableKey: null,
        updateAccountInfo: true, // false = leave the account's business profile alone
        // Radar fraud-prevention rules — Dashboard-only (no API); the
        // stripe-radar operation prints these as guidance until confirmed.
        // Actions: 'block', 'allow', 'review', 'request_three_d_secure'.
        // Predicate syntax: https://docs.stripe.com/radar/rules/reference
        radar: [
          // --- Card type restrictions ---
          { action: 'block', predicate: ":card_funding: = 'prepaid'", description: 'Block prepaid cards' },
          { action: 'block', predicate: ":card_brand: = 'mastercard' AND :card_funding: = 'debit'", description: 'Block Mastercard debit' },

          // --- Risk-based rules ---
          { action: 'block', predicate: ":risk_level: = 'highest'", description: 'Block highest risk payments' },
          { action: 'review', predicate: ":risk_level: = 'elevated'", description: 'Review elevated risk payments' },

          // --- Address/CVC verification ---
          { action: 'block', predicate: ":cvc_check: = 'fail'", description: 'Block failed CVC checks' },
          { action: 'block', predicate: ":address_zip_check: = 'fail'", description: 'Block failed ZIP checks' },

          // --- Velocity / abuse ---
          { action: 'block', predicate: ':total_charges_per_card_number_daily: > 5', description: 'Block >5 charges per card per day' },
          { action: 'block', predicate: ':total_charges_per_ip_address_daily: > 10', description: 'Block >10 charges per IP per day' },

          // --- 3D Secure for risky but not blocked ---
          { action: 'request_three_d_secure', predicate: ":risk_level: = 'elevated'", description: 'Require 3DS for elevated risk' },
        ],
      },
      paypal: {
        clientId: null,
      },
      chargebee: {
        site: null,
      },
      coinbase: {
        enabled: false,
      },
    },
    products: [], // [{ id, name, type: 'subscription'|'one-time', prices: { monthly, annually, once }, trial: { days }, ... }]
  },

  // Slapform contact form (slapform.com) — Slapform-operator integration:
  // needs SLAPFORM_SERVICE_ACCOUNT in the brand .env (path to the Slapform
  // Firebase project's service-account JSON). formId comes from the Slapform
  // dashboard (interactive runs offer the paste-back flow and land it
  // here); plan = the tier granted to the form-owner account (Slapform's
  // top tier by default — omega-manager resolved it from the slapform brand's
  // own config in `.brands/`, a company-mode read).
  slapform: {
    enabled: true,
    formId: null,
    plan: { id: 'grandmaster', name: 'Grandmaster' },
  },

  // Chatsy support chat (chatsy.ai) — Chatsy-operator integration: needs
  // CHATSY_SERVICE_ACCOUNT in the brand .env (path to the Chatsy Firebase
  // project's service-account JSON). agentId comes from the Chatsy dashboard
  // (interactive runs offer the paste-back flow and land it here);
  // plan = the tier granted to the agent-owner account (Chatsy's top tier by
  // default — omega-manager resolved it from the chatsy brand's own config in
  // `.brands/`, a company-mode read). updateAgentInfo: false = the agent is
  // shared and managed by another brand. sponsorshipsUrl fills the baseline
  // knowledge's sponsorship line (omega-manager hardcoded the company page;
  // null → {website}/contact). The agent image comes from
  // brand.images.brandmark (omega-manager hardcoded the company CDN).
  chatsy: {
    enabled: true,
    updateAgentInfo: true,
    agentId: null,
    plan: { id: 'max', name: 'Max' },
    sponsorshipsUrl: null,
  },

  // Replyify customer-service email agent (replyify.app) — Replyify-operator
  // integration: needs REPLYIFY_SERVICE_ACCOUNT in the brand .env (path to
  // the Replyify Firebase project's service-account JSON). agentId comes from
  // the Replyify dashboard (interactive runs offer the paste-back flow and
  // land it here); plan = the tier granted to the agent-owner
  // account (Replyify's top tier by default — omega-manager resolved it from
  // the replyify brand's own config in `.brands/`, a company-mode read).
  // updateAgentInfo: false = the agent is shared and managed by another
  // brand. discount renders the baseline's discount section only when set
  // ({ code, label } — omega-manager hardcoded the company's code for every
  // brand); the company sponsorship block left the packaged baseline
  // entirely — that prose belongs in config/replyify.md.
  replyify: {
    enabled: true,
    updateAgentInfo: true,
    agentId: null,
    plan: { id: 'max', name: 'Max' },
    discount: null,
  },

  // Company-server brand registry — publishes the brand's registry entry
  // (brand identity, github, sponsorships) to the company server's Firestore
  // at brands/{brand.id}, where the parent backend reads it (webhook fan-out,
  // cross-brand features). Needs SERVER_SERVICE_ACCOUNT in the brand .env
  // (path to the company server's Firebase service-account JSON — omega-
  // manager hardcoded the company project and read company-instance secrets).
  server: {
    enabled: true,
  },

  // Derived visual collateral generated locally from the brand's logo
  // sources (assets/logo/*.svg in the brand repo → .omega/assets/):
  // wordmark/combomark from brand.font (omega-manager packaged the
  // company's commercial fonts and defaulted every brand to CromaSans —
  // the port has no packaged fonts, the brand owns its font choice), logo
  // variants + PNG ladders, app icons, social icons, favicons. Every
  // operation is mtime-diffed; no brandmark → clean skip.
  assets: {
    enabled: true,
  },

  // Apple signing certificates, bundle IDs, and provisioning profiles for
  // brands with desktop/mobile targets, reconciled via the App Store
  // Connect API. Credentials live in the brand .env (APPLE_API_ISSUER,
  // APPLE_API_KEY_ID, APPLE_TEAM_ID) plus an AuthKey_*.p8 placed in
  // .omega/certificates/apple/. bundleIdPrefix MUST be set by the brand
  // (e.g. 'com.mycompany') — omega-manager hardcoded the company prefix
  // and kept one shared cert set in its company-instance .output/_shared/;
  // the port keeps everything brand-local.
  certificates: {
    enabled: true,
    apple: {
      // Full bundle ID = `${bundleIdPrefix}.${brand.id}`
      bundleIdPrefix: null,
      // Capabilities enabled on the brand's bundle ID
      capabilities: ['APPLE_ID_AUTH'],
      // Cert types that get a provisioning profile per applicable platform
      profiles: ['IOS_DISTRIBUTION', 'MAC_APP_DISTRIBUTION', 'DEVELOPER_ID_APPLICATION_G2'],
      // Certificate types to manage (one set per Apple Developer account).
      // manual: Apple's API cannot create these — the Account Holder
      // downloads the .cer from the developer portal.
      certificates: [
        { type: 'DEVELOPMENT' },
        { type: 'IOS_DISTRIBUTION' },
        { type: 'MAC_INSTALLER_DISTRIBUTION' },
        { type: 'MAC_APP_DISTRIBUTION' },
        { type: 'DEVELOPER_ID_APPLICATION_G2', manual: true },
        { type: 'DEVELOPER_ID_INSTALLER_G2', manual: true },
      ],
    },
  },

  // Parasite SEO content — programmatically created GitHub repos with
  // templated READMEs. Content definitions live in seo.github.content
  // (config/omega.json5) or the config/seo.json5 sidecar (omega-manager
  // kept them in .brands/{id}/seo.json and auto-created a default entry
  // for every brand; the port never writes config — no content = skip).
  seo: {
    enabled: true,
  },

  // Required accounts in the brand's Firebase Auth — created/converged with
  // deterministic passwords derived from ACCOUNT_PASSWORD_SEED (brand .env,
  // auto-generated on the first real run). `{domain}` in emails resolves to
  // the brand's domain. Per entry: account: true = ensure the auth user
  // exists with the derived password + roles.admin + the highest plan;
  // marketing: true = push the contact to the marketing providers via the
  // brand backend. Any OTHER user holding roles.admin fails the service.
  // (omega-manager hardcoded the company's personal emails as ADMIN_EMAILS
  // and derived passwords from a company-specific formula in code.)
  account: {
    enabled: true,
    admins: [
      { email: 'support@{domain}', account: true, marketing: true },
    ],
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
  'workspace',       // brand monorepo structure + config health — everything depends on a sane workspace
  'github',          // the brand repo must exist before services that write to it
  'cloudflare',      // zone must exist before DNS-dependent services
  'domain',          // registrar nameservers point at the zone cloudflare just created/verified
  'firebase',        // project must exist before analytics/backend-dependent services
  'recaptcha',       // validates the shared keys the frontend/backend consume from .env
  'analytics',       // GA4 streams need the firebase link; search-console links to analytics next
  'search-console',  // needs the cloudflare zone (DNS verification) + the GA property (association)
  'adsense',         // domain present in the AdSense account + approval state (read-only API)
  'sendgrid',        // email marketing: domain auth (DNS via cloudflare), sender, list, fields, segments, webhook
  'beehiiv',         // newsletter publication: access, fields, segments (verify-only), webhook
  'payment',         // Stripe/PayPal/Chargebee products + prices + webhooks reconciled to payment.products
  'slapform',        // brand's Slapform contact form settings + owner-account plan (Slapform operator only)
  'chatsy',          // brand's Chatsy chat agent settings + knowledge + owner-account plan (Chatsy operator only)
  'replyify',        // brand's Replyify email agent filter + knowledge + owner-account plan (Replyify operator only)
  'server',          // brand registry entry on the company server's Firestore (company-server operators only)
  'assets',          // derived logo variants, app icons, social icons, favicons (local, mtime-diffed)
  'certificates',    // Apple certs, bundle IDs, provisioning profiles (desktop/mobile targets only)
  'disperse',        // signing artifacts + composed app .env files land in the apps (after certificates, before update builds)
  'seo',             // parasite SEO GitHub repos — low priority, no downstream deps
  'update',          // installs deps + builds every app
  'account',         // required Firebase Auth accounts + admin roles (after deploy — signup calls hit the live backend)
  'migrations',      // Firestore data migrations — only with --migration, after the deployed backend is current
  'bookmark',        // brand bookmarks → the companion Chrome extension (interactive sessions only)
  'testing',         // health checks after everything else ran
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

  analytics: [
    { name: 'google-streams', ensure: true },       // One GA4 web stream per target (+ enhanced measurement + MP secret)
    { name: 'google-firebase-link', ensure: true }, // GA property ↔ Firebase project link (+ auto-stream normalization)
    { name: 'meta-pixel', ensure: true },           // Pixel ID + META_ACCESS_TOKEN presence
    { name: 'tiktok-pixel', ensure: true },         // Pixel Code + TIKTOK_ACCESS_TOKEN presence
  ],

  'search-console': [
    { name: 'property', ensure: true }, // sc-domain property exists (DNS TXT verification via Cloudflare, one-pass)
    { name: 'ga-link', ensure: true },  // GA association — no API exists; warned + URL until confirmed
    { name: 'sitemaps', ensure: true }, // Missing sitemaps submitted (existing ones are converged, not resubmitted)
  ],

  adsense: [
    { name: 'sites', ensure: true }, // Domain present in AdSense + approval state (read-only API — adding is manual)
  ],

  sendgrid: [
    { name: 'domain-auth', ensure: true },     // Domain authentication (DKIM CNAMEs via Cloudflare, one-pass validate)
    { name: 'sender-identity', ensure: true }, // Verified sender for Single Sends (offers@{contact domain})
    { name: 'list', ensure: true },            // The brand's marketing list (id written back to omega.json5)
    { name: 'custom-fields', ensure: true },   // @omega.js/backend custom fields (@omega.js/backend's marketing SSOT)
    { name: 'segments', ensure: true },        // @omega.js/backend segments (query_dsl diffed; __temp_ orphans swept)
    { name: 'event-webhook', ensure: true },   // Account-global Event Webhook → parent @omega.js/backend forwarder (min-diff PATCH)
  ],

  beehiiv: [
    { name: 'publication', ensure: true },   // Publication access (config/state id, auto-match by name; creation is manual)
    { name: 'custom-fields', ensure: true }, // @omega.js/backend custom fields (@omega.js/backend's marketing SSOT, diffed by display)
    { name: 'segments', ensure: true },      // @omega.js/backend segments verified (no create API — instructions when missing)
    { name: 'webhook', ensure: true },       // Publication webhook → parent @omega.js/backend forwarder (min-diff PATCH)
  ],

  payment: [
    { name: 'paypal-account', ensure: true },     // Auth probe (live/sandbox detection) + app info
    { name: 'paypal-webhook', ensure: true },     // Webhook endpoint → brand backend (event_types diffed)
    { name: 'paypal-products', ensure: true },    // Catalog products + billing plans (config → state → name match → create)
    { name: 'stripe-account', ensure: true },     // Business profile diffed to brand config
    { name: 'stripe-radar', ensure: true },       // Radar rules guidance (no API — warned until confirmed)
    { name: 'stripe-disputes', ensure: true },    // Enhanced Dispute Protection guidance (no API — warned until confirmed)
    { name: 'stripe-webhook', ensure: true },     // Webhook endpoint → brand backend (re-enable + enabled_events diffed)
    { name: 'stripe-products', ensure: true },    // Products + prices (config → state → metadata match → create; stale prices archived)
    { name: 'chargebee-account', ensure: true },  // API access probe + site info
    { name: 'chargebee-webhook', ensure: true },  // Webhook endpoint → brand backend (&brand= URL; events set on create only)
    { name: 'chargebee-products', ensure: true }, // Item family → items → item prices (deterministic IDs; legacy plans reported)
  ],

  slapform: [
    { name: 'form', ensure: true }, // Form name + enabled diffed against Slapform Firestore
    { name: 'user', ensure: true }, // Form-owner account set to slapform.plan (internal comp)
  ],

  chatsy: [
    { name: 'chat', ensure: true }, // Agent settings + knowledge diffed against Chatsy Firestore
    { name: 'user', ensure: true }, // Agent-owner account set to chatsy.plan (internal comp)
  ],

  replyify: [
    { name: 'agent', ensure: true }, // Agent filter + knowledge diffed against Replyify Firestore
    { name: 'user', ensure: true },  // Agent-owner account set to replyify.plan (internal comp)
  ],

  server: [
    { name: 'brands', ensure: true }, // Registry entry replace-synced against the company server's Firestore
  ],

  assets: [
    { name: 'logo-gen', ensure: true },     // Wordmark + combomark from brandmark + brand.font (missing-only)
    { name: 'process', write: true },       // Color/black SVG variants + PNG size ladders per logo source
    { name: 'templates', write: true },     // Brand PSDs seeded from the company + logo/text layers refreshed + PNG exports
    { name: 'icons', write: true },         // macOS .icns + Windows .ico app icons (composited icon.png when the templates op made one)
    { name: 'social-icons', write: true },  // Brandmark-on-white social profile icons
    { name: 'favicons', write: true },      // Web favicon set + site.webmanifest
  ],

  certificates: [
    { name: 'api-key', ensure: true },      // App Store Connect creds resolved + client ready
    { name: 'certificates', ensure: true }, // Signing certs — download or create via CSR, export .p12, keychain import
    { name: 'bundle-ids', ensure: true },   // Brand bundle ID exists with the required capabilities
    { name: 'profiles', ensure: true },     // Provisioning profiles per platform × cert type
  ],

  disperse: [
    { name: 'certs', write: true },  // Signing artifacts copied into desktop/mobile apps' certs dirs
    { name: 'env', write: true },    // Each app's gitignored .env composed (brand env + stream secrets + signing paths)
  ],

  seo: [
    { name: 'github-repos', ensure: true }, // Parasite SEO repos exist + match their template
  ],

  update: [
    { name: 'targets', write: true },     // Installs deps, builds every app
  ],

  account: [
    { name: 'users', ensure: true },      // Auth accounts exist + passwords/admin roles converged + admin audit
  ],

  migrations: [
    { name: 'notifications', ensure: true }, // uid→owner + metadata/context/attribution + validate schema
    { name: 'users', ensure: true },         // plan→subscription + @omega.js/backend-schema backfill + orphan cleanup + validate
  ],

  bookmark: [
    { name: 'sync', ensure: true },       // Push brand console/dashboard bookmarks to the companion Chrome extension
  ],

  testing: [
    { name: 'target-checks', ensure: true }, // Per-app local checks (build output, backend files, framework version) + live checks (homepage, API health, GitHub Actions)
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
  TARGET_FRAMEWORKS,
  DEFAULTS,
  SERVICE_ORDER,
  OPERATIONS,
  templateObject,
};
