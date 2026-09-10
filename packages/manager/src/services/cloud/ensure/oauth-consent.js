/**
 * Ensure the OAuth consent screen (IAP brand) exists: application title +
 * support email (required for Google sign-in).
 *
 * No OAuth clients here — IAP-created clients are locked (no redirect URIs);
 * Firebase auto-creates the client when Google sign-in is enabled.
 *
 * Google only accepts a supportEmail the AUTHORIZING USER owns (their own
 * email or a Google Group they manage) — anything else is "Request contains
 * an invalid argument" (friction #29; the old support@{domain} default could
 * never work). `cloud.supportEmail` in config wins (the Google-Group
 * case); the default is the authenticated user's own email via the
 * userinfo.email scope. Neither available → warn with guidance, never send
 * a doomed value.
 *
 * The screen's AUDIENCE is a manage-time STOPPER (#667): Internal means only
 * the owning org's Workspace users may sign in, which is `Error 403:
 * org_internal` for every Gmail account, and Google gives NO API write for
 * it (proven live: PATCH is a 404, the create's orgInternalOnly is
 * output-only, and an API-made brand is born Internal). So an interactive
 * run STOPS on it — open the console page and poll until it flips — instead
 * of attempting a write that cannot exist.
 *
 * The screen's BRANDING page (logo, home/privacy/terms links, authorized
 * domains) has no API either, and nothing here can reconcile it — so the run
 * NAMES it as a manual step with the one line that matters (#696).
 */
const chalk = require('chalk').default;
const { openBrowserAndPoll } = require('@omega.js/devkit/flows');
const { canPrompt, dryRunPlan } = require('../../../lib/run-gates.js');
const { confirmSetup, readTriState } = require('../../../lib/config-flow.js');

// Where the gate's disable outcome lands the tri-state `false` (#608/#33).
// The AUDIENCE opts out on its own — a brand that accepts an org-only sign-in
// still wants every other cloud operation, so this is never cloud.enabled.
const AUDIENCE_PATH = 'cloud.consentAudience';

// The step-aside reason the run summary's warned breakdown reads (#643)
const INTERNAL_REASON = 'consent audience is Internal — Google sign-in fails outside the org';

// The console flip is a handful of clicks — poll faster than the 10s default
const AUDIENCE_POLL_MS = 5000;

/** The console page that owns the audience switch (the only path there is). */
function audienceUrl(projectId) {
  return `https://console.cloud.google.com/auth/audience?project=${projectId}`;
}

/**
 * Name the consent screen's BRANDING page as a manual step (#696).
 *
 * The logo, the home/privacy/terms links and the authorized domains have no
 * API at all — so the walk cannot reconcile them, and by the automation ruling
 * (#693) what cannot be automated gets NAMED instead of going unmentioned.
 * The one-line checklist is the part that decides whether it is safe to touch
 * the page mid-launch: a logo upload is the only entry that costs anything.
 *
 * @param {string} projectId - The GCP project the consent screen belongs to.
 */
