/**
 * reCAPTCHA service — validates the brand's shared classic reCAPTCHA keys.
 *
 * Classic reCAPTCHA has no key-management API, so the shared key's domain
 * list can't be reconciled; this service proves what it can (the secret key
 * in .env is valid, via the documented siteverify endpoint) and prints the
 * console link + domains for the manual half. The onboarding add-domain
 * browser flow rides the onboarding port.
 *
 * Auth: RECAPTCHA_SITE_KEY + RECAPTCHA_SECRET_KEY in the brand .env.
 * Missing keys → the service skips with guidance.
 */
const { createServiceRunner } = require('../../lib/service-runner.js');
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
    const siteKey = process.env.RECAPTCHA_SITE_KEY;
    const secretKey = process.env.RECAPTCHA_SECRET_KEY;
    if (!siteKey || !secretKey) {
      const missing = [
        !siteKey ? 'RECAPTCHA_SITE_KEY' : null,
        !secretKey ? 'RECAPTCHA_SECRET_KEY' : null,
      ].filter(Boolean).join(' + ');
      return { skip: true, reason: `no ${missing} configured (shared classic reCAPTCHA keys; set them in the brand .env)` };
    }

    // Tests inject a fake client via context.recaptchaApi
    return {
      recaptchaApi: context.recaptchaApi || new RecaptchaAPI({ secretKey }),
      siteKey,
      domain: url,
    };
  },
});
