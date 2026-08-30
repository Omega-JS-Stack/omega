/**
 * Manager registry — SERVICE_ORDER, per-service OPERATIONS, and the manager
 * defaults layer. This is omega-manager's config.js reborn for the brand-
 * monorepo world: the brand's config/omega.json5 is the single home of every
 * provisioned fact (no .brands/ mirror), secrets live in the brand .env, and
 * per-run transients in .omega/runs/{ts}.json.
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
 * self (signing artifacts — the config dispersal dissolved into the
 * omega.json5 hierarchy, the .env composition into the delivery step every
 * verb runs, #678), and bookmark +
 * the beehiiv segment automation talk to the companion Chrome extension
 * in extension/ (the last piece, ported with it). Onboarding is the
 * `onboard` wizard and company mode rides runCompany.
 *
 * Provider-named services renamed to their config ROLE key (cp134, Ian:
 * "rename services so they match the config key"): firebase→cloud,
 * sendgrid→campaigns, beehiiv→newsletter, sentry→monitoring; the last eight
 * followed in #418: github→repo, cloudflare→edge, recaptcha→captcha,
 * search-console→search, adsense→advertising, slapform→forms, chatsy→chat,
 * replyify→email. Provider STRINGS and provider KEYS in config
 * (cloud.provider: 'firebase', edge.providers.cloudflare,
 * inbound.chat.providers.chatsy, …) are unchanged — the service is the role,
 * the provider is a value.
 */

// =============================================================================
// TARGET DIRECTORY CONVENTIONS
// =============================================================================
// targets/<dir> → target mapping when the target dir doesn't declare its target
// in its
// own omega.json5. Exact match or `<name>-<id>` suffix (targets/website-admin →
// web, instance admin). The mapping's SSOT moved to @omega.js/config with the
// multi-instance work (the config loader walks the same dirs) — re-exported
// here so every existing manager import keeps working.
const { DIR_TARGETS, TARGET_DIRS, isDemoProject, chosenProvider, schemaDefaults, deepMerge } = require('@omega.js/config');
const { resolveRegistrar } = require('./services/domain/lib/registrars.js');

