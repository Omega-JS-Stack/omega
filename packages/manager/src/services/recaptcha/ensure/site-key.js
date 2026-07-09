/**
 * Validate the shared classic reCAPTCHA keys.
 *
 * omega-manager only printed a checkmark outside onboarding; this port
 * actually proves the secret: siteverify with a throwaway token answers
 * invalid-input-response when the secret is valid and invalid-input-secret
 * when it isn't. The key's domain list has no read API (classic reCAPTCHA),
 * so domain membership stays printed guidance — the interactive add-domain
 * flow rides the onboarding port.
 *
 * The probe is a pure read (no assessment is created), so dry-run behaves
 * identically to a normal run.
 */
const chalk = require('chalk').default;

// Throwaway token for the secret-validity probe — never a real assessment
const PROBE_TOKEN = 'omega-manager-secret-validation-probe';

module.exports = async function ensureSiteKey(context) {
  const { recaptchaApi, siteKey, domain, brandConfig } = context;

  const consoleUrl = buildConsoleUrl(siteKey, brandConfig.recaptcha?.project);

  console.log(`      ${chalk.dim('→')} Validating shared reCAPTCHA secret key...`);
  const verification = await recaptchaApi.verify(PROBE_TOKEN);
  const errorCodes = verification['error-codes'] || [];

  if (errorCodes.includes('invalid-input-secret')) {
    console.log(`      ${chalk.red('✗')} RECAPTCHA_SECRET_KEY in the brand .env is not a valid secret key`);
    console.log(`      ${chalk.dim('→')} Key settings: ${chalk.cyan(consoleUrl)}`);
    throw new Error('RECAPTCHA_SECRET_KEY is invalid (siteverify answered invalid-input-secret) — fix it in the brand .env');
  }

  const domains = [domain, `www.${domain}`];

  console.log(`      ${chalk.green('✓')} Shared reCAPTCHA secret key is valid`);
  console.log(`      ${chalk.dim(`→ The key's domain list has no read API — ensure ${domains.join(' + ')} are listed: ${consoleUrl}`)}`);

  return {
    output: {
      siteKey: {
        secretValid: true,
        domains,
        consoleUrl,
      },
    },
  };
};

function buildConsoleUrl(siteKey, project) {
  // omega-manager hardcoded the company GCP project here; recaptcha.project
  // is config now. Without it, the classic admin console lists your keys
  // (it deep-links by internal numeric ID, not site key, so no key in the URL)
  if (project) {
    return `https://console.cloud.google.com/security/recaptcha/${siteKey}/overview?project=${project}`;
  }
  return 'https://www.google.com/recaptcha/admin';
}
