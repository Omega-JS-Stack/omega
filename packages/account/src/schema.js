/**
 * USER_SCHEMA — the canonical OMEGA user/account schema (pure data, no logic).
 *
 * Extracted verbatim from backend-manager's src/manager/helpers/user.js, which is
 * the authoritative shape (web-manager's DEFAULT_ACCOUNT had drifted from it).
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
    },
    cancellation: {
      pending: { type: 'boolean', default: false },
      date: '$timestamp',
    },
    payment: {
      processor: { type: 'string', default: null, nullable: true },
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
  usage: {
    $passthrough: true,
    $template: {
      monthly: { type: 'number', default: 0 },
      daily: { type: 'number', default: 0 },
      total: { type: 'number', default: 0 },
      last: {
        id: { type: 'string', default: null, nullable: true },
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
  oauth2: {
    $passthrough: true,
  },
  attribution: {
    affiliate: {
      code: { type: 'string', default: null, nullable: true },
      timestamp: { type: 'string', default: null, nullable: true },
      url: { type: 'string', default: null, nullable: true },
      page: { type: 'string', default: null, nullable: true },
    },
    utm: {
      tags: { $passthrough: true },
      timestamp: { type: 'string', default: null, nullable: true },
      url: { type: 'string', default: null, nullable: true },
      page: { type: 'string', default: null, nullable: true },
    },
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
