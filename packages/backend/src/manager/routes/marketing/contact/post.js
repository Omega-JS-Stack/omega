/**
 * POST /marketing/contact - Add marketing contact
 * Public endpoint to subscribe to newsletter, with admin options
 */
const recaptcha = require('../../../libraries/recaptcha.js');
const { validate: validateEmail, ALL_CHECKS } = require('../../../libraries/email/validation.js');
const { inferContact } = require('../../../libraries/infer-contact.js');

module.exports = async ({ ctx, Manager, settings, analytics }) => {

  // Initialize Usage to check auth level
  const usage = await Manager.Usage().init(ctx, {
    unauthenticatedMode: 'firestore',
  });
  const isAdmin = usage.user.roles?.admin;

  // Extract parameters
  const email = (settings.email || '').trim().toLowerCase();
  let firstName = (settings.firstName || '').trim();
  let lastName = (settings.lastName || '').trim();
  const source = settings.source;

  // Admin-only options
  const tags = isAdmin ? settings.tags : [];
  const skipValidation = isAdmin ? settings.skipValidation : false;

  // Email validation — run free checks before reCAPTCHA/rate limit
  const shouldCallExternalAPIs = !ctx.isTesting() || process.env.TEST_EXTENDED_MODE;

  // skipValidation (admin-only) reduces to just format + disposable
  // Admin gets full checks including mailbox verification when external APIs are enabled
  const checks = skipValidation
    ? ['format']
    : (isAdmin && shouldCallExternalAPIs ? ALL_CHECKS : undefined);

  const validation = await validateEmail(email, { checks });

  if (!validation.valid) {
    // For public requests, return generic success to prevent email enumeration
    if (!isAdmin) {
      return ctx.respond({ success: true });
    }

    const { format, localPart, disposable, corporate } = validation.checks;

    if (format && !format.valid) {
      return ctx.respond('Invalid email format', { code: 400 });
    }

    if (localPart && !localPart.valid) {
      return ctx.respond(`Blocked email local part: ${localPart.localPart}`, { code: 400 });
    }

    if (disposable && !disposable.valid) {
      return ctx.respond(`Disposable email domain not allowed: ${disposable.domain}`, { code: 400 });
    }

    if (corporate && !corporate.valid) {
      return ctx.respond(`Corporate/social-media domain not allowed: ${corporate.domain}`, { code: 400 });
    }

    // Name the failing check (admin-only branch — public callers already got a
    // generic success above, so email-enumeration protection is untouched)
    const failedCheck = Object.keys(validation.checks).find((name) => validation.checks[name]?.valid === false);
    return ctx.respond(`Email validation failed (${failedCheck})`, { code: 400 });
  }

  // Public access protection (after validation so we don't waste reCAPTCHA on garbage)
  if (!isAdmin) {
    // Verify reCAPTCHA (skip during automated tests). verify() owns the
    // whole decision: no RECAPTCHA_SECRET_KEY configured → pass (unkeyed
    // brands are a sanctioned population — cp257: keys are optional and
    // per-brand); secret + missing/bad token → fail. No pre-check here — an
    // empty-token 403 before verify() would permanently reject every
    // subscribe from a brand that never configured reCAPTCHA.
    if (!ctx.isTesting()) {
      const recaptchaValid = await recaptcha.verify(settings['g-recaptcha-response']);
      if (!recaptchaValid) {
        return ctx.respond('Request could not be verified', { code: 403 });
      }
    }

    // Check rate limit via Usage API
    try {
      await usage.validate('marketing-subscribe', { useCaptchaResponse: false });
      usage.increment('marketing-subscribe');
      await usage.update();
    } catch (e) {
      return ctx.respond('Rate limit exceeded', { code: 429 });
    }
  }

  // Infer contact info if name not provided
  let nameInferred = null;
  let company = '';
  if (!firstName && !lastName) {
    nameInferred = await inferContact(email, ctx);
    firstName = nameInferred.firstName;
    lastName = nameInferred.lastName;
    company = nameInferred.company;
  }

  // Add to providers
  let providerResults = {};

  if (!shouldCallExternalAPIs) {
    ctx.log('marketing/contact: Skipping providers (OMEGA_TEST_MODE=true, TEST_EXTENDED_MODE not set)');
  } else {
    const mailer = Manager.Email(ctx);
    providerResults = await mailer.add({
      email,
      firstName,
      lastName,
      company,
      source,
    });
  }

  // Log result
  ctx.log('marketing/contact result:', {
    email,
    providers: providerResults,
    validation,
    nameInferred,
  });

  // Track analytics
  analytics.event('marketing/contact', { action: 'add' });

  // Return response based on auth level
  if (isAdmin) {
    return ctx.respond({
      success: true,
      providers: providerResults,
      validation,
      nameInferred,
    });
  }

  // Public: generic response
  return ctx.respond({ success: true });
};
