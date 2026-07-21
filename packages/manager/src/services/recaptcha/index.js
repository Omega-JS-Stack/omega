/**
 * reCAPTCHA service — validates the brand's shared classic reCAPTCHA keys.
 *
 * Classic reCAPTCHA has no key-management API, so the shared key's domain
 * list can't be reconciled; this service proves what it can (the secret key
 * in .env is valid, via the documented siteverify endpoint) and prints the
 * console link + domains for the manual half. Interactive runs open the
 * console and confirm the domain list once, stamping state.
 *
 * Auth: RECAPTCHA_SITE_KEY + RECAPTCHA_SECRET_KEY in the brand .env.
 * Missing keys → the service skips with guidance.
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
