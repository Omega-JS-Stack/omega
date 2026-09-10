/**
 * USER_SCHEMA — the canonical OMEGA user/account schema (pure data, no logic).
 *
 * Extracted verbatim from @omega.js/backend's src/manager/helpers/user.js, which is
 * the authoritative shape (@omega.js/client's DEFAULT_ACCOUNT had drifted from it).
 *
 * Each leaf field is { type, default, nullable }
 * Special keys:
 *   $passthrough  — preserve all existing keys from input, don't strip unknowns
 *   $template     — shape applied to every dynamic key in a $passthrough object
 *   '$template'   — (string value) reference to parent's $template
 *   '$timestamp'  — shorthand for { timestamp, timestampUNIX } defaulting to epoch
 *   '$timestamp:now' — same but defaults to current time
 *   '$uuid', '$randomId', '$apiKey', '$oldDate' — resolved at runtime (generators
 *   are injected by the host — see engine.js; absent generators resolve to null)
 */

/**
 * One attribution TOUCH — a single visit's campaign context, shared by
 * `attribution.first` and `attribution.last`
 * ([#384](https://github.com/Omega-JS-Stack/omega/issues/384)). `tags` holds the
 * utm set and `clickIds` the ad-platform click ids (fbclid/gclid/…), both
 * passthrough because the platforms keep adding params. The schema is read-only
 * to the engine, so one object serves both slots.
 */
const ATTRIBUTION_TOUCH = {
  tags: { $passthrough: true },
  clickIds: { $passthrough: true },
  referrer: { type: 'string', default: null, nullable: true },
  url: { type: 'string', default: null, nullable: true },
  page: { type: 'string', default: null, nullable: true },
  timestamp: { type: 'string', default: null, nullable: true },
};

