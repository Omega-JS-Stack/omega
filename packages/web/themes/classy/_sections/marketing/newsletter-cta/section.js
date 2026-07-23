/**
 * Newsletter capture behavior — binds this section's form to the client
 * FormManager (managed states, validation, success/error alerts). The §7
 * presence init calls this once per rendered instance with the section's
 * root element, so the binding works on ANY page that composes the band
 * (moved here from core/js/pages/blog/index.js, which owned it when only
 * the blog index rendered the form).
 */
import { FormManager } from '@omega.js/client/modules/form-manager.js';

export default (el) => {
  const $form = el.querySelector('form.newsletter-form');
  if (!$form) {
    return;
  }

  const formManager = new FormManager($form, {
    allowResubmit: false,
    resetOnSuccess: true,
    submittingText: 'Subscribing...',
    submittedText: 'Subscribed!',
  });

  formManager.on('submit', async () => {
    // No capture wiring exists yet (Ian decides the provider/endpoint) — a
    // LOUD stub: never confirm success on a submission that goes nowhere,
    // and never log the address (a live dead form is the cp217/cp218 class).
    console.warn('[newsletter-cta] No newsletter integration is configured — the submission was NOT captured. Wire this section to a capture endpoint.');

    formManager.showError('Newsletter signup is not configured yet.');
  });
};
