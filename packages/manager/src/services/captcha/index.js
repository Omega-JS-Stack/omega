/**
 * Captcha service (`captcha.providers.recaptcha`) — validates the brand's
 * OWN classic reCAPTCHA keys (de-ITW: every brand mints its own key in its
 * own GCP project — never a company-shared key; interactive runs ASK for the
 * keys via the cp114 paste flow, pointing at the GCP reCAPTCHA console).
 *
 * Classic reCAPTCHA has no key-management API, so the key's domain list
 * can't be reconciled; this service proves what it can (the secret key
 * in .env is valid, via the documented siteverify endpoint) and prints the
 * console link + domains for the manual half. Interactive runs open the
 * console and confirm the domain list once, stamping config (#434).
 *
 * It also owns the HALF-KEY guard (#507): the secret in .env without
 * `captcha.providers.recaptcha.siteKey` in config (or the reverse) fails the
 * service — see the guard below.
 *
 * Auth: RECAPTCHA_SITE_KEY + RECAPTCHA_SECRET_KEY in the brand .env.
 * Missing keys → interactive runs ask; non-interactive runs skip with guidance.
 */
const { serviceInputSpec } = require('../../config.js');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { requestServiceInput } = require('../../lib/service-input.js');
const { RecaptchaAPI } = require('./lib/recaptcha-api.js');
const { recaptchaConsoleUrl } = require('./lib/console-url.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const recaptchaConfig = context.brandConfig.captcha?.providers?.recaptcha || {};

    if (recaptchaConfig.enabled === false) {
      return { skip: true, reason: 'captcha.providers.recaptcha.enabled = false' };
    }

    // A half-keyed brand is a broken brand (#507). The backend enforces token
    // verification the moment RECAPTCHA_SECRET_KEY exists, and the client can
    // only mint a token when captcha.providers.recaptcha.siteKey is in config
    // — either half alone is a silent 403 on every protected POST (the
    // playground's live checkout, 2026-08-22). This service is the ONE place
    // that sees both halves, so it fails loudly instead of proving the secret
    // and calling a broken brand green. Neither half = the sanctioned unkeyed
    // brand (#17), which stays green and skips below.
    const configuredSiteKey = recaptchaConfig.siteKey || null;
    const configuredSecret = process.env.RECAPTCHA_SECRET_KEY || null;
    if (Boolean(configuredSiteKey) !== Boolean(configuredSecret)) {
      const consoleUrl = recaptchaConsoleUrl(context.brandConfig, configuredSiteKey);
      throw new Error(configuredSecret
        ? `RECAPTCHA_SECRET_KEY is set but captcha.providers.recaptcha.siteKey is missing from config — the client sends an empty token and every protected POST 403s. Paste the site key into config/omega.json5: ${consoleUrl}`
        : `captcha.providers.recaptcha.siteKey is set but RECAPTCHA_SECRET_KEY is missing from the brand .env — the backend can never verify a token. Copy the secret half into the .env: ${consoleUrl}`);
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
    const gate = await requestServiceInput(context, serviceInputSpec('captcha'));
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
