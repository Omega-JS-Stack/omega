/**
 * The retired `.env` keys: the `omega migrate` rule set for env names, and the
 * only code that knows an old one. The .env layer itself stays open, so running
 * code never reads these; migrate names each one and converts what it can.
 */

// A row: { replacement, why, home }. `home: 'env'` is a rename inside .env; the
// default ('config') is a value that moved into omega.json5; `replacement: null`
// is a key retired outright, its line simply deleted.
const RETIRED_ENV_KEYS = {
  CHROME_EXTENSION_ID: {
    replacement: 'targets.<name>.listings.chrome.id',
    why: 'a store item id is public by design (it is in the listing URL), so it lives beside that listing in config',
  },
  FIREFOX_EXTENSION_ID: {
    replacement: 'targets.<name>.listings.firefox.id',
    why: "the AMO add-on id IS the manifest's gecko id, and config is its ONE home: the local scaffold pins the derived id there and the package task writes it into the manifest",
  },
  EDGE_PRODUCT_ID: {
    replacement: 'targets.<name>.listings.edge.id',
    why: 'a store product id is public by design (it is in the listing URL), so it lives beside that listing in config',
  },
  RECAPTCHA_SITE_KEY: {
    replacement: 'captcha.providers.recaptcha.siteKey',
    why: 'the site key is rendered into every page that carries a form, so it is public by definition; RECAPTCHA_SECRET_KEY stays in .env',
  },
  PAYPAL_CLIENT_ID: {
    replacement: 'payment.providers.paypal.clientId',
    why: 'the public half of the PayPal pair, already declared in config; the backend read it through a boot bridge that copied config into env',
  },
  CHARGEBEE_SITE: {
    replacement: 'payment.providers.chargebee.site',
    why: 'the site name is in every Chargebee URL, already declared in config; the backend read it through a boot bridge that copied config into env',
  },
  OAUTH2_GOOGLE_CLIENT_ID: {
    home: 'env',
    replacement: 'CONNECTIONS_GOOGLE_CLIENT_ID',
    why: '#788 renamed the oauth2 feature to connections, the env family included; the backend reads only CONNECTIONS_<PROVIDER>_CLIENT_ID now',
  },
  OAUTH2_GOOGLE_CLIENT_SECRET: {
    home: 'env',
    replacement: 'CONNECTIONS_GOOGLE_CLIENT_SECRET',
    why: '#788 renamed the oauth2 feature to connections, the env family included; the backend reads only CONNECTIONS_<PROVIDER>_CLIENT_SECRET now',
  },
  OMEGA_TEST_FIREBASE_ADMIN_KEY: {
    replacement: null,
    why: 'retired: desktop, extension and web test their own sign-in through a seeded persona from the backend emulator (#904), so no suite mints a custom token from a service account any more',
  },
  OMEGA_TEST_USER_UID: {
    replacement: null,
    why: 'retired: desktop, extension and web test their own sign-in through a seeded persona from the backend emulator (#904), and the roster names the persona, so no uid is configured anywhere',
  },
};

/**
 * The retired keys a parsed `.env` layer carries, in the layer's own order.
 * Presence is the test: an empty `KEY=` line documents a key nothing reads.
 * @param {Object<string, string>} values - Parsed `.env` values.
 * @returns {Array<{ key: string, replacement: string|null, why: string, home?: string }>}
 */
function findRetiredEnvKeys(values) {
  return Object.keys(values || {})
    .filter((key) => RETIRED_ENV_KEYS[key])
    .map((key) => ({ key, ...RETIRED_ENV_KEYS[key] }));
}

module.exports = { RETIRED_ENV_KEYS, findRetiredEnvKeys };
