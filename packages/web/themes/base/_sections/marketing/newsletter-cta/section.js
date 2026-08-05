/**
 * Newsletter capture behavior — binds this section's form to the client
 * FormManager (managed states, validation, success/error alerts) and posts
 * the address to the backend's public subscribe endpoint
 * (`POST /omega/marketing/contact` — email validation, reCAPTCHA, rate
 * limiting, provider add server-side). The §7 presence init calls this once
 * per rendered instance with the section's root element, so the binding
 * works on ANY page that composes the band.
 *
 * reCAPTCHA loads lazily on first interaction with the form (not at page
 * load — the band rides most pages and passive visitors shouldn't pay for
 * the Google script). No site key configured → the request still sends;
 * the backend decides.
 */
import omega from '@omega.js/client';
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import { initializeRecaptcha, getRecaptchaToken } from '__main_assets__/js/libs/recaptcha.js';

export default (el) => {
  const $form = el.querySelector('form.newsletter-form');
  if (!$form) {
    return;
  }

  // Warm reCAPTCHA on first interaction so the token is ready by submit
  let recaptchaWarmup = null;
  const warmup = () => {
    recaptchaWarmup = recaptchaWarmup || initializeRecaptcha(omega.config?.captcha?.providers?.recaptcha?.siteKey);
    return recaptchaWarmup;
  };
  $form.addEventListener('focusin', warmup, { once: true });

  const formManager = new FormManager($form, {
    allowResubmit: false,
    resetOnSuccess: true,
    submittingText: 'Subscribing...',
    submittedText: 'Subscribed!',
  });

  formManager.on('submit', async ({ data }) => {
    await warmup();
    const recaptchaToken = await getRecaptchaToken('newsletter_signup');

    // A thrown error runs FormManager's own catch: it shows the error alert
    // AND restores the ready state so the visitor can retry. Swallowing the
    // error here would let FormManager run its success path (reset +
    // disabled + "Subscribed!") on a failed submit. Single attempt on
    // purpose — reCAPTCHA tokens are single-use, so a retry would resend a
    // consumed token; the restored form IS the retry path.
    try {
      await omega.request('/omega/marketing/contact', {
        method: 'POST',
        auth: false,
        timeout: 15000,
        body: {
          email: data.email,
          source: 'newsletter-cta',
          'g-recaptcha-response': recaptchaToken || '',
        },
      });
    } catch (e) {
      throw new Error('Something went wrong. Please try again.');
    }

    trackNewsletterSignup();
    formManager.showSuccess('Thanks for subscribing!');
  });
};

// Tracking (gtag/fbq/ttq are no-op stubs when providers are unconfigured)
function trackNewsletterSignup() {
  gtag('event', 'newsletter_signup', {
    event_category: 'engagement',
    event_label: 'newsletter-cta',
    value: 1,
  });
  fbq('track', 'Lead', {
    content_name: 'Newsletter',
    status: 'success',
  });
  ttq.track('Subscribe', {
    content_id: 'newsletter-cta',
    content_type: 'product',
    content_name: 'Newsletter',
  });
}
