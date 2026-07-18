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

  formManager.on('submit', async ({ data }) => {
    console.log('Newsletter subscription:', data.email);

    // Here you would integrate with your newsletter service
    // For example: Mailchimp, SendGrid, ConvertKit, etc.

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Track signup
    trackNewsletterSignup();

    formManager.showSuccess('Thank you for subscribing! Check your email to confirm.');
  });
};

// Tracking
function trackNewsletterSignup() {
  gtag('event', 'newsletter_signup', {
    event_category: 'engagement',
    event_label: 'blog_page',
    value: 1,
  });
  fbq('track', 'Lead', {
    content_name: 'Newsletter',
    status: 'success',
  });
  ttq.track('Subscribe', {
    content_id: 'newsletter-blog',
    content_type: 'product',
    content_name: 'Newsletter',
  });
}
