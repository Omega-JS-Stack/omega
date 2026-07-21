/**
 * reCAPTCHA service — validates the brand's OWN classic reCAPTCHA keys
 * (de-ITW: every brand mints its own key in its own GCP project — never a
 * company-shared key; interactive runs ASK for the keys via the cp114 paste
 * flow, pointing at the GCP reCAPTCHA console).
 *
 * Classic reCAPTCHA has no key-management API, so the key's domain list
 * can't be reconciled; this service proves what it can (the secret key
 * in .env is valid, via the documented siteverify endpoint) and prints the
 * console link + domains for the manual half. Interactive runs open the
 * console and confirm the domain list once, stamping state.
 *
 * Auth: RECAPTCHA_SITE_KEY + RECAPTCHA_SECRET_KEY in the brand .env.
 * Missing keys → interactive runs ask; non-interactive runs skip with guidance.
 */
const { REQUIRES } = require('../../config.js');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { ensureEnvSecrets } = require('../../lib/env-secrets.js');
const { RecaptchaAPI } = require('./lib/recaptcha-api.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const recaptchaConfig = context.brandConfig.recaptcha || {};

    if (recaptchaConfig.enabled === false) {
      return { skip: true, reason: 'recaptcha.enabled = false' };
    }

    const url = (context.brandConfig.brand?.url || '').replace(/^https?:\/\//, '');
    if (!url) {
      return { skip: true, reason: 'no brand.url configured' };
    }

    // The site key is handler data (console link, domain guidance), not just
    // auth — both keys must come from the .env even when tests inject the api
    // De-ITW: the ask points at the GCP reCAPTCHA console (the brand's OWN
    // project) via the registry entries — the paste flow is the ONLY path to
    // a key; no default value exists anywhere
    const gate = await ensureEnvSecrets(context, REQUIRES.recaptcha.env);
    if (gate) return gate;
    const siteKey = process.env.RECAPTCHA_SITE_KEY;
    const secretKey = process.env.RECAPTCHA_SECRET_KEY;

    // Tests inject a fake client via context.recaptchaApi
    return {
      recaptchaApi: context.recaptchaApi || new RecaptchaAPI({ secretKey }),
      siteKey,
      domain: url,
    };
  },
});
