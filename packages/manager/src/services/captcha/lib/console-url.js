/**
 * The reCAPTCHA console deep-link (#444) — the ONE place the guidance URL is
 * built, shared by the setup's half-key guard (#507) and the site-key ensure
 * handler's printed guidance.
 */

/**
 * The project hosting the key. captcha.providers.recaptcha.project only exists
 * to point at a project that ISN'T the brand's own (a key minted elsewhere);
 * with no override the key lives in the brand's cloud project, whose ONE home
 * is cloud.config.projectId (#23) — resolved config already carries the
 * company/brand merge.
 *
 * @param {object} brandConfig - Resolved brand config.
 * @returns {string|null} Project id, or null when no layer names one.
 */
function resolveProject(brandConfig) {
  return brandConfig.captcha?.providers?.recaptcha?.project
    || brandConfig.cloud?.config?.projectId
    || null;
}

/**
 * Deep-link to the key's settings page.
 *
 * omega-manager hardcoded the company GCP project here; the project resolves
 * from config now, so the deep link builds by default. Only a project unknown
 * at EVERY layer (or an unknown site key) falls back to the classic admin
 * console, which lists your keys (it deep-links by internal numeric ID, not
 * site key, so no key in the URL).
 *
 * @param {object} brandConfig - Resolved brand config.
 * @param {string|null} siteKey - The key to deep-link, when known.
 * @returns {string} Console URL.
 */
function recaptchaConsoleUrl(brandConfig, siteKey) {
  const project = resolveProject(brandConfig);

  if (project && siteKey) {
    return `https://console.cloud.google.com/security/recaptcha/${siteKey}/overview?from=keysList&project=${project}`;
  }
  return 'https://www.google.com/recaptcha/admin';
}

module.exports = { recaptchaConsoleUrl };