// Framework package per target — used by the testing service to compare each
// target's installed framework against the npm latest. Names flip to their
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
//
// SERVICE-OWNED data ONLY (#478): a default for a key @omega.js/config's schema
// declares lives THERE, as that entry's `default:` — the schema is the one home,
// and the manage walk materializes those blocks into the brand's own
// omega.json5. What stays here is the engine data the schema does not declare
// (Cloudflare zone settings, Apple cert types, Stripe Radar rules, the GA4
// property fields) plus the placeholder keys a service writes back into. The
// exported DEFAULTS is the two composed, schema first.
const MANAGER_DEFAULTS = {
  // Whether the brand is active (disabled brands are skipped)
  enabled: true,

  // Parent brand URL — the central backend that children fan webhook events
  // to (sendgrid event-webhook, beehiiv webhook) and newsletter generators
  // fetch sources from. The parent brand itself uses 'self'. omega-manager
  // defaulted this to the company's parent URL — it's config now, no default.
  parent: null,

  // Domain registrar + email — two roles, one providers block each (#425).
  // The domain service reconciles registrar nameservers from the KEY under
  // `providers`; the cloudflare dns/email-routing operations read the key
  // under `email.providers` + `email.forwarding`. No entry = not chosen yet,
  // and the service skips (what a null provider meant).
  domain: {
    providers: {},    // { namecheap: {} } | { squarespace: {} } — one registrar
    email: {
      providers: {},  // { cloudflare: {} } | { squarespace: {} } | { privateemail: {} }
      forwarding: [], // [{ from: 'support' | '*', to: 'inbox@example.com' }] — role-level, provider-agnostic
    },
  },

  // Cloud settings — ONE home (#23): the provisioning fields the manager owns
  // sit beside `cloud.provider`/`cloud.config` (the target config @omega.js/config
  // declares), including the platform-level org + billing account the project
  // ensures consume. Auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the
  // brand .env. projectId has no default and lives ONLY at cloud.config.projectId
  // — interactive runs offer the project selection/creation flow and land it
  // there; non-interactive runs skip until it's set. Company values
  // omega-manager hardcoded (googlegroup support email, the company org and
  // billing account) are config now — they land in company/brand config.
  cloud: {
    supportEmail: null,   // OAuth consent screen support email (defaults to the AUTHORIZING user's email — Google rejects any address the caller doesn't own; set only for an owned Google Group)
    organizationId: null, // GCloud org ID — tri-state (#33): null = ask at project create, false = no org (standalone), value = create inside it (proper default permissions)
    billingAccount: null, // 'billingAccounts/XXXXXX-XXXXXX-XXXXXX' — tri-state: null = ask, false = stay on Spark, value = auto-upgrade to Blaze
  },

  // Analytics providers. Google auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
  // in the brand .env (analytics.edit scope, tokens cached separately from
  // firebase's). propertyId is required config — interactive runs offer the
  // account + property selection/creation flow and land both ids here
  // (comment-preserving writeback). Meta/TikTok pixel IDs are public config
  // too — the service CREATES the pixel on the platform's accountId and lands
  // its id here (#417); Meta needs neither filled in, since an interactive run
  // pastes the token in and discovers the ad account from it (a provider set
  // to `false` opts out of all of it). Their access tokens live in the brand
  // .env (META_ACCESS_TOKEN / TIKTOK_ACCESS_TOKEN — the names @omega.js/backend
  // reads, and the credentials the creates authenticate with). Per-target
  // GA4 measurement ids land under targets.{target}.analytics.providers
  // .google.id — one stream per surface, so one id per surface.
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
      meta: {
        id: null,        // Meta Pixel ID — the create lands it (public config: it ships in the frontend)
        accountId: null, // Meta AD ACCOUNT number (bare, no act_ prefix) the pixel is created on — discovered from META_ACCESS_TOKEN when unset
      },
      tiktok: {
        id: null,        // TikTok Pixel Code — the create lands it
        accountId: null, // TikTok ADVERTISER id the pixel is created on — no account, no create
      },
    },
  },

  // Devlog — auto-generated commit-digest blog posts (standalone
  // `omega-manager devlog`). Stateless: each run fetches commits from the
  // last `lookbackDays` days, has the provider (Ghostii) write the article,
  // and publishes to `destinations`. Not a service — never runs during manage.
  devlog: {
    enabled: false,               // Role-level: the whole pipeline's switch
    providers: {
      ghostii: {                  // Article writer — presence picks it (only ghostii exists)
        lookbackDays: 5,
        orgs: [],                 // GitHub orgs/users to fully scan — for NON-brand repos (frameworks, tooling); brand repos are always scanned via the brand configs
        excludeRepos: [],         // Repo names never fetched or mentioned
        excludeCommits: [],       // Regex patterns (case-insensitive) — matching commit messages never reach the digest
        excludeTopics: [],        // Topics the writer must never discuss
        includePrivate: true,     // Scan private repos too — exclude rules govern what gets WRITTEN, not what gets read
        postPath: 'devlog',       // Sub-folder under src/_posts/{year}/ in the website target
        destinations: ['website'], // website | devto | hashnode | medium (planned)
        overrides: {              // Ghostii API overrides
          length: 'long',
          research: false,        // The digest is the source — no web research
          insertImages: false,    // Local publisher doesn't mirror images into the repo (yet)
          headerImageUrl: 'disabled',
          maxLinks: 10,           // Backlinks are the point — allow more than Ghostii's default 6
        },
      },
    },
  },

  // Search Console (submitSitemap + sitemapPaths: schema defaults) needs no
  // manager-owned data. The domain property (sc-domain:) covers every
  // subdomain; DNS TXT verification writes through Cloudflare. Auth: the same
  // GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET as firebase/analytics (own token
  // cache — webmasters + siteverification scopes). omega-manager also carried
  // a `subdomains: []` key here that nothing ever read — dropped.

  // AdSense: deliberately NO defaults entry (wave-5 F10). The service gates on
  // the PRESENCE of `advertising.providers.adsense` in the merged
  // config — seeding it here would defeat that gate (defaults merge under
  // every brand), and the account-selection flow would land a shared account
  // into brands that never opted in. A brand (or the company layer) authors
  // the provider entry — even empty — to opt in; `client` (ca-pub-…) comes
  // from config or the interactive selection flow.

  // Marketing — TWO roles, one providers block each (#425). campaigns = email
  // marketing (the campaigns service); newsletter = the newsletter (the
  // newsletter service). The vendor is a KEY under `providers`; `enabled`
  // stays role-level, and so does `newsletter.content` (it configures
  // @omega.js/backend's generator, not Beehiiv). listId/publicationId are
  // resolved by the services and written back under their provider
  // (comment-preserving writeback), with a state mirror as the resolution
  // cache. Auth: SENDGRID_API_KEY / BEEHIIV_API_KEY in the brand .env
  // (+ OMEGA_WEBHOOK_KEY for the webhook operations).
  // omega-manager also carried a newsletter.content generator blob here —
  // it's @omega.js/backend newsletter-generator data, not service config; it rides the
  // config-hierarchy dispersal story.
  marketing: {
    campaigns: {
      providers: {
        sendgrid: {
          listId: null,
        },
      },
    },
    newsletter: {
      providers: {
        beehiiv: {
          publicationId: null,
        },
      },
    },
  },

  // Payment providers + products. Public halves live here (publishableKey,
  // clientId, site); secrets come from the brand .env (STRIPE_SECRET_KEY,
  // PAYPAL_CLIENT_SECRET, CHARGEBEE_API_KEY). Interactive runs offer the
  // key-collection flow when an enabled provider is missing credentials
  // (public keys land here, secrets in the .env). Set a provider to
  // `false` to disable it — the flow's Disable answer writes that.
  // Product IDs are written back here by the services (state keeps a mirror).
  // omega-manager's DEFAULTS also carried the company's Stripe organizationId
  // (dashboard deep-links use the account ID from state now) and hardcoded
  // the company CDN for product images (brand.images.brandmark now).
  payment: {
    enabled: true,
    providers: {
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
  forms: {
    providers: {
      slapform: {
        formId: null,
      },
    },
  },

  // Inbound conversations — one home per CHANNEL, provider-discriminated
  // inside it (#23).
  inbound: {
    // Chat: Chatsy support chat (chatsy.ai) — Chatsy-operator integration:
    // needs CHATSY_SERVICE_ACCOUNT in the brand .env (path to the Chatsy
    // Firebase project's service-account JSON). agentId comes from the Chatsy
    // dashboard (interactive runs offer the paste-back flow and land it here);
    // plan = the tier granted to the agent-owner account (Chatsy's top tier by
    // default — omega-manager resolved it from the chatsy brand's own config in
    // `.brands/`, a company-mode read). updateAgentInfo: false = the agent is
    // shared and managed by another brand. sponsorshipsUrl fills the baseline
    // knowledge's sponsorship line (omega-manager hardcoded the company page;
    // null → {website}/contact). The agent image comes from
    // brand.images.brandmark (omega-manager hardcoded the company CDN).
    // `settings` is the widget presentation block @omega.js/client passes to
    // the Chatsy SDK — same home as the provisioning fields, no second copy.
    chat: {
      providers: {
        chatsy: {
          agentId: null,
          sponsorshipsUrl: null,
        },
      },
    },

    // Email: Replyify customer-service email agent (replyify.app) —
    // Replyify-operator integration: needs REPLYIFY_SERVICE_ACCOUNT in the
    // brand .env (path to the Replyify Firebase project's service-account
    // JSON). agentId comes from the Replyify dashboard (interactive runs offer
    // the paste-back flow and land it here); plan = the tier granted to the
    // agent-owner account (Replyify's top tier by default — omega-manager
    // resolved it from the replyify brand's own config in `.brands/`, a
    // company-mode read). updateAgentInfo: false = the agent is shared and
    // managed by another brand. discount renders the baseline's discount
    // section only when set ({ code, label } — omega-manager hardcoded the
    // company's code for every brand); the company sponsorship block left the
    // packaged baseline entirely — that prose belongs in config/replyify.md.
    email: {
      providers: {
        replyify: {
          agentId: null,
          discount: null,
        },
      },
    },
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

  // Parent-project brand directory (#246) — pushes this brand's own entry
  // into the PARENT project's brands collection, so whatever the parent runs
  // on top of it (ITW's guest-post sponsorship marketplace is the first) reads
  // a current directory. Its opt-in switch (`directory.enabled`, off by
  // default because the entry is world-readable by design) is a schema
  // default; the service also needs `parent` to name the relationship and
  // DIRECTORY_SERVICE_ACCOUNT in the brand .env.

  // Derived visual collateral generated locally from the brand's logo
  // sources (assets/logo/*.svg in the brand repo → .omega/assets/):
  // wordmark/combomark from brand.font (omega-manager packaged the
  // company's commercial fonts and defaulted every brand to CromaSans —
  // the port has no packaged fonts, the brand owns its font choice), logo
  // variants + PNG ladders, app icons, social icons, favicons. Every
  // operation is mtime-diffed; no brandmark → the AI generation flow when
  // MrLogo credentials are in the brand .env (MRLOGO_SERVICE_ACCOUNT /
  // MRLOGO_API_KEY / LOGO_API_ID_TOKEN — zero config options), else a
  // clean skip.
  assets: {
    enabled: true,
  },

  // Apple signing certificates, bundle IDs, and provisioning profiles for
  // brands with desktop/mobile targets, reconciled via the App Store
  // Connect API. Credentials live in the brand .env (APPLE_API_ISSUER,
  // APPLE_API_KEY_ID, APPLE_TEAM_ID) plus an AuthKey_*.p8 placed in
  // .omega/certificates/apple/. bundleIdPrefix MUST be set by the brand
  // (reverse-DNS of the company/brand domain, e.g. 'com.mycompany' — the
  // onboard wizard derives + seeds it) — omega-manager hardcoded the
  // company prefix and kept one shared cert set in its company-instance
  // .output/_shared/; the port keeps everything brand-local.
  certificates: {
    enabled: true,
    providers: {
      apple: {
        // Full bundle ID = composeBundleId(prefix, brand.id) — the brand id's
        // dashes become dots (Android-safe segments), e.g.
        // com.itwcreativeworks + omega-playground → com.itwcreativeworks.omega.playground
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

  // Classic reCAPTCHA — the brand's OWN keys (de-ITW: never a company-shared
  // key), read from the brand .env (RECAPTCHA_SITE_KEY + RECAPTCHA_SECRET_KEY;
  // missing keys → the service asks interactively, else skips). `project` =
  // the brand's GCP project hosting the key, used only for the console
  // deep-link in guidance (omega-manager hardcoded the company project here).
  captcha: {
    providers: {
      recaptcha: {
        project: null,
      },
    },
  },

  // Cloudflare settings — the engine defaults are PLATFORM defaults only.
  // Company-specific records (DMARC report addresses, BIMI logo, SendGrid
  // domain-auth CNAMEs, verification TXTs, extra CSP hosts) belong in company/
  // brand config, NOT here — omega-manager hardcoded them; the port moved them
  // to config: dns.dmarcReports { rua, ruf }, dns.bimiLogo, dns.sendgrid
  // { id, whitelabel }, dns.records [...], and the responseHeaders rules.
  edge: {
    providers: {
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
        // Any brand can override with `edge.providers.cloudflare.settings.{setting_id}`.
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
    },
  },
};

// The manager's defaults layer: the schema's own answers first, this file's
// service-owned data on top (#478). Every existing read site — the walk's
// loadConfig defaults, `DEFAULTS.account.admins`, the zone-settings diff —
// sees one composed object, and no default has two homes.
const DEFAULTS = deepMerge(schemaDefaults(), MANAGER_DEFAULTS);

// =============================================================================
// SERVICE ORDER - Services run in this order due to dependencies
// =============================================================================
const SERVICE_ORDER = [
  'workspace',       // brand monorepo structure + config health — everything depends on a sane workspace
  'repo',            // the brand repo must exist before services that write to it
  'edge',            // zone must exist before DNS-dependent services
  'domain',          // registrar nameservers point at the zone the edge service just created/verified
  'cloud',           // cloud project (Firebase provider) must exist before analytics/backend-dependent services
  'captcha',         // validates the shared keys the frontend/backend consume from .env
  'analytics',       // GA4 streams need the firebase link; search links to analytics next
  'search',          // needs the edge zone (DNS verification) + the GA property (association)
  'advertising',     // domain present in the AdSense account + approval state (read-only API)
  'monitoring',      // error-monitoring project per target + DSN writeback (Sentry provider; own API, no cross-service deps)
  'campaigns',       // email marketing (SendGrid provider): domain auth (DNS via the edge zone), sender, list, unsubscribe groups, fields, segments, webhook
  'newsletter',      // newsletter publication (Beehiiv provider): access, fields, segments (verify-only), webhook
  'payment',         // Stripe/PayPal/Chargebee products + prices + webhooks reconciled to payment.products
  'forms',           // brand's Slapform contact form settings + owner-account plan (Slapform operator only)
  'chat',            // brand's Chatsy chat agent settings + knowledge + owner-account plan (Chatsy operator only)
  'email',           // brand's Replyify email agent filter + knowledge + owner-account plan (Replyify operator only)
  'server',          // brand registry entry on the company server's Firestore (company-server operators only)
  'directory',       // brand's own entry pushed into the PARENT project's brands collection (opt-in; no cross-service deps)
  'assets',          // derived logo variants, app icons, social icons, favicons (local, mtime-diffed)
  'certificates',    // Apple certs, bundle IDs, provisioning profiles (desktop/mobile targets only)
  'ai',              // AI provider keys asked into the brand .env — the ONE file every target's runtime env composes from
  'disperse',        // signing artifacts land in the targets (after certificates, before update builds)
  'seo',             // parasite SEO GitHub repos — low priority, no downstream deps
  'update',          // installs deps + builds every target
  'account',         // required Firebase Auth accounts + admin roles (after deploy — signup calls hit the live backend)
  'migrations',      // Firestore data migrations — only with --migration (audit unless --execute), after the deployed backend is current
  'bookmark',        // brand bookmarks → the companion Chrome extension (interactive sessions only)
  'testing',         // health checks after everything else ran
];

// The BOOT lane (#228) — what the dev legs consume every boot: local
// redistribution only (file work, no network, no rebuilds), so `omega dev`
// starts in about a second instead of waiting on the cloud services.
// NOT in this list = manage lane by construction: a new service can never
// slow the boot by default, and promoting one is a deliberate edit here.
// It is the DELIVERY lane too (#678): brand-root `omega deploy` runs this
// same list before it fans out, so a publish never ships inputs a manage run
// happened to be current on. One constant, two triggers.
const BOOT_SERVICES = [
  'workspace',       // brand structure + config health — a broken brand must not serve
  'assets',          // derived logo/icon variants the targets read from their own dirs
  'disperse',        // signing artifacts land in the targets
];

// =============================================================================
// OPERATIONS CONFIG - What operations to run for each service
// =============================================================================
const OPERATIONS = {
  workspace: [
    { name: 'structure', ensure: true },  // Root workspaces + a dir per enabled target
    { name: 'config', ensure: true },     // omega.json5 loads + validates (brand and per-target)
    { name: 'defaults', ensure: true },   // Schema-defaulted blocks the brand file lacks are materialized (#478)
    { name: 'gitignore', ensure: true },  // .omega/ is gitignored (state never gets committed)
    { name: 'scripts', ensure: true },    // Root scripts say `omega` + deploy exists; target scripts fill from framework projectScripts (#675)
    { name: 'agents', ensure: true },     // AGENTS.md framework-guide import + CLAUDE.md pointer
    { name: 'claude-settings', ensure: true }, // .claude/settings.json enables the omega plugin from the installed manager (published installs)
    { name: 'workflows', ensure: true },  // Composed .github/workflows/<target>-*.yml for targets the config no longer enables are removed (#636)
    { name: 'env-keys', ensure: true },   // Brand-generated keys (the OMEGA_* trio + UNSUBSCRIBE_HMAC_KEY) minted into the brand .env when the cascade has none (#569)
    { name: 'env-order', ensure: true },  // Brand/company .env in the canonical group order (cp137)
    { name: 'env-rules', ensure: true },  // Keys the brand's own config makes mandatory (the schema's requiredWhen) — WARNS, never fails (#626)
    { name: 'translation-sdk', ensure: true }, // Translating web targets declare + install @anthropic-ai/claude-agent-sdk (#168)
  ],

  repo: [
    { name: 'org', ensure: true },        // Org profile matches the brand (skipped for shared orgs)
    { name: 'repo', ensure: true },       // The brand-monorepo repo exists with the right settings
    { name: 'pages', ensure: true },      // GitHub Pages on gh-pages + custom domain (web target)
  ],

  edge: [
    { name: 'zone', ensure: true },                     // Zone exists (created when missing; nameservers reported when pending)
    { name: 'dns-records', ensure: true },              // Required + custom records diff-synced
    { name: 'email-routing', ensure: true },            // Cloudflare Email Routing (only when domain.email.providers names cloudflare)
    { name: 'zone-settings', ensure: true },            // Generic — diffs all /zones/{id}/settings values + addons
    { name: 'cache-rules', ensure: true },
    { name: 'rules-managed-transforms', ensure: true },
    { name: 'rules-redirect', ensure: true },
    { name: 'rules-configuration', ensure: true },
    { name: 'rules-response-headers', ensure: true },
    { name: 'rules-security', ensure: true },
    { name: 'speed-scheduled-tests', ensure: true },    // Custom Speed API endpoint
    { name: 'workers', ensure: true },                  // Worker scripts + routes (only when edge.providers.cloudflare.workers configured)
  ],

  domain: [
    { name: 'nameservers', ensure: true }, // Registrar nameservers → Cloudflare (namecheap via API, manual registrars get instructions)
  ],

  cloud: [
    { name: 'billing', ensure: true },          // Blaze plan (links cloud.billingAccount when configured)
    { name: 'services', ensure: true },         // Required Google Cloud APIs + compute deploy roles
    { name: 'project-settings', ensure: true }, // GCP display name + the 'Web App' web app
    { name: 'oauth-consent', ensure: true },    // OAuth consent screen (support email)
    { name: 'service-account', ensure: true },  // Admin SDK service account + key → .omega/secrets (the ONE home; omega build stages it)
    { name: 'hosting', ensure: true },          // Hosting site + api.{domain} custom domains (DNS via Cloudflare)
    { name: 'firestore', ensure: true },        // Firestore database + PITR
    { name: 'database', ensure: true },         // Realtime Database
    { name: 'authentication', ensure: true },   // Identity Platform + sign-in methods + authorized domains
    { name: 'storage', ensure: true },          // Default storage bucket
    { name: 'functions', ensure: true },        // Cloud Functions readiness check (read-only)
    { name: 'cloud-messaging', ensure: true },  // FCM API + VAPID key pair (from state)
    { name: 'sdk-config', ensure: true },       // Web SDK config → state + omega.json5 drift check
  ],

  captcha: [
    { name: 'site-key', ensure: true }, // Secret key proven valid via siteverify; domain list is manual guidance (no classic API)
  ],

  analytics: [
    { name: 'google-streams', ensure: true },       // One GA4 web stream per target (+ enhanced measurement + MP secret + the per-target measurement id in config)
    { name: 'google-firebase-link', ensure: true }, // GA property ↔ Firebase project link (+ auto-stream normalization)
    { name: 'meta-pixel', ensure: true },           // Pixel created on meta.accountId when missing + META_ACCESS_TOKEN presence
    { name: 'tiktok-pixel', ensure: true },         // Pixel created on tiktok.accountId when missing + TIKTOK_ACCESS_TOKEN presence
  ],

  search: [
    { name: 'property', ensure: true }, // sc-domain property exists (DNS TXT verification via Cloudflare, one-pass)
    { name: 'ga-link', ensure: true },  // GA association — no API exists; warned + URL until confirmed
    { name: 'sitemaps', ensure: true }, // Missing sitemaps submitted (existing ones are converged, not resubmitted)
  ],

  advertising: [
    { name: 'sites', ensure: true }, // Domain present in AdSense + approval state (read-only API — adding is manual)
  ],

  monitoring: [
    { name: 'projects', ensure: true }, // Org/team resolution + one Sentry project per enabled target (monitoring.providers.sentry.org written back)
    { name: 'dsn', ensure: true },      // Client-key DSNs → targets.<type>.monitoring.providers.sentry.dsn (comment-preserving writeback)
  ],

  campaigns: [
    { name: 'domain-auth', ensure: true },     // Domain authentication (DKIM CNAMEs via Cloudflare, one-pass validate)
    { name: 'sender-identity', ensure: true }, // Verified sender for Single Sends (offers@{contact domain})
    { name: 'list', ensure: true },            // The brand's marketing list (id written back to omega.json5)
    { name: 'unsubscribe-groups', ensure: true }, // The account's ASM groups, matched by name (ids written back to omega.json5)
    { name: 'custom-fields', ensure: true },   // @omega.js/backend custom fields (@omega.js/backend's marketing SSOT)
    { name: 'segments', ensure: true },        // @omega.js/backend segments (query_dsl diffed; __temp_ orphans swept)
    { name: 'event-webhook', ensure: true },   // Account-global Event Webhook → parent @omega.js/backend forwarder (min-diff PATCH)
  ],

  newsletter: [
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

  forms: [
    { name: 'form', ensure: true }, // Form name + enabled diffed against Slapform Firestore
    { name: 'user', ensure: true }, // Form-owner account set to forms.providers.slapform.plan (internal comp)
  ],

  chat: [
    { name: 'chat', ensure: true }, // Agent settings + knowledge diffed against Chatsy Firestore
    { name: 'user', ensure: true }, // Agent-owner account set to inbound.chat.providers.chatsy.plan (internal comp)
  ],

  email: [
    { name: 'agent', ensure: true }, // Agent filter + knowledge diffed against Replyify Firestore
    { name: 'user', ensure: true },  // Agent-owner account set to inbound.email.providers.replyify.plan (internal comp)
  ],

  server: [
    { name: 'brands', ensure: true }, // Registry entry replace-synced against the company server's Firestore
  ],

  directory: [
    { name: 'entry', ensure: true }, // Directory entry (identity + declared blocks) merge-synced into the parent project's brands collection
  ],

  assets: [
    { name: 'logo-gen', ensure: true },     // Wordmark + combomark from brandmark + brand.font (missing-only)
    { name: 'process', write: true },       // Color/black SVG variants + PNG size ladders per logo source
    { name: 'templates', write: true },     // Brand PSDs seeded from the company + logo/text layers refreshed + PNG exports
    { name: 'icons', write: true },         // macOS .icns + Windows .ico app icons (composited icon.png when the templates op made one)
    { name: 'social-icons', write: true },  // Brandmark-on-white social profile icons
    { name: 'favicons', write: true },      // Web favicon set + site.webmanifest
    { name: 'reconcile', write: true },     // Derived files the brand's current sources no longer name are deleted (#636)
  ],

  certificates: [
    { name: 'api-key', ensure: true },      // App Store Connect creds resolved + client ready
    { name: 'certificates', ensure: true }, // Signing certs — download or create via CSR, export .p12, keychain import
    { name: 'bundle-ids', ensure: true },   // Brand bundle ID exists with the required capabilities
    { name: 'profiles', ensure: true },     // Provisioning profiles per platform × cert type
  ],

  ai: [
    { name: 'keys', ensure: true },  // The provider API keys, asked once through the shared setup contract (#639)
  ],

  disperse: [
    { name: 'certs', write: true },  // Signing artifacts copied into desktop/mobile targets' certs dirs
  ],

  seo: [
    { name: 'github-repos', ensure: true }, // Parasite SEO repos exist + match their template
  ],

  update: [
    { name: 'targets', write: true },     // Installs deps, builds every target
  ],

  account: [
    { name: 'users', ensure: true },      // Auth accounts exist + passwords/admin roles converged + admin audit
  ],

  migrations: [
    { name: 'targets-rename', ensure: true, local: true }, // #443: the brand's apps/ → targets/, workspaces glob following (runs ALONE — see manage.js)
    { name: 'notifications', ensure: true }, // uid→owner + metadata/context/attribution + validate schema
    { name: 'users', ensure: true },         // plan→subscription + @omega.js/backend-schema backfill + orphan cleanup + validate
    { name: 'orders', ensure: true },        // payments-orders: legacy attribution.utm blob → first/last touches
    { name: 'payments-intents', ensure: true }, // payments-intents: legacy attribution.utm blob → first/last touches
    { name: 'payment-provider', ensure: true }, // #428 word rename: the stored `processor` field → `provider`, across all five payment collections
    { name: 'state-retirement', ensure: true, local: true }, // #434: the retired .omega/state.json content → config/omega.json5 + .env; the file's machine records stay (#479)
  ],

  bookmark: [
    { name: 'sync', ensure: true },       // Push brand console/dashboard bookmarks to the companion Chrome extension
  ],

  testing: [
    { name: 'target-checks', ensure: true }, // Per-target local checks (build output, backend files, framework version) + live checks (homepage, API health, GitHub Actions)
  ],
};

// =============================================================================
// REQUIRES - Per-service inputs (env var names + Google scopes)
// =============================================================================
// The declarative half of the setup contract (#608, cp114 before it): every
// service that needs a credential or a one-time authorization declares it
// HERE, next to its operations — ONE home, read by both halves:
//   - lib/preflight.js checks the whole enabled set before any service runs and
//     prints one consolidated fix walkthrough (cp236's 403-diagnostics tone)
//     instead of N mid-run skips;
//   - lib/service-input.js asks for what is still missing when the service
//     actually runs, through the uniform Provide / Skip / Disable gate.
// Every env NAME therefore lives exactly once. WHICH keys OMEGA mints for
// itself and which a human acquires is the env schema's to say
// (@omega.js/config, #581) — the sweep test (test/service-input.test.js) holds
// this registry to it: every acquired key the manager actually reads must be
// declared here.
//
// Shape per service — requires: { env, scopes } plus the gates around them:
//   why    - one line: what the requirement buys (the walkthrough's "needed")
//   label  - the human name the setup gate opens with ("Cloudflare")
//   disablePath - where "Disable permanently" writes `false` (the tri-state
//            opt-out, #33). Mirrors the key the service's own setup gate reads.
//   when   - (brandConfig) => bool: whether the service would run at all for
//            this brand. Mirrors ONLY the service setup's own config gate —
//            keep the two in lockstep. Absent = always applies.
//   env    - [{ name, label?, url?, hint?, prompted?, when?, gates?, disablePath? }]
//            — the descriptor shape lib/service-input.js takes. prompted: true =
//            an interactive run collects the value mid-run (the paste flow), so
//            preflight lets the service run on a TTY. Entry-level `when` = the
//            entry only applies for some configs (registrar-specific creds).
//            `gates: false` = OPTIONAL input: the service runs without it (a
//            second payment provider, an operator-tier service account, one of
//            two pixel platforms), so preflight never gates on it and the
//            operation that needs it asks in place. Entry-level `disablePath`
//            narrows the opt-out to the provider that owns the key.
//            Values are NEVER read here — names only.
//   scopes - the Google OAuth scopes this service's API calls actually hit
//            (each a member of google-auth's GOOGLE_SCOPES union — every
//            consent grants the union, so these only ever miss against a
//            pre-union or stale token store). Checked against the token
//            store's granted-scopes record — what IS knowable before a
//            call; the live grant is proven at call time (the google-auth
//            403 diagnostics are the backstop).
// Services NOT listed need no credential of their own (repo authorizes through
// `gh auth login`; the local services touch nothing external).

// The shared Google OAuth app credentials — the ONE identity every Google
// service authorizes (google-auth.js). Declared once, referenced per service.
const GOOGLE_ENV = [
  { name: 'GOOGLE_CLIENT_ID', label: 'Google OAuth client ID', url: 'https://console.cloud.google.com/apis/credentials', hint: 'A Desktop-app OAuth client — the one Google identity every service shares' },
  { name: 'GOOGLE_CLIENT_SECRET', label: 'Google OAuth client secret', url: 'https://console.cloud.google.com/apis/credentials' },
];

// The key every webhook route compares — OMEGA's OWN (`generated:` in the env
// schema), so the setup contract MINTS it rather than asking (#635). Declared
// by each service whose webhook operations build a forwarder URL from it, so
// one that runs before the workspace service did still has it. `gates: false`:
// nothing to acquire means nothing for preflight to gate on.
const WEBHOOK_KEY_ENV = { name: 'OMEGA_WEBHOOK_KEY', label: 'Omega webhook key', gates: false };

const REQUIRES = {
  edge: {
    why: 'reconciles the zone, DNS records, rulesets, and settings via the Cloudflare API',
    label: 'Cloudflare',
    disablePath: 'edge.providers.cloudflare.enabled',
    when: (config) => config.edge?.providers?.cloudflare?.enabled !== false,
    env: [
      { name: 'CLOUDFLARE_TOKEN', label: 'Cloudflare API token', url: 'https://dash.cloudflare.com/profile/api-tokens', prompted: true },
    ],
    scopes: [],
  },

  domain: {
    why: 'points the registrar nameservers at the Cloudflare zone',
    label: 'Domain registrar',
    disablePath: 'domain.enabled',
    when: (config) => config.domain?.enabled !== false && Boolean(resolveRegistrar(config)),
    env: [
      { name: 'CLOUDFLARE_TOKEN', label: 'Cloudflare API token (reads the zone nameservers)', url: 'https://dash.cloudflare.com/profile/api-tokens', prompted: true },
      { name: 'NAMECHEAP_USERNAME', label: 'Namecheap account username', prompted: true, when: (config) => resolveRegistrar(config) === 'namecheap' },
      { name: 'NAMECHEAP_API_KEY', label: 'Namecheap API key', url: 'https://ap.www.namecheap.com/settings/tools/apiaccess/', prompted: true, when: (config) => resolveRegistrar(config) === 'namecheap' },
    ],
    scopes: [],
  },

  cloud: {
    why: 'reconciles the Firebase/GCP project (billing, APIs, hosting, auth, data stores) via Google APIs',
    label: 'Google Cloud',
    disablePath: 'cloud.enabled',
    when: (config) => {
      if (config.cloud?.enabled === false) return false;
      // No projectId yet → the interactive selection flow is the fix, not a
      // secret; demo-* projects have no real cloud to reconcile. ONE home
      // (#23): cloud.config.projectId, never a second key.
      const projectId = config.cloud?.config?.projectId;
      return Boolean(projectId) && !isDemoProject(projectId);
    },
    env: GOOGLE_ENV,
    scopes: [
      'https://www.googleapis.com/auth/firebase',
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/cloud-billing',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  },

  captcha: {
    why: "proves the brand's own classic reCAPTCHA keys are valid (siteverify)",
    label: 'reCAPTCHA',
    disablePath: 'captcha.providers.recaptcha.enabled',
    when: (config) => config.captcha?.providers?.recaptcha?.enabled !== false,
    env: [
      // De-ITW (Ian 2026-07-21): the key is the brand's OWN, minted in the
      // brand's own GCP project — the walkthrough points at the GCP reCAPTCHA
      // console, never a company-shared key
      { name: 'RECAPTCHA_SITE_KEY', label: "reCAPTCHA site key (the brand's own key)", url: 'https://console.cloud.google.com/security/recaptcha', hint: "Create a classic key in the brand's OWN GCP project — never a shared company key", prompted: true },
      { name: 'RECAPTCHA_SECRET_KEY', label: 'reCAPTCHA secret key', url: 'https://console.cloud.google.com/security/recaptcha', prompted: true },
    ],
    scopes: [],
  },

  analytics: {
    why: 'reconciles GA4 streams and the Firebase link via the GA Admin API',
    label: 'Google Analytics',
    disablePath: 'analytics.enabled',
    when: (config) => config.analytics?.enabled !== false && Boolean(config.analytics?.providers?.google?.propertyId),
    // The pixel platforms are OPTIONAL beside GA4 (`gates: false`): a brand may
    // run one, both, or neither, and their absence must never gate the GA4 half
    // — the pixel operations ask for them in place (services/analytics/lib/
    // pixel-token.js), each disabling only its own provider.
    env: [
      ...GOOGLE_ENV,
      {
        name: 'META_ACCESS_TOKEN',
        label: 'Meta Pixel access token',
        url: 'https://business.facebook.com/settings/system-users',
        hint: 'A Business Manager SYSTEM USER token with ads_management — it creates the pixel and signs the conversions',
        prompted: true,
        gates: false,
        disablePath: 'analytics.providers.meta',
        when: (config) => config.analytics?.providers?.meta !== false,
      },
      {
        name: 'TIKTOK_ACCESS_TOKEN',
        label: 'TikTok Events API access token',
        hint: 'Minted by the portal authorization the setup walks (#448) — the app secret is only needed at mint time',
        prompted: true,
        gates: false,
        disablePath: 'analytics.providers.tiktok',
        when: (config) => config.analytics?.providers?.tiktok !== false,
      },
    ],
    scopes: ['https://www.googleapis.com/auth/analytics.edit'],
  },

  search: {
    why: 'creates/verifies the sc-domain property and submits sitemaps via the Search Console API',
    label: 'Search Console',
    disablePath: 'search.providers.searchConsole.enabled',
    when: (config) => config.search?.providers?.searchConsole?.enabled !== false,
    env: GOOGLE_ENV,
    scopes: [
      'https://www.googleapis.com/auth/webmasters',
      'https://www.googleapis.com/auth/siteverification',
    ],
  },

  advertising: {
    why: 'verifies the domain is present + approved in the AdSense account (read-only API)',
    label: 'AdSense',
    // Disable must NOT land `client: false` — client is schema-typed as a
    // string. It opts the PROVIDER out instead, and since #527 there is no
    // second `enabled` switch to land it on.
    disablePath: 'advertising.providers.adsense',
    // The client id is the ONE adsense switch (#527) — no second gate.
    when: (config) => Boolean(config.advertising?.providers?.adsense?.client),
    env: GOOGLE_ENV,
    scopes: ['https://www.googleapis.com/auth/adsense.readonly'],
  },

  monitoring: {
    why: 'creates one Sentry project per enabled target and lands the DSNs',
    label: 'Sentry',
    disablePath: 'monitoring.enabled',
    when: (config) => config.monitoring?.enabled !== false
      && chosenProvider(config.monitoring?.providers) === 'sentry',
    env: [
      {
        name: 'SENTRY_AUTH_TOKEN',
        label: 'Sentry personal auth token',
        url: 'https://sentry.io/settings/account/api/auth-tokens/',
        hint: 'Create a personal token with scopes: org:read, project:read, project:write, team:read, team:write — organization tokens cannot create projects',
        prompted: true,
      },
    ],
    scopes: [],
  },

  campaigns: {
    why: 'reconciles domain auth, the sender, the list, unsubscribe groups, fields, segments, and the event webhook via the SendGrid API',
    label: 'SendGrid',
    disablePath: 'marketing.campaigns.enabled',
    when: (config) => config.marketing?.campaigns?.enabled !== false
      && chosenProvider(config.marketing?.campaigns?.providers) === 'sendgrid',
    env: [
      { name: 'SENDGRID_API_KEY', label: 'SendGrid API key', url: 'https://app.sendgrid.com/settings/api_keys', prompted: true },
      WEBHOOK_KEY_ENV,
    ],
    scopes: [],
  },

  newsletter: {
    why: 'verifies publication access, fields, segments, and the webhook via the Beehiiv API',
    label: 'Beehiiv',
    disablePath: 'marketing.newsletter.enabled',
    when: (config) => config.marketing?.newsletter?.enabled !== false
      && chosenProvider(config.marketing?.newsletter?.providers) === 'beehiiv',
    env: [
      { name: 'BEEHIIV_API_KEY', label: 'Beehiiv API key', url: 'https://app.beehiiv.com/settings/workspace/api', prompted: true },
      WEBHOOK_KEY_ENV,
    ],
    scopes: [],
  },

  certificates: {
    why: 'reconciles Apple signing certs, bundle IDs, and provisioning profiles via App Store Connect',
    label: 'Apple signing',
    disablePath: 'certificates.enabled',
    when: (config) => config.certificates?.enabled !== false
      && Boolean(config.targets?.desktop || config.targets?.mobile),
    env: [
      { name: 'APPLE_API_ISSUER', label: 'App Store Connect issuer ID', url: 'https://appstoreconnect.apple.com/access/api', prompted: true },
      { name: 'APPLE_API_KEY_ID', label: 'App Store Connect API key ID', url: 'https://appstoreconnect.apple.com/access/api', prompted: true },
      { name: 'APPLE_TEAM_ID', label: 'Apple Developer team ID', prompted: true },
    ],
    scopes: [],
  },

  // Per-provider credentials, every one OPTIONAL (`gates: false`): the payment
  // service runs on whichever provider IS configured, so a missing Stripe key
  // must never gate a PayPal brand. Each entry disables only its own provider.
  payment: {
    why: 'reconciles products, prices, and webhooks on the brand payment providers',
    label: 'Payments',
    disablePath: 'payment.enabled',
    when: (config) => config.payment?.enabled !== false,
    env: [
      {
        name: 'STRIPE_SECRET_KEY',
        label: 'Stripe secret key',
        url: 'https://dashboard.stripe.com/apikeys',
        hint: 'Developers → API keys, on the BRAND\'s Stripe account (sk_live_… or sk_test_…)',
        prompted: true,
        gates: false,
        disablePath: 'payment.providers.stripe',
        when: (config) => config.payment?.providers?.stripe !== false,
      },
      {
        name: 'PAYPAL_CLIENT_SECRET',
        label: 'PayPal client secret',
        url: 'https://developer.paypal.com/dashboard/applications',
        hint: 'The secret half of the brand\'s REST API app (its client id is public and lives in omega.json5)',
        prompted: true,
        gates: false,
        disablePath: 'payment.providers.paypal',
        when: (config) => config.payment?.providers?.paypal !== false,
      },
      {
        name: 'CHARGEBEE_API_KEY',
        label: 'Chargebee API key',
        url: 'https://app.chargebee.com/',
        hint: 'Settings → API keys, on the brand\'s Chargebee site (the site name is public and lives in omega.json5)',
        prompted: true,
        gates: false,
        disablePath: 'payment.providers.chargebee',
        when: (config) => config.payment?.providers?.chargebee !== false,
      },
      WEBHOOK_KEY_ENV,
    ],
    scopes: [],
  },

  // Operator-tier credentials (`gates: false`): the product lives in ITS OWN
  // Firebase project, so only that product's operator holds the service
  // account. Every other brand's clean skip is the sanctioned outcome, which
  // is why these never gate a run — the service asks the operator in place.
  forms: {
    why: "manages the brand's Slapform contact form and its owner account (Slapform operator only)",
    label: 'Slapform operator access',
    disablePath: 'forms.providers.slapform.enabled',
    when: (config) => config.forms?.providers?.slapform !== false
      && config.forms?.providers?.slapform?.enabled !== false,
    env: [
      { name: 'SLAPFORM_SERVICE_ACCOUNT', label: "Slapform's service-account JSON path", hint: 'Absolute, or relative to the brand root', prompted: true, gates: false },
    ],
    scopes: [],
  },

  chat: {
    why: "manages the brand's Chatsy agent, knowledge, and owner account (Chatsy operator only)",
    label: 'Chatsy operator access',
    disablePath: 'inbound.chat.providers.chatsy.enabled',
    when: (config) => config.inbound?.chat?.providers?.chatsy !== false
      && config.inbound?.chat?.providers?.chatsy?.enabled !== false,
    env: [
      { name: 'CHATSY_SERVICE_ACCOUNT', label: "Chatsy's service-account JSON path", hint: 'Absolute, or relative to the brand root', prompted: true, gates: false },
    ],
    scopes: [],
  },

  email: {
    why: "manages the brand's Replyify agent, filter, and owner account (Replyify operator only)",
    label: 'Replyify operator access',
    disablePath: 'inbound.email.providers.replyify.enabled',
    when: (config) => config.inbound?.email?.providers?.replyify !== false
      && config.inbound?.email?.providers?.replyify?.enabled !== false,
    env: [
      { name: 'REPLYIFY_SERVICE_ACCOUNT', label: "Replyify's service-account JSON path", hint: 'Absolute, or relative to the brand root', prompted: true, gates: false },
    ],
    scopes: [],
  },

  // ONE key per provider (#639): the OMEGA_-prefixed twins are gone, so the
  // bare name is the only home and a company-wide key is simply the COMPANY
  // layer of the .env cascade. Both are OPTIONAL (`gates: false`) — a brand
  // that calls neither provider must never be gated on a key it will not use,
  // and the ai service asks for them in place.
  ai: {
    why: 'lets the backend call OpenAI/Anthropic (contact inference, content + newsletter generation)',
    label: 'AI providers',
    disablePath: 'ai.enabled',
    when: (config) => config.ai?.enabled !== false,
    env: [
      {
        name: 'OPENAI_API_KEY',
        label: 'OpenAI API key',
        url: 'https://platform.openai.com/api-keys',
        hint: 'A secret key on the account that should be billed for the brand\'s OpenAI calls',
        prompted: true,
        gates: false,
      },
      {
        name: 'ANTHROPIC_API_KEY',
        label: 'Anthropic API key',
        url: 'https://console.anthropic.com/settings/keys',
        hint: 'A workspace API key — the Claude Code subscription login is a separate thing and needs no key',
        prompted: true,
        gates: false,
      },
    ],
    scopes: [],
  },

  server: {
    why: "keeps the brand's registry entry on the company server's Firestore (company-server operators only)",
    label: 'Company server access',
    disablePath: 'server.enabled',
    when: (config) => config.server !== false && config.server?.enabled !== false,
    env: [
      { name: 'SERVER_SERVICE_ACCOUNT', label: "the company server's service-account JSON path", hint: 'Absolute, or relative to the brand root', prompted: true, gates: false },
    ],
    scopes: [],
  },
};

/**
 * Build the setup-contract spec for a service (#608) — what
 * lib/service-input.js asks for. The registry is the SSOT; this is its
 * accessor, so no call site re-spells an env name, a mint URL, or an opt-out
 * path.
 *
 * @param {string} service - Service name (a REQUIRES key).
 * @param {object} [options]
 * @param {string[]} [options.names] - Narrow to these input names (a
 *   per-provider ask: just the Stripe key, just the Meta token).
 * @param {string} [options.label] - Override the gate's human name (the
 *   PROVIDER's name, when the ask is per-provider).
 * @param {string} [options.disablePath] - Override where Disable lands `false`
 *   (defaults to the narrowed entry's own path, then the service's).
 * @param {string[]} [options.instructions] - Guidance lines shown before the gate.
 * @param {boolean} [options.gate] - false = the caller already ran the gate.
 * @returns {object} The spec requestServiceInput takes.
 */
function serviceInputSpec(service, options = {}) {
  const declaration = REQUIRES[service];
  if (!declaration) {
    throw new Error(`No REQUIRES entry for service "${service}" — declare its inputs in src/config.js`);
  }

  const inputs = options.names
    ? declaration.env.filter((entry) => options.names.includes(entry.name))
    : declaration.env;

  // A single narrowed input carrying its own opt-out path owns the gate: the
  // ask is about THAT provider, so Disable must not switch off the service.
  const ownPath = inputs.length === 1 ? inputs[0].disablePath : null;

  return {
    service,
    label: options.label || declaration.label,
    disablePath: options.disablePath || ownPath || declaration.disablePath,
    instructions: options.instructions,
    ...(options.gate === false ? { gate: false } : {}),
    inputs,
  };
}

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
  DIR_TARGETS,
  TARGET_DIRS,
  TARGET_FRAMEWORKS,
  DEFAULTS,
  SERVICE_ORDER,
  BOOT_SERVICES,
  OPERATIONS,
  REQUIRES,
  serviceInputSpec,
  templateObject,
};
