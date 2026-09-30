/**
 * Schema rules for `edge`: the Cloudflare switch and zone id, then the engine
 * data the manager's edge service reconciles a zone to (mail-auth DNS, zone
 * settings, the speed test, cache rules, the ruleset phases). Each engine
 * default is a PLATFORM default, resolved but never written into a brand file
 * (`materialize: false`), so a company or brand override, arrays replacing
 * whole, still wins. Company records (DMARC report addresses, BIMI logo,
 * verification TXTs, extra CSP hosts) are config, never a default here.
 */

const EDGE_RULES = [
  {
    path:        'edge.providers.cloudflare.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'false = the edge service skips entirely: no zone, DNS, settings, rules, speed-test or worker reconciliation for this brand.',
  },
  {
    path:        'edge.providers.cloudflare',
    type:        'object', open: true,
    required:    false,
    description: 'Cloudflare zone reconciliation (@omega.js/manager cloudflare service): dns, settings, rules, cacheRules, speedTest, workers. Tokens live in .env.',
  },
  {
    path:        'edge.providers.cloudflare.zone',
    type:        'string',
    required:    false,
    description: "Cloudflare zone id. The web build's cache purge (`omega purge`) targets it; unset = purge skips.",
  },
  {
    path:        'edge.providers.cloudflare.dns',
    type:        'object',
    required:    false,
    default:     {
      spf: 'strict',          // 'strict' (-all) | 'soft' (~all)
      dmarcPolicy: 'quarantine', // 'none' | 'quarantine' | 'reject'
      spfIncludes: ['_spf.google.com', 'sendgrid.net'], // provider include appended automatically
    },
    materialize: false,
    description: "The zone's mail-auth DNS: `spf` ('strict' for -all, 'soft' for ~all), `dmarcPolicy` ('none', 'quarantine', 'reject') and `spfIncludes` (the mailbox provider's include is appended automatically), beside the brand's own `dmarcReports` { rua, ruf }, `bimiLogo` and `records` [...]. The SendGrid domain-auth CNAMEs are never config: the edge service reads them live from SendGrid each run.",
  },
  {
    path:        'edge.providers.cloudflare.settings',
    type:        'object',
    required:    false,
    default:     {
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
      email_obfuscation: 'off',   // Injects cloudflare-static/email-decode.min.js, which breaks clean HTML
      server_side_exclude: 'on',
      hotlink_protection: 'off',  // Breaks legit embeds (Slack unfurls, etc.)

      // Speed
      brotli: 'on',
      early_hints: 'on',
      rocket_loader: 'off',       // Rewrites <script> tags, which breaks modern frameworks
      speed_brain: 'on',          // Speculation Rules API: an addon setting (not in the bulk endpoint)
      fonts: 'on',                // Cloudflare Fonts: an addon setting (not in the bulk endpoint)

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
      edge_cache_ttl: 7200,       // 2 hours, applied only without cache rules

      // Security
      security_level: 'low',
      browser_check: 'on',
      challenge_ttl: 1800,
      privacy_pass: 'on',
      waf: 'off',                 // Legacy WAF: Cloudflare replaced it with rulesets
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
    materialize: false,
    description: "Zone settings as a flat map keyed by the Cloudflare API setting id, bulk and addon (speed_brain, fonts) alike. The edge service's `zone-settings` operation diffs every key in one pass; a brand overrides any one with `edge.providers.cloudflare.settings.<setting_id>`.",
  },
  {
    path:        'edge.providers.cloudflare.speedTest',
    type:        'object',
    required:    false,
    default:     { frequency: 'WEEKLY', region: 'us-central1' },
    materialize: false,
    description: "The zone's scheduled speed test ({ frequency, region }), reconciled by its own operation.",
  },
  {
    path:        'edge.providers.cloudflare.cacheRules',
    type:        'array',
    required:    false,
    default:     [
      {
        name: 'Assets: Cache for 1 Year',
        expression: '(http.request.uri.path wildcard r"/assets/*") or (http.request.uri.path eq "/__/auth/iframe.js")',
        edgeTtl: 31536000,
        browserTtl: 31536000,
        enabled: true,
        priority: 100,
      },
      {
        name: 'HTML: Short Browser Cache',
        // Excludes api.<domain> (user-scoped extensionless GETs one user's answer
        // must never serve the next) and emailurl.<domain> (SendGrid tracking);
        // `not … contains "."` is the free-plan "no file extension" (`matches`
        // needs Business).
        expression: '(not starts_with(http.host, "api.") and not starts_with(http.host, "emailurl.") and not starts_with(http.request.uri.path, "/assets/") and (not (http.request.uri.path contains ".") or ends_with(http.request.uri.path, ".html")))',
        // The edge copy is what a deploy purges; only the browser copy,
        // which no purge can reach, has to expire on its own.
        edgeTtl: 7200,
        browserTtl: 60,
        enabled: true,
        priority: 200,
      },
    ],
    materialize: false,
    description: "The zone's cache rules ([{ name, expression, edgeTtl, browserTtl, enabled, priority }]). The web build content-hashes every bundle under /assets, so those bytes cache for a year; HTML keeps its URL, so browsers hold it a minute and the edge copy is what a deploy purges. The HTML rule excludes /assets so one path has one lifetime, and it guards by host because a cache rule is zone-scoped: the api host (`api.` plus the target's own domain at every shape) answers extensionless user-scoped GETs (/authorize, /token, /omega/**, /mcp/**), and emailurl.<domain> is the proxied SendGrid link-tracking CNAME whose click and open URLs must reach SendGrid every time.",
  },
  {
    path:        'edge.providers.cloudflare.rules.managedTransforms',
    type:        'object',
    required:    false,
    default:     {
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
    materialize: false,
    description: "The zone's Managed Transforms, request and response, one switch per transform.",
  },
  {
    path:        'edge.providers.cloudflare.rules.responseHeaders',
    type:        'array',
    required:    false,
    default:     [
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
    materialize: false,
    description: "The zone's response-header rules ([{ name, expression, headers, enabled, priority }]); `{ domain }` templates to the brand domain. A brand or company list replaces the default whole, so an override that appends CSP hosts restates the frame-ancestors rule.",
  },
  {
    path:        'edge.providers.cloudflare.rules.redirect',
    type:        'array',
    required:    false,
    default:     [
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
    materialize: false,
    description: "The zone's dynamic redirect rules, ORDERED, and the ONE home for a TEMPLATED redirect, i.e. one whose destination is computed from the request path: [{ name, expression, statusCode, preserveQueryString, targetUrl, enabled }]. `expression` and `targetUrl` ({ value } for a fixed URL, { expression } for a computed one) are Cloudflare's own filter language, because only the edge can answer a URL the build cannot enumerate: DashQR's printed `/c/<id>` codes redirect to `/code?id=<id>` with `targetUrl.expression: concat(\"https://\", http.host, \"/code?id=\", substring(http.request.uri.path, 3))`. The @omega.js/manager edge service reconciles them by `name`. A redirect whose URLs CAN be enumerated is a redirect PAGE instead (docs/web/index.md), never config. The default strips a trailing slash; a brand list replaces it whole.",
  },
  {
    path:        'edge.providers.cloudflare.rules.security',
    type:        'array',
    required:    false,
    default:     [
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
    materialize: false,
    description: "The zone's custom security rules ([{ name, action, expression, skipProducts, skipPhases, skipRuleset, logging, enabled, priority }]); the default lets the api host skip the browser-facing checks.",
  },
];

module.exports = { EDGE_RULES };
