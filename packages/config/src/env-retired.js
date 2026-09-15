/**
 * Retired ENV keys ([#893](https://github.com/Omega-JS-Stack/omega/issues/893))
 * - the `.env` half of retired-keys.js.
 *
 * Six values were declared in both homes at once: the env schema carried them
 * as non-secret keys while the config schema already declared (or now
 * declares) the same fact. Two homes for one value drift, and the rule that
 * settles which one wins is in docs/shared/config.md ("Config or env?"):
 * config holds what is PUBLIC by design (an id a store URL carries, a key a
 * browser bundle ships, a value printed in a binary), `.env` holds secrets,
 * the login coordinates that only travel with a secret, and machine paths.
 *
 * There is no dual-read anywhere in OMEGA, so a `.env` line left behind is a
 * value nothing reads: the id a brand carefully pasted would be ignored and
 * the publish would address the wrong listing, or none. Every layer read
 * therefore FAILS on one, naming the config path the value moved to
 * (env.js's parseEnvFile, the one place a `.env` layer is parsed).
 *
 * The config-side register gets nothing from this move: these were never
 * config keys, so nothing there was renamed.
 *
 * The register also carries the env-side RENAMES
 * ([#845](https://github.com/Omega-JS-Stack/omega/issues/845)): a key that is
 * still a secret and still lives in `.env`, under a new name. Same silence,
 * same refusal; the fix it names is renaming the line, not deleting it.
 *
 * And it carries the keys that are retired OUTRIGHT
 * ([#819](https://github.com/Omega-JS-Stack/omega/issues/819)): no config path,
 * no new env name, because what replaced the key is a MECHANISM rather than a
 * value. Such a row declares `replacement: null` and its refusal reads as a
 * deletion with nowhere to move the value to.
 */

// env var name -> { replacement, why, home } (docs/shared/config.md carries the
// rows). `home` is where the replacement LIVES: 'config' by default (the #893
// move), or 'env' for a key that stayed a secret and only changed NAME, which
// is a rename of the line rather than a deletion. `replacement: null` is a key
// with no successor of any kind (#819): the line is simply deleted, and the
// row's `why` names the mechanism that made it unnecessary.
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
  // The connections pair ([#845](https://github.com/Omega-JS-Stack/omega/issues/845)):
  // these are SECRETS and stayed in `.env`, so the row is a rename, not a move.
  // Exact names only, one per provider: the register is a name lookup, so the
  // `OAUTH2_*` family is spelled out a row at a time as a brand needs it, and
  // Google is the pair every brand carries today.
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
  // The test-lane pair ([#819](https://github.com/Omega-JS-Stack/omega/issues/819),
  // Ian 2026-09-13): retired outright, so neither row names a replacement. A
  // suite no longer holds a credential of its own, which is why there is
  // nothing to move the value to.
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
 *
 * Presence is the whole test: an empty value (`KEY=`) documents a key nothing
 * reads, so it is owed the same deletion as a valued one.
 *
 * @param {Object<string, string>} values - Parsed `.env` values.
 * @returns {Array<{ key: string, replacement: string|null, why: string }>}
 */
function findRetiredEnvKeys(values) {
  return Object.keys(values || {})
    .filter((key) => RETIRED_ENV_KEYS[key])
    .map((key) => ({ key, ...RETIRED_ENV_KEYS[key] }));
}

/**
 * Refuse a `.env` layer that still carries a retired key, spelling the move
 * out. A row with no replacement says so plainly: the line is deleted and
 * nothing takes the value anywhere (#819).
 *
 * @param {Object<string, string>} values - Parsed `.env` values.
 * @param {string} envPath - The file the values came from (named in the error).
 * @throws {Error} Naming every retired key in the layer, its new home, and why.
 */
function assertNoRetiredEnvKeys(values, envPath) {
  const found = findRetiredEnvKeys(values);
  if (found.length === 0) return;

  const moves = found.map(({ key, replacement, why, home }) => {
    if (!replacement) return `  ${key} is retired outright: delete the .env line, nothing replaces the value (${why})`;

    return home === 'env'
      ? `  ${key} renamed to ${replacement}; rename the .env line (${why})`
      : `  ${key} moved to ${replacement} in config/omega.json5; delete the .env line (${why})`;
  });

  throw new Error(
    `${envPath} carries ${found.length} retired env key(s). Nothing reads them, so the value is silently lost:\n`
    + `${moves.join('\n')}\n`
    + 'The rule, and the whole register: docs/shared/config.md ("Config or env?").',
  );
}

module.exports = { RETIRED_ENV_KEYS, findRetiredEnvKeys, assertNoRetiredEnvKeys };
