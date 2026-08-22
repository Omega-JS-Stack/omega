/**
 * Validate the brand's own classic reCAPTCHA keys.
 *
 * omega-manager only printed a checkmark outside onboarding; this port
 * actually proves the secret: siteverify with a throwaway token answers
 * invalid-input-response when the secret is valid and invalid-input-secret
 * when it isn't. The key's domain list has no read API (classic reCAPTCHA),
 * so domain membership can't be proven — interactive runs open the console
 * and confirm once, stamping config (a confirm nothing can re-check is the
 * one reconcile flag config keeps, #434 — same pattern as the ga-link
 * confirm); non-interactive runs keep the printed guidance.
 *
 * The probe is a pure read (no assessment is created), so dry-run behaves
 * identically to a normal run.
 */
const chalk = require('chalk').default;
const { openBrowserAndPoll } = require('@omega.js/devkit/flows');
const { writeBrandConfig } = require('../../../lib/config-write.js');
const { canPrompt } = require('../../../lib/run-gates.js');

const CONFIRMED_PATH = 'captcha.providers.recaptcha.domainsConfirmed';

// Throwaway token for the secret-validity probe — never a real assessment
const PROBE_TOKEN = 'omega-manager-secret-validation-probe';

module.exports = async function ensureSiteKey(context) {
  const { recaptchaApi, siteKey, domain, brandConfig, options = {} } = context;

  const consoleUrl = buildConsoleUrl(siteKey, resolveProject(brandConfig));

  console.log(`      ${chalk.dim('→')} Validating reCAPTCHA secret key...`);
  const verification = await recaptchaApi.verify(PROBE_TOKEN);
  const errorCodes = verification['error-codes'] || [];

  if (errorCodes.includes('invalid-input-secret')) {
    console.log(`      ${chalk.red('✗')} RECAPTCHA_SECRET_KEY in the brand .env is not a valid secret key`);
    console.log(`      ${chalk.dim('→')} Key settings: ${chalk.cyan(consoleUrl)}`);
    throw new Error('RECAPTCHA_SECRET_KEY is invalid (siteverify answered invalid-input-secret) — fix it in the brand .env');
  }

  // The bare domain only — the brand contract dropped the www twin, so
  // recommending it would ask for a listing nothing serves
  const domains = [domain];
  const output = { siteKey: { secretValid: true, domains, consoleUrl } };

  console.log(`      ${chalk.green('✓')} reCAPTCHA secret key is valid`);

  // The domain list has no read API — a one-time interactive confirm stamps
  // config (#434); a changed brand domain naturally re-prompts. A pre-existing
  // stamp that also carries the www twin still covers the bare domain, so it
  // confirms without churn and the stamp narrows to what's recommended now
  const confirmed = brandConfig.captcha?.providers?.recaptcha?.domainsConfirmed || [];
  if (domains.every((entry) => confirmed.includes(entry))) {
    // Narrow a stamp that carries extras (the retired www twin); an exact
    // match stays disk-free
    if (confirmed.length !== domains.length) {
      writeBrandConfig(context, { [CONFIRMED_PATH]: domains });
    }
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
      writeBrandConfig(context, { [CONFIRMED_PATH]: domains });
      console.log(`      ${chalk.green('✓')} Domain list confirmed`);
      return { output };
    }
  }

  console.log(`      ${chalk.dim(`→ The key's domain list has no read API — ensure ${domains.join(' + ')} is listed: ${consoleUrl}`)}`);
  return { output };
};

function resolveProject(brandConfig) {
  // captcha.providers.recaptcha.project only exists to point at a project that
  // ISN'T the brand's own (a key minted elsewhere); with no override the key
  // lives in the brand's cloud project, whose ONE home is cloud.config.projectId
  // (#23) — resolved config already carries the company/brand merge
  return brandConfig.captcha?.providers?.recaptcha?.project
    || brandConfig.cloud?.config?.projectId
    || null;
}

function buildConsoleUrl(siteKey, project) {
  // omega-manager hardcoded the company GCP project here; the project resolves
  // from config now, so the deep link builds by default. Only a project unknown
  // at EVERY layer falls back to the classic admin console, which lists your
  // keys (it deep-links by internal numeric ID, not site key, so no key in the URL)
  if (project) {
    return `https://console.cloud.google.com/security/recaptcha/${siteKey}/overview?from=keysList&project=${project}`;
  }
  return 'https://www.google.com/recaptcha/admin';
}
