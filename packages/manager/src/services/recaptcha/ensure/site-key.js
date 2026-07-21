/**
 * Validate the brand's own classic reCAPTCHA keys.
 *
 * omega-manager only printed a checkmark outside onboarding; this port
 * actually proves the secret: siteverify with a throwaway token answers
 * invalid-input-response when the secret is valid and invalid-input-secret
 * when it isn't. The key's domain list has no read API (classic reCAPTCHA),
 * so domain membership can't be proven — interactive runs open the console
 * and confirm once, stamping state (same pattern as the OAuth redirect-URI
 * confirm); non-interactive runs keep the printed guidance.
 *
 * The probe is a pure read (no assessment is created), so dry-run behaves
 * identically to a normal run.
 */
const chalk = require('chalk').default;
const { openBrowserAndPoll } = require('@omega.js/devkit/flows');
const { canPrompt } = require('../../../lib/run-gates.js');

// Throwaway token for the secret-validity probe — never a real assessment
const PROBE_TOKEN = 'omega-manager-secret-validation-probe';

module.exports = async function ensureSiteKey(context) {
  const { recaptchaApi, siteKey, domain, brandConfig, serviceData = {}, options = {} } = context;

  const consoleUrl = buildConsoleUrl(siteKey, brandConfig.recaptcha?.project);

  console.log(`      ${chalk.dim('→')} Validating reCAPTCHA secret key...`);
  const verification = await recaptchaApi.verify(PROBE_TOKEN);
  const errorCodes = verification['error-codes'] || [];

  if (errorCodes.includes('invalid-input-secret')) {
    console.log(`      ${chalk.red('✗')} RECAPTCHA_SECRET_KEY in the brand .env is not a valid secret key`);
    console.log(`      ${chalk.dim('→')} Key settings: ${chalk.cyan(consoleUrl)}`);
    throw new Error('RECAPTCHA_SECRET_KEY is invalid (siteverify answered invalid-input-secret) — fix it in the brand .env');
  }

  const domains = [domain, `www.${domain}`];
  const output = { siteKey: { secretValid: true, domains, consoleUrl } };

  console.log(`      ${chalk.green('✓')} reCAPTCHA secret key is valid`);

  // The domain list has no read API — a one-time interactive confirm stamps
  // state; a changed brand domain naturally re-prompts
  if (JSON.stringify(serviceData.domainsConfirmed || null) === JSON.stringify(domains)) {
    console.log(`      ${chalk.green('✓')} Domain list confirmed (${domains.join(' + ')})`);
    return { output };
  }

  if (canPrompt(options)) {
    const result = await openBrowserAndPoll({
      url: consoleUrl,
      label: 'the reCAPTCHA console',
      promptMessage: `Add ${chalk.cyan(domains.join(' + '))} to the reCAPTCHA key's domain list.`,
      waitMessage: 'Waiting for the domains to be saved',
      manualOnly: true,
      indent: '        ',
    });

    if (result.success) {
      console.log(`      ${chalk.green('✓')} Domain list confirmed`);
      return { state: { domainsConfirmed: domains }, output };
    }
  }

  console.log(`      ${chalk.dim(`→ The key's domain list has no read API — ensure ${domains.join(' + ')} are listed: ${consoleUrl}`)}`);
  return { output };
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