function logBrandingManualStep(projectId) {
  console.log(`      ${chalk.dim('→')} Branding is manual (no API): ${chalk.cyan(`https://console.cloud.google.com/auth/branding?project=${projectId}`)}`);
  console.log(`      ${chalk.dim('→')} ${chalk.dim("Links + authorized domains are safe anytime; a LOGO upload starts Google's verification review for External apps")}`);
}

/**
 * Read the audience off the brand; Internal is a stopper, not a write.
 *
 * Interactive: the uniform three-outcome gate — Yes opens the console
 * audience page and polls the brand read until `orgInternalOnly` flips,
 * Skip (and `s` at the poll) warns and asks again next run, Disable lands
 * `cloud.consentAudience: false` and nothing ever asks again.
 * Non-interactive: the warn + the console URL, as before.
 *
 * @param {object} context - The handler context (firebaseApi, brandConfig,
 *   brandRoot, projectId, options).
 * @param {object} brand - The IAP brand resource just read or created.
 * @returns {Promise<{audience: string, status?: string, reason?: string}>} The resulting audience.
 */
async function ensureExternalAudience(context, brand) {
  const { firebaseApi: api, brandConfig, projectId, options = {} } = context;

  if (brand.orgInternalOnly !== true) {
    console.log(`      ${chalk.green('✓')} Consent audience: ${chalk.cyan('External')}`);
    return { audience: 'External' };
  }

  // Recorded opt-out (#33): the brand said Internal is fine — never ask,
  // never warn again, just say why nothing happened
  if (readTriState(brandConfig, AUDIENCE_PATH).optedOut) {
    console.log(`      ${chalk.dim(`⊘ Consent audience: Internal — ${AUDIENCE_PATH}: false (delete the line in omega.json5 to be asked again)`)}`);
    return { audience: 'Internal' };
  }

  if (options.dryRun) {
    dryRunPlan('stop for the Internal → External consent-audience flip in the console');
    return { audience: 'Internal' };
  }

  const url = audienceUrl(projectId);

  if (canPrompt(options)) {
    const action = await confirmSetup(context, {
      label: 'Consent audience (External)',
      instructions: [
        `${chalk.cyan(projectId)}'s consent screen is Internal — every Gmail account gets Error 403: org_internal`,
        'Google has no API for the flip: the console switch is the only path there is',
      ],
      disablePath: AUDIENCE_PATH,
    });

    // Disable landed `false` (and said so) — this run is done with the audience
    if (action === 'disable') {
      return { audience: 'Internal' };
    }

    if (action === 'yes') {
      const result = await openBrowserAndPoll({
        url,
        label: 'the consent audience page',
        promptMessage: `Switch ${chalk.cyan(projectId)}'s audience to External (Audience → Publish app).`,
        waitMessage: 'Waiting for the consent audience to flip to External',
        check: async () => {
          const [fresh] = await api.listBrands(projectId);
          return fresh && fresh.orgInternalOnly !== true ? { done: true, result: fresh } : { done: false };
        },
        intervalMs: AUDIENCE_POLL_MS,
      });

      if (result.success) {
        console.log(`      ${chalk.green('✓')} Consent audience: ${chalk.cyan('External')}`);
        return { audience: 'External' };
      }
    }
  }

  console.log(`      ${chalk.yellow('⚠')} ${chalk.cyan(projectId)}'s consent audience is Internal — Google sign-in fails outside the org`);
  console.log(`      ${chalk.dim('→')} Switch it to External: ${chalk.cyan(url)}`);
  return { audience: 'Internal', status: 'warned', reason: INTERNAL_REASON };
}

/**
 * Reconcile an existing brand's audience and report the screen as it stands.
 * The handler return for every path that READ the brand off the account.
 *
 * @param {object} context - The handler context.
 * @param {object} brand - The existing IAP brand resource.
 * @returns {Promise<object>} The handler return ({ status?, state }).
 */
async function reportExistingBrand(context, brand) {
  const audience = await ensureExternalAudience(context, brand);

  logBrandingManualStep(context.projectId);

  return {
    ...(audience.status ? { status: audience.status, reason: audience.reason } : {}),
    state: {
      oauthConsent: {
        brandName: brand.name,
        applicationTitle: brand.applicationTitle,
        supportEmail: brand.supportEmail,
        audience: audience.audience,
      },
    },
  };
}

module.exports = async function ensureOAuthConsent(context) {
  const { firebaseApi: api, brandConfig, projectId, options = {} } = context;
  const brandName = brandConfig.brand?.name;

  // === READ ===
  const existingBrands = await api.listBrands(projectId);

  if (existingBrands.length > 0) {
    console.log(`      ${chalk.green('✓')} OAuth consent screen exists`);

    return reportExistingBrand(context, existingBrands[0]);
  }

  // === WRITE ===
  if (options.dryRun) {
    const planned = brandConfig.cloud?.supportEmail || "(authorizing user's email)";
    return dryRunPlan(`create OAuth consent screen (${brandName}, ${planned})`, { output: { oauthConsent: { planned: 'create' } } });
  }

  const supportEmail = brandConfig.cloud?.supportEmail
    || await api.getAuthenticatedEmail();

  if (!supportEmail) {
    console.log(`      ${chalk.yellow('⚠')} No usable support email — Google only accepts one the authorizing user OWNS`);
    console.log(`      ${chalk.dim('→')} Re-auth to grant the email scope (delete .omega/auth/google-tokens.json and rerun), or set cloud.supportEmail to a Google Group you own`);
    return { status: 'warned', reason: 'no ownable support email — re-auth for the email scope or set cloud.supportEmail', output: { oauthConsent: { note: 'no ownable supportEmail available' } } };
  }

  console.log('      Creating OAuth consent screen...');
  try {
    const brand = await api.createBrand(projectId, brandName, supportEmail);
    console.log(`      ${chalk.green('✓')} Created OAuth consent screen`);
    console.log(`        ${chalk.dim('→')} Application: ${chalk.cyan(brandName)}`);
    console.log(`        ${chalk.dim('→')} Support email: ${chalk.cyan(supportEmail)}`);

    // An API-made brand is born INTERNAL, always (#667, proven live): the
    // audience is READ off the new brand and taken through the same stopper
    // as any other, never assumed
    const audience = await ensureExternalAudience(context, brand);

    logBrandingManualStep(projectId);

    return {
      ...(audience.status ? { status: audience.status, reason: audience.reason } : {}),
      state: {
        oauthConsent: {
          brandName: brand.name,
          applicationTitle: brandName,
          supportEmail,
          audience: audience.audience,
        },
      },
    };
  } catch (error) {
    if (error.message?.includes('already exists')) {
      console.log(`      ${chalk.green('✓')} OAuth consent screen already exists`);

      // The list above missed it (IAP's list lags a create by another run, or
      // a concurrent one won): read it back so this run still reconciles the
      // audience and reports the screen, instead of saying nothing about it
      const [existing] = await api.listBrands(projectId);
      if (!existing) {
        return {};
      }

      return reportExistingBrand(context, existing);
    }

    // Brand creation is ORG-ONLY (#667, proven live): an org-less project
    // answers 400 "Project must belong to an organization". A known cause
    // gets named, never the generic could-not-create line
    if (error.message?.includes('must belong to an organization')) {
      console.log(`      ${chalk.yellow('⚠')} ${chalk.cyan(projectId)} belongs to no organization — Google only creates a consent screen in an org-owned project`);
      console.log(`      ${chalk.dim('→')} Create it by hand: ${chalk.cyan(`https://console.cloud.google.com/apis/credentials/consent?project=${projectId}`)}`);
      return { status: 'warned', reason: 'the project belongs to no organization — create the consent screen in the console', output: { oauthConsent: { note: 'org-less project — brand creation is org-only' } } };
    }

    console.log(`      ${chalk.yellow('⚠')} Could not create OAuth consent screen${chalk.dim(`: ${error.message}`)}`);
    console.log(`      ${chalk.dim('→')} Configure manually: ${chalk.cyan(`https://console.cloud.google.com/apis/credentials/consent?project=${projectId}`)}`);
    return { status: 'warned', reason: 'could not create the OAuth consent screen', output: { oauthConsent: { error: error.message } } };
  }
};