const USER_SCHEMA = {
  auth: {
    uid: { type: 'string', default: null, nullable: true },
    email: { type: 'string', default: null, nullable: true },
    temporary: { type: 'boolean', default: false },
  },
  subscription: {
    product: {
      id: { type: 'string', default: 'basic' },
      name: { type: 'string', default: 'Basic' },
    },
    status: { type: 'string', default: 'active' },
    expires: '$timestamp',
    trial: {
      claimed: { type: 'boolean', default: false },
      expires: '$timestamp',
      // How the trial ENDED: 'converted' | 'lapsed' | null (still running, or never
      // answered). `claimed` says only that a trial happened — a converted trial and a
      // lapsed one carry identical dates — so this is the one stored conversion signal.
      // Stamped by the trial-lapse sweep once the provider confirms which it was.
      outcome: { type: 'string', default: null, nullable: true },
    },
    cancellation: {
      pending: { type: 'boolean', default: false },
      date: '$timestamp',
    },
    payment: {
      provider: { type: 'string', default: null, nullable: true },
      orderId: { type: 'string', default: null, nullable: true },
      resourceId: { type: 'string', default: null, nullable: true },
      frequency: { type: 'string', default: null, nullable: true },
      price: { type: 'number', default: 0 },
      startDate: '$timestamp',
      updatedBy: {
        event: {
          name: { type: 'string', default: null, nullable: true },
          id: { type: 'string', default: null, nullable: true },
        },
        date: '$timestamp',
      },
    },
    // The discount riding the subscription right now
    // ([#325](https://github.com/Omega-JS-Stack/omega/issues/325)). Shaped as a
    // discount-codes validate() RESULT — the one shape the whole payment stack
    // already speaks — so the billing card reads exactly what the apply route
    // wrote, and neither side learns a second spelling. `valid: false` (the
    // default) IS "no discount": absent and denied read the same everywhere.
    //
    // Both shapes are always present and default to 0, unlike a fresh validate()
    // result which omits the one it is not: this node is MERGED onto a document
    // that may already carry a discount, and a percent claim landing on a stored
    // amount would otherwise be read as the older, wrong number.
    //
    // `source` is what makes it safe to read as a CLAIM. Today only the winback
    // claim writes this node; a code typed at checkout will set the same node
    // when checkout starts writing it, and a winback pitch suppressed by someone
    // else's promo is an offer silently withheld — so the node says which system
    // applied it ('winback' | 'checkout'), and only 'winback' is the claimed
    // signal the cancel flow gates on.
    //
    // `resourceId` is the subscription the discount was applied TO, stamped at
    // claim time ([#333](https://github.com/Omega-JS-Stack/omega/issues/333)).
    // It is what makes the node clearable: the unified webhook write carries no
    // discount key, so a merge preserves this node forever, and a customer who
    // churned and resubscribed carried a spent claim into the NEW subscription,
    // where `source: 'winback'` reads as "already claimed" and silently retires
    // an offer the backend would grant again. The webhook pipeline compares the
    // stamp against the subscription each event is about and CLEARS the node
    // (back to these defaults) on a mismatch: a new subscription is a clean
    // slate. An unstamped node (written before the stamp existed) is read as
    // belonging to the subscription it is found on, because nothing can prove
    // otherwise and no live discount is ever taken away on a guess, and the
    // pipeline stamps it there, so it clears on the next resubscribe like any
    // other.
    discount: {
      valid: { type: 'boolean', default: false },
      code: { type: 'string', default: null, nullable: true },
      percent: { type: 'number', default: 0 },
      amount: { type: 'number', default: 0 },
      duration: { type: 'string', default: null, nullable: true },
      source: { type: 'string', default: null, nullable: true },
      resourceId: { type: 'string', default: null, nullable: true },
    },
  },
  roles: {
    $passthrough: true,
    admin: { type: 'boolean', default: false },
    betaTester: { type: 'boolean', default: false },
    developer: { type: 'boolean', default: false },
  },
  flags: {
    $passthrough: true,
    signupProcessed: { type: 'boolean', default: false },
  },
  affiliate: {
    code: { type: 'string', default: '$randomId' },
    referrals: { type: 'array', default: [] },
  },
  metadata: {
    created: '$timestamp:now',
    updated: '$timestamp:now',
  },
  activity: {
    geolocation: {
      ip: { type: 'string', default: null, nullable: true },
      continent: { type: 'string', default: null, nullable: true },
      country: { type: 'string', default: null, nullable: true },
      region: { type: 'string', default: null, nullable: true },
      city: { type: 'string', default: null, nullable: true },
      latitude: { type: 'number', default: 0 },
      longitude: { type: 'number', default: 0 },
    },
    client: {
      language: { type: 'string', default: null, nullable: true },
      mobile: { type: 'boolean', default: false },
      device: { type: 'string', default: null, nullable: true },
      platform: { type: 'string', default: null, nullable: true },
      browser: { type: 'string', default: null, nullable: true },
      vendor: { type: 'string', default: null, nullable: true },
      runtime: { type: 'string', default: null, nullable: true },
      userAgent: { type: 'string', default: null, nullable: true },
      url: { type: 'string', default: null, nullable: true },
    },
  },
  api: {
    clientId: { type: 'string', default: '$uuid' },
    privateKey: { type: 'string', default: '$apiKey' },
  },
  // The documents this account owns, by KIND: `{ teams: ['team-abc'] }`
  // ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)). A counted
  // feature's catalog entry names the kinds its counters mirror onto
  // (`usage: { mirror: ['teams'] }`), and this is what resolves a kind to real
  // document paths — so a mirror is declared once in config instead of
  // re-derived at every call site. Server-written like `usage`: a client that
  // could write it could point another account's counters at its own doc.
  owns: {
    $passthrough: true,
  },
  usage: {
    $passthrough: true,
    // Admin-granted extra credits, feature id → number
    // ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)). Declared
    // HERE so the sibling `$template` never resolves it as a counter block:
    // it is a map of limits, not a map of counts. `usage` is a framework field
    // the security rules deny every client, so an override can only ever be
    // server-written — which is what makes it trustworthy as a limit.
    overrides: { $passthrough: true },
    $template: {
      monthly: { type: 'number', default: 0 },
      daily: { type: 'number', default: 0 },
      total: { type: 'number', default: 0 },
      // When the counter last moved. The old `id` field went with the retired
      // `increment(name, value, { id })` option (#647): nothing writes it now,
      // and a schema field nothing fills reads as a fact that is always null.
      last: {
        timestamp: { type: 'string', default: '$oldDate' },
        timestampUNIX: { type: 'number', default: 0 },
      },
    },
  },
  personal: {
    birthday: '$timestamp',
    gender: { type: 'string', default: null, nullable: true },
    location: {
      country: { type: 'string', default: null, nullable: true },
      region: { type: 'string', default: null, nullable: true },
      city: { type: 'string', default: null, nullable: true },
      postalCode: { type: 'string', default: null, nullable: true },
      street: { type: 'string', default: null, nullable: true },
    },
    name: {
      first: { type: 'string', default: null, nullable: true },
      last: { type: 'string', default: null, nullable: true },
    },
    company: {
      name: { type: 'string', default: null, nullable: true },
      position: { type: 'string', default: null, nullable: true },
    },
    telephone: {
      countryCode: { type: 'number', default: 0 },
      national: { type: 'number', default: 0 },
    },
  },
  connections: {
    $passthrough: true,
  },
  attribution: {
    affiliate: {
      code: { type: 'string', default: null, nullable: true },
      timestamp: { type: 'string', default: null, nullable: true },
      url: { type: 'string', default: null, nullable: true },
      page: { type: 'string', default: null, nullable: true },
    },
    // The touch model: `first` is the visit that first brought the user here,
    // written once and never overwritten; `last` is the newest TAGGED visit. No
    // expiry — the timestamps carry any read-time lookback window. Replaces the
    // single `utm` blob outright (no dual-read).
    first: ATTRIBUTION_TOUCH,
    last: ATTRIBUTION_TOUCH,
  },
  // The tracking-consent snapshot the client captured, stored verbatim: passthrough
  // because this layer never interprets it — the consent module owns its shape. NOT
  // the same thing as `consent` below, which is the legal/marketing decision.
  trackingConsent: {
    $passthrough: true,
  },
  consent: {
    legal: {
      status: { type: 'string', default: 'revoked' },
      grantedAt: {
        timestamp: { type: 'string', default: null, nullable: true },
        timestampUNIX: { type: 'number', default: null, nullable: true },
        source: { type: 'string', default: null, nullable: true },
        ip: { type: 'string', default: null, nullable: true },
        text: { type: 'string', default: null, nullable: true },
      },
    },
    marketing: {
      status: { type: 'string', default: 'revoked' },
      grantedAt: {
        timestamp: { type: 'string', default: null, nullable: true },
        timestampUNIX: { type: 'number', default: null, nullable: true },
        source: { type: 'string', default: null, nullable: true },
        ip: { type: 'string', default: null, nullable: true },
        text: { type: 'string', default: null, nullable: true },
      },
      revokedAt: {
        timestamp: { type: 'string', default: null, nullable: true },
        timestampUNIX: { type: 'number', default: null, nullable: true },
        source: { type: 'string', default: null, nullable: true },
        ip: { type: 'string', default: null, nullable: true },
        text: { type: 'string', default: null, nullable: true },
      },
    },
  },
};

module.exports = USER_SCHEMA;
